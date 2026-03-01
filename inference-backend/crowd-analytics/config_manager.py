#!/usr/bin/env python3
"""
Configuration Manager for Crowd Analytics Pipeline
Fetches configuration from API and converts it to the format expected by run.py
"""

import requests
import yaml
import json
import os
import sys
from pathlib import Path
import logging
from typing import Dict, List, Optional, Any, TypedDict, Union


# Type definitions for API response structure
class LocationConfig(TypedDict):
    id: str
    name: str

class AnalyticsConfig(TypedDict):
    analyticCode: str
    config: Dict[str, Any]

class CameraConfig(TypedDict):
    id: str
    name: str
    rtspUrl: str
    location: LocationConfig
    analytics: List[AnalyticsConfig]

class ApiResponse(TypedDict):
    status: str
    data: List[CameraConfig]
    message: Optional[str]

class RtspSource(TypedDict):
    name: str
    camera_id: str
    rtsp_url: str
    location_id: str
    model_size: str
    confidence: float
    fps: int
    skip_frames: int
    rtsp_transport: str
    buffer_size: int
    interval: int
    api_base_url: Optional[str]
    api_token: Optional[str]

class PipelineRunnerConfig(TypedDict):
    rtsp_sources: List[RtspSource]
    api_base_url: Optional[str]
    api_token: Optional[str]


def setup_logging() -> logging.Logger:
    logger = logging.getLogger("config_manager")
    logger.setLevel(logging.INFO)
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)
    return logger


class ConfigManager:
    """
    Manages configuration for the crowd analytics pipeline by fetching from API
    and converting to the format expected by run.py
    """

    def __init__(self, api_base_url: Optional[str] = None, api_token: Optional[str] = None,
                 analytic_code: str = "crowd-counting", config_path: Optional[Union[str, Path]] = None):
        self.logger = setup_logging()

        script_dir = Path(__file__).parent

        if not config_path:
            config_path = script_dir / 'config.yaml'

        self.config_path = str(config_path) if isinstance(config_path, Path) else config_path
        self.analytic_code = analytic_code

        # Load API creds from local config if not provided
        if not api_base_url or not api_token:
            try:
                with open(self.config_path, 'r') as f:
                    local_config = yaml.safe_load(f)
                api_base_url = api_base_url or local_config.get('api_base_url')
                api_token = api_token or local_config.get('api_token')
            except Exception as e:
                self.logger.error(f"Error loading local config: {e}")

        if api_base_url and api_base_url.endswith('/'):
            api_base_url = api_base_url.rstrip('/')

        self.api_base_url = api_base_url
        self.api_token = api_token

        if not self.api_base_url or not self.api_token:
            self.logger.warning("API base URL or token not provided. Will use local config only.")

    def fetch_api_config(self) -> Optional[ApiResponse]:
        if not self.api_base_url or not self.api_token:
            self.logger.error("Cannot fetch API config: API base URL or token not provided")
            return None

        try:
            api_url = f"{self.api_base_url}/analytics/worker-configs"
            if self.analytic_code:
                api_url += f"?analyticCode={self.analytic_code}"

            headers = {
                'Authorization': f'Bearer {self.api_token}',
                'Content-Type': 'application/json'
            }

            self.logger.info(f"Fetching configuration from API: {api_url}")
            response = requests.get(api_url, headers=headers, timeout=10)

            if response.status_code == 200:
                return response.json()
            else:
                self.logger.error(f"API request failed with status {response.status_code}: {response.text}")
                return None

        except Exception as e:
            self.logger.error(f"Error fetching API config: {e}")
            return None

    def convert_api_config(self, api_config: ApiResponse) -> PipelineRunnerConfig:
        try:
            output_config: PipelineRunnerConfig = {
                "rtsp_sources": [],
                "api_base_url": self.api_base_url,
                "api_token": self.api_token
            }

            if not api_config.get("status") == "success" or "data" not in api_config:
                self.logger.error("API response does not have expected structure")
                return output_config

            for camera_config in api_config["data"]:
                crowd_analytics = None
                for analytics in camera_config.get("analytics", []):
                    if analytics.get("analyticCode") == self.analytic_code:
                        crowd_analytics = analytics
                        break

                if not crowd_analytics:
                    self.logger.warning(f"No {self.analytic_code} analytics found for camera {camera_config.get('name')}")
                    continue

                rtsp_source: RtspSource = {
                    "name": camera_config.get("name", "Camera"),
                    "camera_id": camera_config.get("id", ""),
                    "rtsp_url": camera_config.get("rtspUrl", ""),
                    "location_id": camera_config.get("location", {}).get("id", ""),
                    "model_size": "crowd-counting-8hvzc-pvx6p-1.pt",
                    "confidence": crowd_analytics.get("config", {}).get("minimumConfidence", 0.1),
                    "fps": 15,
                    "skip_frames": 4,
                    "rtsp_transport": "tcp",
                    "buffer_size": 10,
                    "interval": crowd_analytics.get("config", {}).get("updateInterval", 5),
                    "api_base_url": self.api_base_url,
                    "api_token": self.api_token
                }

                output_config["rtsp_sources"].append(rtsp_source)

            return output_config

        except Exception as e:
            self.logger.error(f"Error converting API config: {e}")
            return PipelineRunnerConfig(
                rtsp_sources=[],
                api_base_url=self.api_base_url,
                api_token=self.api_token
            )

    def load_local_config(self) -> PipelineRunnerConfig:
        try:
            with open(self.config_path, 'r') as f:
                return yaml.safe_load(f)
        except Exception as e:
            self.logger.error(f"Error loading local config: {e}")
            return PipelineRunnerConfig(
                rtsp_sources=[],
                api_base_url=self.api_base_url,
                api_token=self.api_token
            )

    def get_config(self) -> PipelineRunnerConfig:
        api_config = self.fetch_api_config()

        if api_config:
            self.logger.info("Successfully fetched configuration from API")
            config = self.convert_api_config(api_config)

            try:
                with open(Path(self.config_path).parent / 'last_api_config.yaml', 'w') as f:
                    yaml.dump(config, f, default_flow_style=False)
                self.logger.info("Saved API config to last_api_config.yaml")
            except Exception as e:
                self.logger.warning(f"Could not save API config to file: {e}")

            return config

        self.logger.warning("Falling back to local configuration")
        return self.load_local_config()


if __name__ == "__main__":
    config_manager = ConfigManager()
    config = config_manager.get_config()
    print(json.dumps(config, indent=2))
