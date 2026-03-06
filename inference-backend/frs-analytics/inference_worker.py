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
from typing import Dict, Tuple, List, Optional
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
    det_size = tuple(config.get('det_size', (960, 960)))
    det_width, det_height = det_size
    det_thresh = config.get('det_thresh', 0.65)  # Raised from 0.5 — cuts low-quality crowd detections
    # Skip recognition/embedding for faces below this confidence — saves GPU matching work
    # on clearly-unknown/low-quality faces. Only watchlist-quality faces get embeddings.
    recognition_thresh = float(config.get('recognition_thresh', 0.70))
    use_letterbox = bool(config.get('use_letterbox', True))

    # Crowd OOM mitigations
    frame_sample_rate = int(config.get('frame_sample_rate', 2))   # Only run inference every Nth frame per camera
    max_faces_per_frame = int(config.get('max_faces_per_frame', 6))  # Cap embeddings per frame
    _camera_frame_counters: dict = {}  # per-camera frame counter for sampling

    # Batching configuration
    batch_size = config.get('batch_size', 16)
    batch_timeout = config.get('batch_timeout', 0.05)

    # Logging: use the root handler (stdout/journald) only — no per-camera file.
    # File-based logging fills disk quickly and is not covered by logrotate.
    logger.setLevel(logging.INFO)

    # Initialize the InsightFace model.
    # Always list CUDAExecutionProvider first — ONNX Runtime falls back to CPU
    # automatically if CUDA is not available, without needing torch.cuda.
    logger.info("Initializing InsightFace model...")
    try:
        providers = ['CUDAExecutionProvider', 'CPUExecutionProvider']
        # ctx_id=0 → GPU 0; ONNX Runtime gracefully falls back to CPU if unavailable.
        ctx_id = 0 if device.startswith('cuda') else -1

        model = insightface.app.FaceAnalysis(
            allowed_modules=['detection', 'recognition', 'genderage'],
            providers=providers,
        )
        if det_thresh is not None:
            model.prepare(ctx_id=ctx_id, det_size=det_size, det_thresh=float(det_thresh))
        else:
            model.prepare(ctx_id=ctx_id, det_size=det_size, det_thresh=0.65)

        # Report which providers are actually active after prepare().
        try:
            import onnxruntime as _ort
            active = _ort.get_available_providers()
            using_gpu = 'CUDAExecutionProvider' in active
            logger.info(f"InsightFace model loaded — active providers: {active} | GPU: {using_gpu}")
        except Exception:
            logger.info(f"InsightFace model loaded successfully (ctx_id={ctx_id}).")
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
                        # Frame sampling: skip every N-1 out of N frames per camera
                        _camera_frame_counters[camera_id] = _camera_frame_counters.get(camera_id, 0) + 1
                        if frame_sample_rate > 1 and _camera_frame_counters[camera_id] % frame_sample_rate != 0:
                            continue  # drop this frame, wait for next sampled one

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
                # Nothing arrived — sleep longer to avoid burning CPU in a busy-wait.
                time.sleep(0.010)

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
                    # Cap faces per frame: keep the N largest by bounding-box area to avoid
                    # embedding explosion in crowded scenes.
                    if len(faces) > max_faces_per_frame:
                        faces = sorted(faces, key=lambda f: (f.bbox[2]-f.bbox[0])*(f.bbox[3]-f.bbox[1]), reverse=True)[:max_faces_per_frame]
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

                    # Skip embedding for faces below the recognition confidence threshold.
                    # Face is still reported (bounding box visible in UI) but not matched
                    # against watchlist — avoids wasteful GPU memory bandwidth on unknowns.
                    det_score = float(face.det_score) if hasattr(face, 'det_score') else 1.0
                    skip_embedding = (det_score < recognition_thresh)

                    face_data: InferenceFaceData = {
                        'bbox': orig_bbox,
                        'det_score': det_score if hasattr(face, 'det_score') else None,
                        'landmark': face.landmark.tolist() if hasattr(face, 'landmark') and face.landmark is not None else None,
                        'embedding': None if skip_embedding else (face.embedding.tolist() if hasattr(face, 'embedding') and face.embedding is not None else None),
                        'embedding_norm': None if skip_embedding else (float(face.embedding_norm) if hasattr(face, 'embedding_norm') else None),
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


def shared_inference_worker(input_queue, reply_queues: list, config: dict):
    """
    Shared inference worker — loads InsightFace ONCE and serves ALL cameras on this Jetson.

    input_queue:  multiprocessing.Queue receiving (camera_id, frame_ndarray, slot_idx) items.
    reply_queues: list of multiprocessing.Queue, indexed by slot_idx assigned to each camera.
    config:       same inference config dict used by inference_worker.

    This replaces the per-camera inference_worker thread: instead of N processes each loading
    their own InsightFace model (~880 MB each), one shared process loads it once.
    """
    device = config.get('device', 'cuda')
    det_size = tuple(config.get('det_size', (960, 960)))
    det_width, det_height = det_size
    det_thresh = float(config.get('det_thresh', 0.65))
    # Skip recognition/embedding for faces below this confidence — saves GPU matching work
    # on clearly-unknown/low-quality faces. Only watchlist-quality faces get embeddings.
    recognition_thresh = float(config.get('recognition_thresh', 0.70))
    use_letterbox = bool(config.get('use_letterbox', True))
    frame_sample_rate = int(config.get('frame_sample_rate', 2))
    max_faces_per_frame = int(config.get('max_faces_per_frame', 6))
    batch_size = int(config.get('batch_size', 10))
    batch_timeout = float(config.get('batch_timeout', 0.10))
    _camera_frame_counters: dict = {}

    # Set InsightFace model path before any import in this process.
    import os as _os
    if 'INSIGHTFACE_HOME' not in _os.environ:
        _os.environ['INSIGHTFACE_HOME'] = '/opt/iris-edge/.insightface'

    logger.info("Shared inference worker: loading InsightFace model (once for all cameras)...")
    try:
        providers = ['CUDAExecutionProvider', 'CPUExecutionProvider']
        ctx_id = 0 if device.startswith('cuda') else -1
        model = insightface.app.FaceAnalysis(
            allowed_modules=['detection', 'recognition', 'genderage'],
            providers=providers,
        )
        model.prepare(ctx_id=ctx_id, det_size=det_size, det_thresh=det_thresh)
        try:
            import onnxruntime as _ort
            active = _ort.get_available_providers()
            logger.info(f"Shared inference worker: model ready — providers: {active} | GPU: {'CUDAExecutionProvider' in active}")
        except Exception:
            logger.info("Shared inference worker: model ready.")
    except Exception as e:
        logger.error(f"Shared inference worker: fatal error loading model: {e}", exc_info=True)
        return

    while True:
        batch_data = []       # list of (camera_id, original_frame, slot_idx)
        batch_frames = []     # preprocessed frames for model.get()
        batch_transforms = [] # coordinate un-project info per frame

        batch_start = time.time()
        while len(batch_frames) < batch_size and (time.time() - batch_start) < batch_timeout:
            try:
                camera_id, frame, slot_idx = input_queue.get(block=True, timeout=0.01)

                # Frame sampling per camera
                _camera_frame_counters[camera_id] = _camera_frame_counters.get(camera_id, 0) + 1
                if frame_sample_rate > 1 and _camera_frame_counters[camera_id] % frame_sample_rate != 0:
                    continue

                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                orig_h, orig_w = frame_rgb.shape[:2]
                if orig_h == 0 or orig_w == 0:
                    continue

                if use_letterbox:
                    scale = min(det_width / orig_w, det_height / orig_h)
                    new_w = max(1, int(round(orig_w * scale)))
                    new_h = max(1, int(round(orig_h * scale)))
                    resized = cv2.resize(frame_rgb, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
                    padded = np.zeros((det_height, det_width, 3), dtype=resized.dtype)
                    pad_x = (det_width - new_w) // 2
                    pad_y = (det_height - new_h) // 2
                    padded[pad_y:pad_y + new_h, pad_x:pad_x + new_w] = resized
                    batch_frames.append(padded)
                    batch_transforms.append({
                        'mode': 'letterbox', 'scale': scale,
                        'pad_x': pad_x, 'pad_y': pad_y,
                        'orig_w': orig_w, 'orig_h': orig_h,
                    })
                else:
                    frame_resized = cv2.resize(frame_rgb, (det_width, det_height), interpolation=cv2.INTER_LINEAR)
                    batch_frames.append(frame_resized)
                    batch_transforms.append({
                        'mode': 'scale',
                        'scale_x': orig_w / det_width,
                        'scale_y': orig_h / det_height,
                        'orig_w': orig_w, 'orig_h': orig_h,
                    })

                batch_data.append((camera_id, frame, slot_idx))

            except Empty:
                if batch_frames:
                    break
                time.sleep(0.005)
                continue
            except Exception as e:
                logger.warning(f"Shared inference worker: malformed queue item: {e}")
                continue

        if not batch_frames:
            continue

        try:
            all_faces = []
            for frame_proc in batch_frames:
                faces = model.get(frame_proc)
                if len(faces) > max_faces_per_frame:
                    faces = sorted(
                        faces,
                        key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]),
                        reverse=True
                    )[:max_faces_per_frame]
                all_faces.append(faces)

            for i, (camera_id, original_frame, slot_idx) in enumerate(batch_data):
                faces = all_faces[i]
                transform = batch_transforms[i] if i < len(batch_transforms) else None
                orig_h, orig_w = original_frame.shape[:2]

                serializable_faces = []
                for face in faces:
                    if not (hasattr(face, 'bbox') and face.bbox is not None):
                        continue
                    det_bbox = face.bbox.tolist() if hasattr(face.bbox, 'tolist') else list(face.bbox)

                    if transform and transform.get('mode') == 'letterbox':
                        sc = transform['scale']
                        px, py = transform['pad_x'], transform['pad_y']
                        x1 = (det_bbox[0] - px) / sc
                        y1 = (det_bbox[1] - py) / sc
                        x2 = (det_bbox[2] - px) / sc
                        y2 = (det_bbox[3] - py) / sc
                    else:
                        sx = transform['scale_x'] if transform else 1.0
                        sy = transform['scale_y'] if transform else 1.0
                        x1 = det_bbox[0] * sx
                        y1 = det_bbox[1] * sy
                        x2 = det_bbox[2] * sx
                        y2 = det_bbox[3] * sy

                    pad_x_frac = (x2 - x1) * 0.2
                    pad_y_frac = (y2 - y1) * 0.2
                    x1 = max(0.0, min(float(orig_w), x1 - pad_x_frac))
                    y1 = max(0.0, min(float(orig_h), y1 - pad_y_frac))
                    x2 = max(0.0, min(float(orig_w), x2 + pad_x_frac))
                    y2 = max(0.0, min(float(orig_h), y2 + pad_y_frac))

                    # Skip embedding for faces below the recognition confidence threshold.
                    det_score = float(face.det_score) if hasattr(face, 'det_score') else 1.0
                    skip_embedding = (det_score < recognition_thresh)

                    serializable_faces.append({
                        'bbox': [x1, y1, x2, y2],
                        'det_score': det_score if hasattr(face, 'det_score') else None,
                        'landmark': face.landmark.tolist() if hasattr(face, 'landmark') and face.landmark is not None else None,
                        'embedding': None if skip_embedding else (face.embedding.tolist() if hasattr(face, 'embedding') and face.embedding is not None else None),
                        'embedding_norm': None if skip_embedding else (float(face.embedding_norm) if hasattr(face, 'embedding_norm') else None),
                        'age': int(face.age) if hasattr(face, 'age') and face.age is not None else None,
                        'gender': int(face.gender) if hasattr(face, 'gender') and face.gender is not None else None,
                    })

                if 0 <= slot_idx < len(reply_queues):
                    try:
                        reply_queues[slot_idx].put_nowait((camera_id, original_frame, serializable_faces))
                    except Exception:
                        pass  # drop result if camera's reply queue is full

        except Exception as e:
            logger.error(f"Shared inference worker: batch error: {e}", exc_info=True)
