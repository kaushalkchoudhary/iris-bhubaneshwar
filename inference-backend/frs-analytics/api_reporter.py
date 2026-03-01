#!/usr/bin/env python3
"""
FRS API Reporter
- Pulls (camera_id, frame, faces) tuples from a queue.
- Reports face detections to the Go backend /api/events/ingest endpoint.
"""

import logging
import os
import requests
import time
import cv2
import json
from queue import Queue, Empty
from typing import Dict, List, Tuple, Optional
import numpy as np
import base64
from urllib.parse import urljoin

# Local imports (standalone directory)
from duplicate_tracker import DuplicateTracker
from watchlist_manager import WatchlistManager
from frs_types import InferenceFaceData, APIReporter_APIConfig, APIReporter_CameraConfig

logger = logging.getLogger(__name__)


def api_reporter(
    input_queue: Queue,
    api_config: APIReporter_APIConfig,
    camera_configs: Dict[str, APIReporter_CameraConfig],
    watchlist_manager: Optional[WatchlistManager] = None
):
    """
    The main function for the API reporter process.

    Args:
        input_queue: Queue to receive (camera_id, frame, faces) tuples.
        api_config: API configuration with base_url, token, etc.
        camera_configs: A dictionary mapping camera_id to camera configuration.
    """

    base_url = api_config.get('base_url')
    token = api_config.get('token')
    headers = {}
    if token:
        headers['Authorization'] = f'Bearer {token}'

    # Prefer worker-to-server auth for distributed edge deployment.
    worker_id = os.getenv('WORKER_ID', '').strip()
    auth_token = os.getenv('AUTH_TOKEN', '').strip()
    if worker_id:
        headers['X-Worker-ID'] = worker_id
    if auth_token:
        headers['X-Auth-Token'] = auth_token
    url = urljoin(base_url, '/api/events/ingest')
    confidence_threshold = api_config.get('confidence_threshold', 0.3)

    duplicate_tracker = DuplicateTracker(
        similarity_threshold=api_config.get('similarity_threshold', 0.65),
        short_window=api_config.get('duplicate_short_window', 30.0),
        long_window=api_config.get('duplicate_long_window', 300.0),
        max_tracked_faces=api_config.get('max_tracked_faces', 1000)
    )

    if watchlist_manager is None:
        watchlist_manager = WatchlistManager(api_config)

    watchlist_manager.update()

    stats = {
        'start_time': time.time(),
        'total_received': 0,
        'total_reported': 0,
        'total_errors': 0,
        'total_duplicates': 0,
        'total_matches': 0,
        'camera_stats': {},
        'last_summary_time': time.time(),
        'last_cleanup_time': time.time()
    }
    summary_interval = 10.0
    cleanup_interval = 300.0

    while True:
        try:
            watchlist_manager.update()

            camera_id, frame, faces = input_queue.get(timeout=1.0)

            if not faces:
                continue

            cam_conf = camera_configs.get(camera_id, {})
            location_id = cam_conf.get('location_id')

            if camera_id not in stats['camera_stats']:
                stats['camera_stats'][camera_id] = {
                    'received': 0,
                    'reported': 0,
                    'errors': 0,
                    'duplicates': 0,
                    'matches': 0
                }
            stats['camera_stats'][camera_id]['received'] += len(faces)
            stats['total_received'] += len(faces)

            for face in faces:
                bbox = face.get('bbox', [])
                if not bbox or len(bbox) < 4:
                    logger.warning(f"[{camera_id}] Skipping face with invalid bbox")
                    continue

                embedding = face.get('embedding')
                embedding_norm = face.get('embedding_norm', 0)

                if embedding and embedding_norm:
                    confidence = float(embedding_norm)
                elif embedding:
                    confidence = float(np.linalg.norm(embedding))
                else:
                    confidence = 0.0

                normalized_confidence = float(min(confidence / 30.0, 1.0))

                if normalized_confidence < confidence_threshold:
                    continue

                should_report, best_face_data, reason = duplicate_tracker.should_report_face(
                    face_data=face,
                    camera_id=camera_id
                )

                if not should_report:
                    stats['total_duplicates'] += 1
                    stats['camera_stats'][camera_id]['duplicates'] += 1
                    logger.debug(f"[{camera_id}] Skipping duplicate face: {reason}")
                    continue

                face_to_report = best_face_data or face

                x1, y1, x2, y2 = map(int, face_to_report['bbox'])
                face_crop_img = frame[y1:y2, x1:x2]

                if face_crop_img is None or face_crop_img.size == 0:
                    logger.warning(f"[{camera_id}] Empty face crop for bbox {face_to_report['bbox']}; sending full frame only.")
                    face_crop_img = None

                jpeg_quality = api_config.get('jpeg_quality', 75)
                encode_params = [int(cv2.IMWRITE_JPEG_QUALITY), jpeg_quality]

                frame_to_encode = frame
                resize_height = api_config.get('full_frame_resize_height')
                scale_x_ratio = 1.0
                scale_y_ratio = 1.0

                if resize_height and isinstance(resize_height, int):
                    try:
                        h, w = frame.shape[:2]
                        new_w = int((resize_height / h) * w)
                        scale_x_ratio = new_w / w
                        scale_y_ratio = resize_height / h
                        frame_to_encode = cv2.resize(frame, (new_w, resize_height), interpolation=cv2.INTER_AREA)
                    except Exception as e:
                        logger.warning(f"[{camera_id}] Failed to resize frame: {e}")

                _, frame_encoded = cv2.imencode('.jpg', frame_to_encode, encode_params)

                raw_bbox = face_to_report['bbox']
                annotated_frame = frame_to_encode.copy()
                bx1 = int(round(raw_bbox[0] * scale_x_ratio))
                by1 = int(round(raw_bbox[1] * scale_y_ratio))
                bx2 = int(round(raw_bbox[2] * scale_x_ratio))
                by2 = int(round(raw_bbox[3] * scale_y_ratio))
                cv2.rectangle(annotated_frame, (bx1, by1), (bx2, by2), (0, 255, 0), 2)

                _, face_img_encoded = cv2.imencode('.jpg', annotated_frame, encode_params)
                face_crop_encoded = None
                if face_crop_img is not None:
                    _, face_crop_encoded = cv2.imencode('.jpg', face_crop_img, encode_params)

                age = face_to_report.get('age')
                gender = face_to_report.get('gender')

                metadata = {
                    'gender': 'female' if gender == 0 else 'male' if gender == 1 else 'unknown',
                    'gender_raw': gender,
                    'ageGroup': f'age_{age}' if age is not None else 'unknown',
                    'quality_score': duplicate_tracker.calculate_quality_score(face_to_report),
                    'detection_reason': reason
                }

                event_id = f"face_{int(time.time() * 1000)}"

                event_payload = {
                    'id': event_id,
                    'worker_id': 'frs-analytics-worker',
                    'device_id': camera_id,
                    'type': 'face_detected',
                    'data': {
                        'confidence': normalized_confidence,
                        'bbox': face_to_report['bbox'],
                        'metadata': metadata
                    }
                }

                if embedding:
                    embedding_array = np.array(embedding, dtype=np.float32)
                    embedding_bytes = embedding_array.tobytes()
                    event_payload['data']['faceEmbedding'] = base64.b64encode(embedding_bytes).decode('utf-8')

                    matched_person, match_score = watchlist_manager.match(embedding)

                    if matched_person:
                        event_payload['type'] = 'person_match'
                        event_payload['data']['person_id'] = matched_person.get('id')
                        event_payload['data']['person_name'] = matched_person.get('name')
                        event_payload['data']['confidence'] = match_score

                        logger.info(f"[{camera_id}] Match found: {matched_person.get('name')} ({match_score:.2f})")
                        stats['total_matches'] += 1
                        stats['camera_stats'][camera_id]['matches'] += 1

                        event_payload['data']['metadata']['is_known'] = True
                        event_payload['data']['metadata']['match_score'] = match_score
                        event_payload['data']['metadata']['person_category'] = matched_person.get('category', 'unknown')
                    else:
                        has_weak_match = False
                        max_similarity = 0.0
                        weak_match_person = None

                        for person in watchlist_manager.persons:
                            if 'embedding_np' not in person:
                                continue
                            source_emb = person['embedding_np']
                            target_emb = np.array(embedding, dtype=np.float32)
                            source_norm = np.linalg.norm(source_emb)
                            target_norm = np.linalg.norm(target_emb)
                            if source_norm == 0 or target_norm == 0:
                                continue
                            similarity = float(np.dot(target_emb, source_emb) / (target_norm * source_norm))
                            if similarity > max_similarity:
                                max_similarity = similarity
                                weak_match_person = person
                            if similarity > 0.25:
                                has_weak_match = True

                        if has_weak_match:
                            logger.debug(f"[{camera_id}] Weak match to {weak_match_person.get('name') if weak_match_person else 'unknown'} ({max_similarity:.3f}) - skipping")
                            stats['total_duplicates'] += 1
                            stats['camera_stats'][camera_id]['duplicates'] += 1
                            continue

                        unknown_confidence = 1.0 - max_similarity
                        event_payload['data']['metadata']['is_known'] = False
                        event_payload['data']['metadata']['match_score'] = 0.0
                        event_payload['data']['metadata']['unknown_confidence'] = unknown_confidence
                        event_payload['data']['metadata']['max_similarity_to_watchlist'] = max_similarity

                        logger.debug(f"[{camera_id}] Unknown face (conf: {normalized_confidence:.2f})")

                data = {'event': json.dumps(event_payload)}
                files = {
                    'face.jpg': ('face.jpg', face_img_encoded.tobytes(), 'image/jpeg'),
                    'frame.jpg': ('frame.jpg', frame_encoded.tobytes(), 'image/jpeg')
                }
                if face_crop_encoded is not None:
                    files['face_crop.jpg'] = ('face_crop.jpg', face_crop_encoded.tobytes(), 'image/jpeg')

                try:
                    response = requests.post(url, headers=headers, data=data, files=files, timeout=10)
                    if response.ok:
                        stats['total_reported'] += 1
                        stats['camera_stats'][camera_id]['reported'] += 1
                    else:
                        logger.error(f"[{camera_id}] API error: {response.status_code} - {response.text}")
                        stats['total_errors'] += 1
                        stats['camera_stats'][camera_id]['errors'] += 1

                except requests.exceptions.RequestException as e:
                    current_time = time.time()
                    if current_time - stats.get('last_error_log', 0) >= 60:
                        logger.warning(f"Backend connection error (will retry): {e}")
                        stats['last_error_log'] = current_time
                    stats['total_errors'] += 1
                    stats['camera_stats'][camera_id]['errors'] += 1

            current_time = time.time()
            if current_time - stats['last_summary_time'] >= summary_interval:
                elapsed = current_time - stats['start_time']
                tracker_stats = duplicate_tracker.get_statistics()
                logger.info("="*70)
                logger.info(f"API REPORTER SUMMARY | Runtime: {elapsed:.1f}s | "
                          f"Received: {stats['total_received']} | Reported: {stats['total_reported']} | "
                          f"Matches: {stats['total_matches']} | Duplicates: {stats['total_duplicates']} | "
                          f"Errors: {stats['total_errors']}")
                logger.info(f"Tracked faces: {tracker_stats['tracked_faces']} | Duplicate rate: {tracker_stats['duplicate_rate']:.1f}%")
                stats['last_summary_time'] = current_time

            if current_time - stats['last_cleanup_time'] >= cleanup_interval:
                duplicate_tracker.cleanup_old_faces(max_age=3600.0)
                stats['last_cleanup_time'] = current_time

        except Empty:
            continue
        except Exception as e:
            logger.error(f"Unexpected error in API reporter: {e}", exc_info=True)
