#!/usr/bin/env python3
"""
FRS Inference Worker
- Pulls frames from a queue.
- Runs batched face recognition using InsightFace on GPU.
- Pushes results to another queue.
"""

import logging
import insightface
import torch
import numpy as np
import time
import cv2
from queue import Queue, Empty
from typing import Dict, Tuple, List
import threading

# Local imports (standalone directory)
from frs_types import InferenceFaceData
from common.common_types import FrameQueueItem

logger = logging.getLogger(__name__)


def inference_worker(
    input_queues: List[Queue],
    output_queue: Queue,
    config: Dict,
    watchlist_manager=None
):
    """
    The main function for the inference worker process.

    Args:
        input_queues: List of queues to receive (camera_id, frame) tuples from multiple sources.
        output_queue: Queue to send (camera_id, frame, faces) tuples.
        config: A dictionary with configuration for the model.
    """

    # Model configuration
    device = config.get('device', 'cuda')
    det_size = tuple(config.get('det_size', (640, 640)))
    det_width, det_height = det_size
    det_thresh = config.get('det_thresh')
    use_letterbox = bool(config.get('use_letterbox', True))

    # Batching configuration
    batch_size = config.get('batch_size', 16)
    batch_timeout = config.get('batch_timeout', 0.05)

    # Set up logging for this worker
    log_file = config.get('log_file', 'logs/inference_worker.log')
    handler = logging.FileHandler(log_file)
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)

    # Initialize the InsightFace model
    logger.info("Initializing InsightFace model...")
    try:
        if device.startswith('cuda'):
            if ':' in device:
                gpu_id = int(device.split(':')[1])
            else:
                gpu_id = 0
            ctx_id = gpu_id if torch.cuda.is_available() else -1
        else:
            ctx_id = -1

        if ctx_id == -1:
            logger.warning("CUDA not available, running on CPU. This will be slow.")

        model = insightface.app.FaceAnalysis(
            allowed_modules=['detection', 'recognition', 'genderage'],
            providers=['CUDAExecutionProvider' if ctx_id >= 0 else 'CPUExecutionProvider']
        )
        if det_thresh is not None:
            model.prepare(ctx_id=ctx_id, det_size=det_size, det_thresh=float(det_thresh))
        else:
            model.prepare(ctx_id=ctx_id, det_size=det_size)
        logger.info(f"InsightFace model loaded successfully on {'GPU ' + str(ctx_id) if ctx_id >= 0 else 'CPU'}.")
    except Exception as e:
        logger.error(f"Fatal error initializing model: {e}", exc_info=True)
        return

    running = True

    stats = {
        'start_time': time.time(),
        'total_frames': 0,
        'total_batches': 0,
        'total_faces': 0,
        'camera_stats': {},
        'last_summary_time': time.time(),
        'total_inference_time': 0.0,
        'total_queue_wait_time': 0.0,
        'total_post_process_time': 0.0
    }
    summary_interval = 60.0

    while running:
        batch_data = []
        batch_frames = []
        batch_transforms = []

        start_time = time.time()
        queue_wait_start = time.time()

        while len(batch_frames) < batch_size and (time.time() - start_time) < batch_timeout:
            frames_added_this_round = 0

            for queue_idx, input_queue in enumerate(input_queues):
                if len(batch_frames) >= batch_size:
                    break

                try:
                    camera_id, frame = input_queue.get(block=False)
                    if frame is not None:
                        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

                        if use_letterbox:
                            orig_h, orig_w = frame_rgb.shape[:2]
                            if orig_h == 0 or orig_w == 0:
                                continue
                            scale = min(det_width / orig_w, det_height / orig_h)
                            new_w = max(1, int(round(orig_w * scale)))
                            new_h = max(1, int(round(orig_h * scale)))
                            resized = cv2.resize(frame_rgb, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
                            padded = np.zeros((det_height, det_width, 3), dtype=resized.dtype)
                            pad_x = (det_width - new_w) // 2
                            pad_y = (det_height - new_h) // 2
                            padded[pad_y:pad_y + new_h, pad_x:pad_x + new_w] = resized
                            frame_resized = padded
                            batch_transforms.append({
                                'mode': 'letterbox',
                                'scale': scale,
                                'pad_x': pad_x,
                                'pad_y': pad_y,
                                'orig_w': orig_w,
                                'orig_h': orig_h
                            })
                        else:
                            frame_resized = cv2.resize(frame_rgb, (det_width, det_height), interpolation=cv2.INTER_LINEAR)
                            orig_h, orig_w = frame_rgb.shape[:2]
                            batch_transforms.append({
                                'mode': 'scale',
                                'scale_x': orig_w / det_width,
                                'scale_y': orig_h / det_height,
                                'orig_w': orig_w,
                                'orig_h': orig_h
                            })

                        batch_data.append((camera_id, frame))
                        batch_frames.append(frame_resized)
                        frames_added_this_round += 1

                        if 'queue_sources' not in stats:
                            stats['queue_sources'] = {}
                        if queue_idx not in stats['queue_sources']:
                            stats['queue_sources'][queue_idx] = {'frames': 0, 'faces': 0}
                        stats['queue_sources'][queue_idx]['frames'] += 1

                except Empty:
                    continue
                except (ValueError, TypeError) as e:
                    logger.error(f"Received malformed data in queue {queue_idx}: {e}")
                    continue

            if frames_added_this_round == 0:
                time.sleep(0.001)

        queue_wait_time = time.time() - queue_wait_start
        stats['total_queue_wait_time'] += queue_wait_time

        if not batch_frames:
            continue

        try:
            is_watchlist_empty = watchlist_manager and watchlist_manager.is_empty()

            inference_start_time = time.time()
            all_faces = []

            if is_watchlist_empty:
                all_faces = [[] for _ in batch_frames]
                if not hasattr(inference_worker, '_last_skip_log'):
                    inference_worker._last_skip_log = 0
                if time.time() - inference_worker._last_skip_log >= 60:
                    logger.info("Watchlist is empty. Skipping face detection to save resources.")
                    inference_worker._last_skip_log = time.time()
            else:
                for frame in batch_frames:
                    faces = model.get(frame)
                    all_faces.append(faces)

            inference_time = time.time() - inference_start_time
            stats['total_inference_time'] += inference_time

            num_detections = sum(len(faces) for faces in all_faces)

            is_watchlist_empty = watchlist_manager and watchlist_manager.is_empty()

            post_process_start = time.time()
            for i, _ in enumerate(batch_frames):
                camera_id, original_frame = batch_data[i]

                if is_watchlist_empty:
                    output_queue.put((camera_id, original_frame, []))
                    continue

                faces = all_faces[i]

                orig_height, orig_width = original_frame.shape[:2]
                transform = batch_transforms[i] if i < len(batch_transforms) else None

                if camera_id not in stats['camera_stats']:
                    stats['camera_stats'][camera_id] = {'frames': 0, 'faces': 0}
                stats['camera_stats'][camera_id]['frames'] += 1
                stats['camera_stats'][camera_id]['faces'] += len(faces)

                serializable_faces = []
                for face in faces:
                    if hasattr(face, 'bbox') and face.bbox is not None:
                        det_bbox = face.bbox.tolist() if hasattr(face.bbox, 'tolist') else list(face.bbox)
                        if transform and transform.get('mode') == 'letterbox':
                            scale = transform['scale']
                            pad_x = transform['pad_x']
                            pad_y = transform['pad_y']
                            x1 = (det_bbox[0] - pad_x) / scale
                            y1 = (det_bbox[1] - pad_y) / scale
                            x2 = (det_bbox[2] - pad_x) / scale
                            y2 = (det_bbox[3] - pad_y) / scale
                        else:
                            scale_x = (orig_width / det_width) if det_width else 1.0
                            scale_y = (orig_height / det_height) if det_height else 1.0
                            x1 = det_bbox[0] * scale_x
                            y1 = det_bbox[1] * scale_y
                            x2 = det_bbox[2] * scale_x
                            y2 = det_bbox[3] * scale_y

                        padding_x = (x2 - x1) * 0.2
                        padding_y = (y2 - y1) * 0.2
                        x1 = max(0.0, min(float(orig_width),  x1 - padding_x))
                        y1 = max(0.0, min(float(orig_height), y1 - padding_y))
                        x2 = max(0.0, min(float(orig_width),  x2 + padding_x))
                        y2 = max(0.0, min(float(orig_height), y2 + padding_y))
                        orig_bbox = [x1, y1, x2, y2]
                    else:
                        orig_bbox = []

                    face_data: InferenceFaceData = {
                        'bbox': orig_bbox,
                        'det_score': float(face.det_score) if hasattr(face, 'det_score') else None,
                        'landmark': face.landmark.tolist() if hasattr(face, 'landmark') and face.landmark is not None else None,
                        'embedding': face.embedding.tolist() if hasattr(face, 'embedding') and face.embedding is not None else None,
                        'embedding_norm': float(face.embedding_norm) if hasattr(face, 'embedding_norm') else None,
                        'age': int(face.age) if hasattr(face, 'age') and face.age is not None else None,
                        'gender': int(face.gender) if hasattr(face, 'gender') and face.gender is not None else None,
                    }
                    serializable_faces.append(face_data)

                output_queue.put((camera_id, original_frame, serializable_faces))

            post_process_time = time.time() - post_process_start
            stats['total_post_process_time'] += post_process_time

        except Exception as e:
            logger.error(f"Error during batch inference: {e}", exc_info=True)

        stats['total_frames'] += len(batch_frames)
        stats['total_batches'] += 1
        stats['total_faces'] += num_detections

        current_time = time.time()
        if current_time - stats['last_summary_time'] >= summary_interval:
            elapsed_total = current_time - stats['start_time']
            fps = stats['total_frames'] / elapsed_total if elapsed_total > 0 else 0

            logger.debug("="*70)
            logger.debug(f"INFERENCE WORKER SUMMARY (Last {summary_interval}s)")
            logger.debug(f"Total Runtime: {elapsed_total:.1f}s | Processing Rate: {fps:.1f} fps")
            logger.debug(f"Total: {stats['total_frames']} frames, {stats['total_batches']} batches, {stats['total_faces']} faces detected")

            if stats['total_batches'] > 0:
                avg_batch_size = stats['total_frames'] / stats['total_batches']
                avg_queue_wait = stats['total_queue_wait_time'] / stats['total_batches'] * 1000
                avg_inference = stats['total_inference_time'] / stats['total_batches'] * 1000
                avg_post_process = stats['total_post_process_time'] / stats['total_batches'] * 1000
                logger.debug(f"  Avg batch size: {avg_batch_size:.1f} | Queue: {avg_queue_wait:.1f}ms | Inference: {avg_inference:.1f}ms | Post: {avg_post_process:.1f}ms")

            stats['last_summary_time'] = current_time
