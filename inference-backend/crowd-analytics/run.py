#!/usr/bin/env python3
"""
Crowd Analytics Pipeline — Standalone Entry Point
Uses the common process orchestrator for stable multi-camera processing
"""

import sys
from pathlib import Path
from multiprocessing import Queue, Event
from datetime import datetime
import argparse

# Add inference-backend root so shared `common` package is importable.
repo_root = str(Path(__file__).resolve().parent.parent)
if repo_root not in sys.path:
    sys.path.insert(0, repo_root)

# Load IRIS environment variables first
from common.iris_env import load_iris_environment
load_iris_environment()

from common.config_manager import AnalyticsConfigManager


def camera_worker_function(camera_config: dict, result_queue: Queue, stop_event: Event):
    """
    Worker function for a single camera process.
    This runs in a separate process for each camera.
    """
    import logging

    # Re-add repo root in worker subprocess (sys.path is not inherited)
    repo_root = str(Path(__file__).resolve().parent.parent)
    if repo_root not in sys.path:
        sys.path.insert(0, repo_root)

    from pipeline import RTSPAnalyticsPipeline

    try:
        # Load IRIS environment in worker process
        load_iris_environment()

        logger = logging.getLogger(f'crowd_worker_{camera_config.get("camera_id", "unknown")[:8]}')
        logger.info(f"Camera worker process started for {camera_config.get('camera_id', 'unknown')}")

        # Initialize the pipeline
        pipeline = RTSPAnalyticsPipeline(
            name=camera_config['name'],
            rtsp_url=camera_config['rtsp_url'],
            camera_id=camera_config['camera_id'],
            location_id=camera_config['location_id'],
            interval=camera_config.get('interval', 5),
            model_size=camera_config['model_size'],
            confidence=camera_config['confidence'],
            skip_frames=camera_config.get('skip_frames', 1),
            fps=camera_config.get('fps', 30),
            api_base_url=camera_config.get('api_base_url'),
            api_token=camera_config.get('api_token'),
            rtsp_transport=camera_config.get('rtsp_transport', 'tcp'),
            buffer_size=camera_config.get('buffer_size', 5)
        )

        # Run pipeline with stop event monitoring
        if hasattr(pipeline, 'run_with_stop_event'):
            pipeline.run_with_stop_event(stop_event)
        else:
            # Fallback: monitor stop_event in a loop
            logger.warning("Pipeline doesn't support run_with_stop_event, using fallback method")
            while not stop_event.is_set():
                try:
                    pipeline.run()
                    if stop_event.wait(1):
                        break
                except Exception as e:
                    logger.error(f"Pipeline error: {e}")
                    if stop_event.wait(5):
                        break

    except Exception as e:
        logger = logging.getLogger(f'crowd_worker_{camera_config.get("camera_id", "unknown")[:8]}')
        logger.error(f"Camera worker error: {e}")

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
        logger = logging.getLogger(f'crowd_worker_{camera_config.get("camera_id", "unknown")[:8]}')
        logger.info(f"Camera worker process ended for {camera_config.get('camera_id', 'unknown')}")


def main():
    """
    Main function to run the crowd analytics orchestrator.
    """
    load_iris_environment()

    main_func = AnalyticsConfigManager.create_main_function(
        worker_function=camera_worker_function,
        pipeline_type="crowd-analytics",
        default_analytic_code="crowd-counting",
        script_path=__file__
    )

    main_func()


if __name__ == "__main__":
    exit(main())
