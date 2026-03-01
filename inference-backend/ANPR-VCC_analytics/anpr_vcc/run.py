#!/usr/bin/env python3
"""
ANPR/VCC Pipeline — Entry Point
Uses the common process orchestrator to poll IRIS API for camera configs.
"""

import sys
from pathlib import Path
from multiprocessing import Queue, Event
from datetime import datetime

# inference-backend root → common package
repo_root = str(Path(__file__).resolve().parent.parent.parent)
if repo_root not in sys.path:
    sys.path.insert(0, repo_root)

# ANPR-VCC_analytics root → anpr_vcc package
anpr_root = str(Path(__file__).resolve().parent.parent)
if anpr_root not in sys.path:
    sys.path.insert(0, anpr_root)

from common.iris_env import load_iris_environment
load_iris_environment()

from common.config_manager import AnalyticsConfigManager


def camera_worker_function(camera_config: dict, result_queue: Queue, stop_event: Event):
    """Worker process for a single ANPR/VCC camera."""
    import logging
    import time

    # Re-add paths in worker subprocess
    repo_root = str(Path(__file__).resolve().parent.parent.parent)
    anpr_root = str(Path(__file__).resolve().parent.parent)
    for p in (repo_root, anpr_root):
        if p not in sys.path:
            sys.path.insert(0, p)

    load_iris_environment()

    camera_id = camera_config.get("camera_id", "unknown")
    logger = logging.getLogger(f"anpr_worker_{str(camera_id)[:8]}")
    logger.info(f"ANPR worker started for camera {camera_id}")

    try:
        from anpr_vcc.pipeline import VCCAnprPipeline

        pipeline = VCCAnprPipeline(
            camera_id=camera_id,
            camera_name=camera_config.get("name", str(camera_id)),
        )

        rtsp_url = camera_config["rtsp_url"]

        while not stop_event.is_set():
            try:
                logger.info(f"Connecting to {rtsp_url}")
                pipeline.run_on_stream(rtsp_url)
            except KeyboardInterrupt:
                break
            except Exception as e:
                logger.error(f"Stream error: {e}")
                if stop_event.wait(5):
                    break

    except Exception as e:
        logger.error(f"ANPR worker error: {e}")
        try:
            result_queue.put({
                "type": "error",
                "camera_id": camera_id,
                "error": str(e),
                "timestamp": datetime.now().isoformat(),
            })
        except Exception:
            pass
    finally:
        logger.info(f"ANPR worker ended for camera {camera_id}")


def main():
    load_iris_environment()

    main_func = AnalyticsConfigManager.create_main_function(
        worker_function=camera_worker_function,
        pipeline_type="anpr-vcc",
        default_analytic_code="anpr-vcc",
        script_path=__file__,
    )
    main_func()


if __name__ == "__main__":
    exit(main())
