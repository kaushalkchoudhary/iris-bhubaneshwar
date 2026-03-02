#!/usr/bin/env python3
"""
FRS (Face Recognition System) Pipeline — Standalone Entry Point
Uses the common process orchestrator for stable multi-camera processing.
"""

import logging
import sys
import os
import time
import threading
from pathlib import Path
from multiprocessing import Queue, Event
from datetime import datetime
from typing import List, Union, Tuple
import numpy as np
import cv2

# ── Path setup: add shared root and this directory ──────────────────────────
_frs_dir = Path(__file__).parent
_repo_root = _frs_dir.parent

for _p in [str(_frs_dir), str(_repo_root)]:
    if _p not in sys.path:
        sys.path.insert(0, _p)

# ── Imports from shared common/ ────────────────────────────────────────────────
from common.iris_env import load_iris_environment
from common.config_manager import AnalyticsConfigManager
from common.common_types import FrameQueueItem

# ── Local FRS imports ──────────────────────────────────────────────────────────
from frs_types import InferenceFaceData, ErrorResult
from websocket_client import create_live_preview_client

# ── Logging setup ──────────────────────────────────────────────────────────────
class ColoredFormatter(logging.Formatter):
    grey     = "\x1b[38;20m"
    blue     = "\x1b[34;20m"
    green    = "\x1b[32;20m"
    yellow   = "\x1b[33;20m"
    red      = "\x1b[31;20m"
    bold_red = "\x1b[31;1m"
    reset    = "\x1b[0m"
    fmt      = "%(asctime)s | %(levelname)s | %(name)s | %(filename)s:%(lineno)d | %(message)s"

    FORMATS = {
        logging.DEBUG:    grey     + fmt + reset,
        logging.INFO:     green    + fmt + reset,
        logging.WARNING:  yellow   + fmt + reset,
        logging.ERROR:    red      + fmt + reset,
        logging.CRITICAL: bold_red + fmt + reset,
    }

    def format(self, record):
        return logging.Formatter(self.FORMATS.get(record.levelno), datefmt='%Y-%m-%d %H:%M:%S').format(record)


root_logger = logging.getLogger()
root_logger.setLevel(logging.INFO)
root_logger.handlers = []
_ch = logging.StreamHandler()
_ch.setLevel(logging.INFO)
_ch.setFormatter(ColoredFormatter())
root_logger.addHandler(_ch)

# Suppress noisy third-party loggers
for _noisy in ["urllib3", "requests", "onnxruntime", "insightface", "matplotlib"]:
    logging.getLogger(_noisy).setLevel(logging.WARNING)
logging.getLogger("onnxruntime").setLevel(logging.ERROR)
logging.getLogger("insightface").setLevel(logging.ERROR)


# ── Camera worker ──────────────────────────────────────────────────────────────

def camera_worker_function(camera_config: dict, result_queue: Queue, stop_event: Event):
    """
    Worker function for a single camera process.
    Runs in a separate process per camera for face recognition.
    """
    import logging
    import torch

    # Re-add paths in the spawned subprocess (sys.path not inherited)
    _frs = Path(__file__).parent
    for _p in [str(_frs), str(_frs.parent)]:
        if _p not in sys.path:
            sys.path.insert(0, _p)

    from common.frame_grabber import FrameGrabber
    from inference_worker import inference_worker
    from api_reporter import api_reporter as frs_api_reporter
    from watchlist_manager import WatchlistManager
    from websocket_client import create_live_preview_client
    from queue import Queue as ThreadQueue

    try:
        load_iris_environment()

        # Ensure InsightFace finds the pre-cached model, not ~/root/.insightface (empty).
        # Must be set before any insightface import in this subprocess.
        import os as _os
        if 'INSIGHTFACE_HOME' not in _os.environ:
            _os.environ['INSIGHTFACE_HOME'] = '/opt/iris-edge/.insightface'

        logger = logging.getLogger(f'frs_worker_{camera_config.get("camera_id", "unknown")[:8]}')
        logger.info(f"FRS worker started for {camera_config.get('camera_id', 'unknown')}")

        # GPU selection — prefer CUDAExecutionProvider via onnxruntime (works even
        # if torch is CPU-only, as InsightFace uses ONNX Runtime directly).
        try:
            import onnxruntime as _ort
            _avail = _ort.get_available_providers()
            if 'CUDAExecutionProvider' in _avail:
                device = 'cuda:0'
                logger.info(f"Using GPU (CUDAExecutionProvider) for camera {camera_config['name']}")
            else:
                device = 'cpu'
                logger.info(f"GPU not available (ort providers: {_avail}), using CPU for {camera_config['name']}")
        except Exception as _e:
            device = 'cpu'
            logger.warning(f"Could not query onnxruntime providers ({_e}), using CPU for {camera_config['name']}")

        # Internal thread queues — keep small to avoid accumulating large frames in RAM.
        # Each frame is ~2-3 MB (960px-wide resized, ~3 channels); 4 slots ≈ ~12 MB per queue.
        frames_queue: ThreadQueue = ThreadQueue(maxsize=4)
        # Inference output is fanned out so API reporting and live preview both receive every result.
        results_queue: ThreadQueue = ThreadQueue(maxsize=4)
        # Reporter queue: HTTP requests can be slow; allow a short backlog.
        reporter_queue: ThreadQueue = ThreadQueue(maxsize=6)
        preview_queue: ThreadQueue = ThreadQueue(maxsize=4)
        # Raw frames queue — receives every frame from FrameGrabber, bypasses frame_skip.
        # maxsize=2 so we always drain to the LATEST frame (stale frames are dropped
        # by FrameGrabber's put_nowait when full).
        raw_frames_queue: ThreadQueue = ThreadQueue(maxsize=2)
        # Shared state: latest face detections for drawing bbox overlay on raw frames.
        _detection_state: dict = {'faces': [], 'ts': 0.0}
        _detection_lock = threading.Lock()
        input_queues = [frames_queue]

        # Per-camera analytic config helper
        analytic_cfg = camera_config.get('analytic_config', {})

        def cfg(key, default=None):
            if key in analytic_cfg:
                return analytic_cfg.get(key)
            if key in camera_config:
                return camera_config.get(key)
            return default

        # Inference config
        inference_config = {
            'device': device,
            'det_size': cfg('det_size', [640, 640]),
            'det_thresh': cfg('det_thresh', 0.65),
            'use_letterbox': cfg('use_letterbox', True),
            'batch_size': cfg('batch_size', 10),
            'batch_timeout': cfg('batch_timeout', 0.5),
            'log_file': None  # No per-camera file logs — all output goes to stdout/journald
        }

        # API reporter config
        api_config = {
            'base_url': camera_config.get('api_base_url', 'http://localhost:3002/api'),
            'token': camera_config.get('api_token'),
            'confidence_threshold': cfg('confidence_threshold', 0.6),
            'face_area_threshold': cfg('face_area_threshold', 1024),
            'jpeg_quality': cfg('jpeg_quality', 90),
            'full_frame_resize_height': cfg('full_frame_resize_height', 1080),
            'similarity_threshold': cfg('similarity_threshold', 0.65),
            'duplicate_short_window': cfg('duplicate_short_window', 30.0),
            'duplicate_long_window': cfg('duplicate_long_window', 300.0),
            'max_tracked_faces': cfg('max_tracked_faces', 200),
            'match_threshold': cfg('match_threshold', 0.35),
            'only_watchlist_matches': cfg('only_watchlist_matches', False)
        }

        # Watchlist manager (shared between inference + reporter)
        watchlist_manager = WatchlistManager(api_config)

        def watchlist_updater():
            while not stop_event.is_set():
                try:
                    watchlist_manager.update()
                except Exception as e:
                    logger.debug(f"Watchlist update error: {e}")
                # update() internally rate-limits: version check every 5s, full fetch on change.
                # Sleep 1s here so we call it frequently enough to honour that 5s cadence.
                stop_event.wait(1.0)

        threading.Thread(target=watchlist_updater, daemon=True, name="WatchlistUpdater").start()

        # Single WebSocket client per camera:
        # - raw frames (0x01) at up to 30 FPS via raw_stream_sender (with bbox overlay when detected)
        # - detection JSON (0x02) at inference rate via detection_sender_worker
        # Both share one connection.
        websocket_server_url = camera_config.get('websocket_server_url', 'http://localhost:3002')
        preview_client = create_live_preview_client(
            camera_id=camera_config['camera_id'],
            server_url=websocket_server_url,
            max_fps=20,  # Reduced from 30 — biggest CPU sink was JPEG encoding at 30fps
            frame_resize_height=240,
        )

        # Camera configs for API reporter
        face_recognition_configs = {
            camera_config['camera_id']: {
                'camera_id': camera_config['camera_id'],
                'name': camera_config['name'],
                'rtsp_url': camera_config['rtsp_url'],
                'location_id': camera_config['location_id'],
                'assignment_id': camera_config.get('assignment_id'),
                'analytic_config': camera_config.get('analytic_config', {})
            }
        }

        # Start inference thread
        inference_thread = threading.Thread(
            target=inference_worker,
            args=(input_queues, results_queue, inference_config, watchlist_manager),
            daemon=True,
            name=f"InferenceWorker-{camera_config['camera_id'][:8]}"
        )
        inference_thread.start()
        logger.info(f"Started inference thread for {camera_config['name']}")

        def result_fanout_worker():
            while not stop_event.is_set():
                try:
                    item = results_queue.get(timeout=1.0)
                except Exception:
                    continue

                # Reporter queue is loss-sensitive, so block briefly before dropping.
                try:
                    reporter_queue.put(item, timeout=0.5)
                except Exception:
                    logger.warning(f"[{camera_config['name']}] Reporter queue full, dropping one result")

                # Preview queue is best-effort; skip if backpressured.
                try:
                    preview_queue.put_nowait(item)
                except Exception:
                    pass

        threading.Thread(
            target=result_fanout_worker,
            daemon=True,
            name=f"ResultFanout-{camera_config['camera_id'][:8]}"
        ).start()

        # Start API reporter thread
        reporter_thread = threading.Thread(
            target=frs_api_reporter,
            args=(reporter_queue, api_config, face_recognition_configs, watchlist_manager),
            daemon=True,
            name=f"ApiReporter-{camera_config['camera_id'][:8]}"
        )
        reporter_thread.start()
        logger.info(f"Started API reporter thread for {camera_config['name']}")

        # Thread 1: Raw stream sender — sends raw JPEG frames at up to 30 FPS.
        # Always drains to the LATEST frame (stale frames are discarded).
        # No CV processing on the JPEG — bbox coords are sent as 0x02 JSON so
        # the frontend can draw overlays itself.
        def raw_stream_sender():
            from queue import Empty as _Empty
            import time as _t
            frame_interval = 1.0 / 20  # 50 ms per frame (reduced from 30 fps to cut CPU)
            next_send = _t.monotonic()
            try:
                while not stop_event.is_set():
                    now = _t.monotonic()
                    wait = next_send - now
                    if wait > 0.002:
                        # Sleep in small steps so stop_event is checked regularly.
                        stop_event.wait(min(wait, 0.010))
                        continue

                    # Drain queue: keep only the most recent frame.
                    latest = None
                    try:
                        latest = raw_frames_queue.get_nowait()
                        while True:
                            try:
                                latest = raw_frames_queue.get_nowait()
                            except _Empty:
                                break
                    except _Empty:
                        pass

                    if latest is not None:
                        _cam_id, frame = latest
                        # We don't want bbox overlay on live feed to save frontend compute and because of FPS mismatch.
                        preview_client.send_frame(frame, detections=None)
                        next_send = _t.monotonic() + frame_interval
                    else:
                        # No frame available yet — retry in 5 ms.
                        next_send = _t.monotonic() + 0.005
            except Exception as e:
                logger.error(f"Raw stream sender error for {camera_config['name']}: {e}")

        threading.Thread(target=raw_stream_sender, daemon=True,
                         name=f"RawSender-{camera_config['camera_id'][:8]}").start()

        # Thread 2: Detection state updater — filters inference results and updates
        # the shared bbox state that raw_stream_sender reads on every frame.
        # 0x02 detection JSON is sent by raw_stream_sender (piggybacked on each
        # 0x01 frame) with correctly scaled coords — no separate send needed here.
        def detection_sender_worker():
            try:
                while not stop_event.is_set():
                    try:
                        camera_id, frame, faces = preview_queue.get(timeout=1.0)
                        confidence_threshold = api_config.get('confidence_threshold', 0.6)
                        face_area_threshold = api_config.get('face_area_threshold', 1024)
                        valid_faces = []
                        if faces:
                            for face in faces:
                                face_confidence = face.get('det_score', 0.0)
                                bbox = face.get('bbox', [0, 0, 0, 0])
                                fx1, fy1, fx2, fy2 = bbox
                                face_area = (fx2 - fx1) * (fy2 - fy1)
                                face_area_score = 1 if face_area > face_area_threshold else 0
                                if (face_confidence * face_area_score) >= confidence_threshold:
                                    valid_faces.append(face)
                        # Update shared state — raw_stream_sender reads this to include
                        # bbox coords in the next 0x02 message (clears when faces=[]).
                        with _detection_lock:
                            _detection_state['faces'] = valid_faces
                            _detection_state['ts'] = time.time()
                    except Exception:
                        pass
            except Exception as e:
                logger.error(f"Detection sender error for {camera_config['name']}: {e}")

        threading.Thread(target=detection_sender_worker, daemon=True,
                         name=f"DetSender-{camera_config['camera_id'][:8]}").start()

        # Frame grabber
        # output_queues → inference pipeline (1-in-N frames via frame_skip)
        # raw_output_queues → raw live stream (every frame, no skip)
        frame_grabber = FrameGrabber(
            name=camera_config['camera_id'],
            video_source=camera_config['rtsp_url'],
            output_queues=[frames_queue],
            raw_output_queues=[raw_frames_queue],
            rtsp_transport=cfg('rtsp_transport', 'tcp'),
            buffer_size=cfg('buffer_size', 10),
            frame_skip=cfg('skip_frames', 6),
            resize_width=cfg('resize_width', 960)  # Limit frame width at source to reduce RAM
        )

        frame_grabber.start()
        logger.info(f"Frame grabber started for {camera_config['name']}")

        # Monitor threads until stop event
        while not stop_event.is_set():
            if not inference_thread.is_alive():
                logger.error("Inference thread died, stopping worker")
                break
            if not reporter_thread.is_alive():
                logger.error("Reporter thread died, stopping worker")
                break
            if hasattr(frame_grabber, 'thread') and frame_grabber.thread and not frame_grabber.thread.is_alive():
                logger.error("Frame grabber thread died, stopping worker")
                break
            if stop_event.wait(5):
                break

        # Cleanup
        logger.info(f"Stopping FRS worker for {camera_config['name']}")
        frame_grabber.stop()
        try:
            preview_client.disconnect()
        except Exception as e:
            logger.error(f"Error disconnecting WebSocket for {camera_config['name']}: {e}")

    except Exception as e:
        logger = logging.getLogger(f'frs_worker_{camera_config.get("camera_id", "unknown")[:8]}')
        logger.error(f"FRS worker error: {e}")
        try:
            result_queue.put({
                'type': 'error',
                'camera_id': camera_config.get('camera_id', 'unknown'),
                'error': str(e),
                'timestamp': datetime.now().isoformat()
            })
        except Exception:
            pass
    finally:
        logger = logging.getLogger(f'frs_worker_{camera_config.get("camera_id", "unknown")[:8]}')
        logger.info(f"FRS worker process ended for {camera_config.get('camera_id', 'unknown')}")


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    """Main function to run the FRS orchestrator."""
    load_iris_environment()

    import argparse
    import yaml

    parser = argparse.ArgumentParser(description='FRS Pipeline Orchestrator')
    script_dir = Path(__file__).parent
    default_config = script_dir / 'config.yaml'

    parser.add_argument('--config', default=str(default_config), help='Path to YAML configuration file')
    parser.add_argument('--local-only', action='store_true', help='Use only local config.yaml sources (skip API fetch)')
    parser.add_argument('--api-base-url', default=os.getenv('IRIS_API_BASE_URL', 'http://localhost:3002/api'))

    args, unknown = parser.parse_known_args()

    analytic_code = "A-6"

    force_api_mode = str(os.getenv('FRS_FORCE_API', '')).lower() in ('1', 'true', 'yes', 'on')

    # Allow config.yaml to set local_only: true unless force API mode is enabled
    try:
        with open(args.config, 'r') as f:
            file_config = yaml.safe_load(f) or {}
        if not force_api_mode and file_config.get('local_only') is True:
            args.local_only = True
    except Exception as e:
        logging.warning(f"Failed to read config for local_only: {e}")

    if force_api_mode:
        args.local_only = False
        os.environ['FRS_LOCAL_ONLY'] = 'false'
        logging.info("FRS_FORCE_API enabled — using backend API camera configuration only.")

    if args.local_only or os.getenv('FRS_LOCAL_ONLY') == 'true':
        analytic_code = None
        os.environ['FRS_LOCAL_ONLY'] = 'true'
        logging.info("Running in LOCAL-ONLY mode — using config.yaml sources only.")

    # Remove --local-only so create_main_function's argparse doesn't choke on it
    sys.argv = [a for a in sys.argv if a != '--local-only']

    main_func = AnalyticsConfigManager.create_main_function(
        worker_function=camera_worker_function,
        pipeline_type="frs-analytics",
        default_analytic_code=analytic_code,
        script_path=__file__
    )

    main_func()


if __name__ == "__main__":
    exit(main())
