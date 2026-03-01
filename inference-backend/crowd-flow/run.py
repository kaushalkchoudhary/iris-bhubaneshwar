#!/usr/bin/env python3
"""
Crowd Flow Analytics Pipeline — Standalone Entry Point
Tracks people crossing a virtual line (entry/exit) per camera.
Uses the common process orchestrator for stable multi-camera processing.
"""

import sys
from pathlib import Path
from multiprocessing import Queue, Event
from datetime import datetime

# Add inference-backend root so shared `common` package is importable
repo_root = str(Path(__file__).resolve().parent.parent)
if repo_root not in sys.path:
    sys.path.insert(0, repo_root)

from common.iris_env import load_iris_environment
load_iris_environment()

from common.config_manager import AnalyticsConfigManager


def camera_worker_function(camera_config: dict, result_queue: Queue, stop_event: Event):
    """Worker function — runs in a separate process per camera."""
    import logging

    repo_root = str(Path(__file__).resolve().parent.parent)
    if repo_root not in sys.path:
        sys.path.insert(0, repo_root)

    # Add crowd-flow dir so pipeline.py is importable in subprocess
    crowd_flow_dir = str(Path(__file__).resolve().parent)
    if crowd_flow_dir not in sys.path:
        sys.path.insert(0, crowd_flow_dir)

    from pipeline import CrowdFlowPipeline

    try:
        load_iris_environment()

        logger = logging.getLogger(f'crowd_flow_{camera_config.get("camera_id", "unknown")[:8]}')
        logger.info(f"Crowd-flow worker started for {camera_config.get('camera_id', 'unknown')}")

        # Force the crowd-flow model
        camera_config.setdefault('model_size', 'crowd-counting-8hvzc-pvx6p-1.pt')

        # line_position: fraction of frame height where the crossing line is drawn (default: 50%)
        line_position = camera_config.get('analytic_config', {}).get('line_position', 0.5)

        pipeline = CrowdFlowPipeline(
            name=camera_config['name'],
            rtsp_url=camera_config['rtsp_url'],
            camera_id=camera_config['camera_id'],
            location_id=camera_config['location_id'],
            interval=camera_config.get('interval', 5),
            model_size=camera_config['model_size'],
            confidence=camera_config.get('confidence', 0.2),
            skip_frames=camera_config.get('skip_frames', 2),
            fps=camera_config.get('fps', 30),
            api_base_url=camera_config.get('api_base_url'),
            api_token=camera_config.get('api_token'),
            rtsp_transport=camera_config.get('rtsp_transport', 'tcp'),
            buffer_size=camera_config.get('buffer_size', 5),
            line_position=line_position,
        )

        pipeline.run_with_stop_event(stop_event)

    except Exception as e:
        logger = logging.getLogger(f'crowd_flow_{camera_config.get("camera_id", "unknown")[:8]}')
        logger.error(f"Crowd-flow worker error: {e}")
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
        logger = logging.getLogger(f'crowd_flow_{camera_config.get("camera_id", "unknown")[:8]}')
        logger.info(f"Crowd-flow worker ended for {camera_config.get('camera_id', 'unknown')}")


def main():
    load_iris_environment()

    main_func = AnalyticsConfigManager.create_main_function(
        worker_function=camera_worker_function,
        pipeline_type="crowd-flow",
        default_analytic_code="crowd-flow",
        script_path=__file__
    )

    main_func()


if __name__ == "__main__":
    exit(main())
