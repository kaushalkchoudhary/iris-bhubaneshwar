#!/usr/bin/env python3
"""
Enhanced Configuration Manager for Analytics Pipelines
Handles API-based configuration fetching with fallback to local files
"""

import os
import json
import yaml
import time
import requests
import logging
import argparse
import signal
import sys
import traceback
import threading
from pathlib import Path
from typing import Dict, List, Optional, Callable
from datetime import datetime; import time
from urllib.parse import urljoin

from common.iris_env import load_iris_environment
from common.process_orchestrator import GenericPipelineOrchestrator, signal_handler

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
)
logger = logging.getLogger('analytics_config_manager')

class AnalyticsConfigManager:
    """
    Enhanced configuration manager with orchestration capabilities.
    Manages analytics configuration from the API and supports process-based pipeline management.
    """

    def __init__(self, config_path: str = None, api_base_url: str = None, api_token: str = None, analytic_code: str = None):
        """
        Initialize the Analytics Configuration Manager
        
        Args:
            config_path: Path to local config file
            api_base_url: Override API base URL (defaults to http://localhost:3000/api)
            api_token: Override API token (auto-detected from environment or config file)
            analytic_code: Analytics code to filter configurations
        """
        # Load environment first
        load_iris_environment()
        
        # Set default config path
        if config_path is None:
            config_path = 'config.yaml'
        
        # Load base configuration
        if os.path.exists(config_path):
            with open(config_path, 'r') as f:
                self.config = yaml.safe_load(f)
            logger.debug(f"Loaded base configuration from {os.path.abspath(config_path)}")
        else:
            self.config = {}
            logger.warning(f"Config file not found: {config_path}, using defaults")
        
        # Set API parameters with defaults
        self.base_url = api_base_url or os.getenv('IRIS_API_BASE_URL', 'http://localhost:3002/api')
        self.token = api_token or self._read_server_token()
        self.analytic_code = analytic_code
        
        logger.debug(f"🌐 Using API base URL: {self.base_url}")
        
        # Session for API requests
        self.session = requests.Session()
        if self.token:
            self.session.headers.update({
                'Authorization': f'Bearer {self.token}',
                'Content-Type': 'application/json'
            })

    def _read_server_token(self) -> str:
        """
        Read the server token from ~/.iris/config.json file and set as environment variable.
        
        Returns:
            str: Server token from config file
        """
        try:
            # Check if token is already in environment
            env_token = os.environ.get('IRIS_SERVER_TOKEN')
            if env_token:
                logger.info("Using IRIS server token from environment variable")
                return env_token
            
            # Get home directory and construct path to iris config
            home_dir = os.path.expanduser("~")
            iris_config_path = os.path.join(home_dir, '.iris', 'config.json')
            
            if not os.path.exists(iris_config_path):
                logger.warning(f"IRIS config file not found at: {iris_config_path}")
                logger.warning("Proceeding without IRIS server token; API config fetch may fail and local/default config will be used.")
                return ""
            
            # Read the config file
            with open(iris_config_path, 'r') as f:
                config_data = json.load(f)
            
            server_token = config_data.get('serverToken')
            if not server_token:
                logger.warning("Server token not found in IRIS config file; proceeding without token")
                return ""
            
            # Set as environment variable for other processes
            os.environ['IRIS_SERVER_TOKEN'] = server_token
            logger.info("Successfully read server token from IRIS config and set environment variable")
            
            return server_token

        except json.JSONDecodeError as e:
            logger.error(f"Error parsing IRIS config JSON: {e}")
            return ""
        except Exception as e:
            logger.error(f"Error reading server token: {e}")
            return ""
        
    def _load_base_config(self) -> Dict:
        """
        Load the base configuration file.
        
        Returns:
            Dict: Configuration dictionary
        """
        try:
            with open(self.config_path, 'r') as f:
                config = yaml.safe_load(f)
                logger.info(f"Loaded base configuration from {self.config_path}")
                return config
        except Exception as e:
            logger.error(f"Error loading configuration: {e}")
            sys.exit(1)

    def fetch_worker_own_config(self) -> Optional[List[Dict]]:
        """
        Fetch this worker's own camera config using its WORKER_ID + AUTH_TOKEN.
        Calls GET /api/workers/{id}/config with X-Auth-Token header.
        Returns pipeline-formatted source list, or None on any failure.

        This is the preferred path for edge Jetsons: each device fetches only
        its own assigned cameras — no admin token or IRIS_JETSON_ID filter needed.
        """
        import re as _re

        worker_id  = os.environ.get('WORKER_ID',  '').strip()
        auth_token = os.environ.get('AUTH_TOKEN', '').strip()

        if not worker_id or not auth_token:
            return None

        try:
            url = f"{self.base_url}/workers/{worker_id}/config"
            response = requests.get(url, headers={'X-Auth-Token': auth_token}, timeout=15)

            if response.status_code != 200:
                logger.warning(
                    "Worker config fetch failed for %s (%s): %s",
                    worker_id, response.status_code, response.text[:200]
                )
                return None

            data     = response.json()
            cameras  = data.get('cameras', [])

            # Map long analytic_code to the short string stored in the DB assignments
            # e.g. "A-6" (FRS analytic code) ↔ "frs"
            ANALYTIC_MAP = {
                'A-6': 'frs',
                'crowd': 'crowd',
                'crowd-flow': 'crowd-flow',
                'anpr_vcc': 'anpr_vcc',
            }
            analytic_short = (
                ANALYTIC_MAP.get(self.analytic_code, self.analytic_code)
                if self.analytic_code else None
            )

            # WebSocket/API base URL — strip /api suffix
            # e.g. "http://10.10.0.1:3002/api" → "http://10.10.0.1:3002"
            ws_base = _re.sub(r'/api/?$', '', self.base_url.rstrip('/'))

            sources = []
            for cam in cameras:
                # Use `or []` to handle both missing key and explicit JSON null
                # (backend serializes JSONB as null when analytics not set).
                analytics_list = cam.get('analytics') or []

                # Filter to cameras that carry the requested analytic
                if analytic_short and analytic_short not in analytics_list:
                    continue

                rtsp = cam.get('rtsp_url', '')
                if not rtsp:
                    logger.warning("Camera %s has no RTSP URL, skipping", cam.get('device_id'))
                    continue

                sources.append({
                    'camera_id':           cam['device_id'],
                    'name':                cam.get('name', cam['device_id']),
                    'rtsp_url':            rtsp,
                    # Worker config has no location object — use device_id as stand-in
                    'location_id':         cam['device_id'],
                    'assignment_id':       cam.get('assignment_id'),
                    'fps':                 cam.get('fps', 15),
                    'interval':            5,
                    'confidence':          0.2,
                    'skip_frames':         4,
                    'rtsp_transport':      'tcp',
                    'buffer_size':         10,
                    'model_size':          'yolov8s.pt',
                    'line_position':       0.5,
                    'analytic_config':     cam.get('analytic_config', {}),
                    # API credentials forwarded so pipeline threads can post results
                    'api_base_url':        self.base_url,
                    'api_token':           self.token,
                    'websocket_server_url': ws_base,
                })
                logger.info("✅ [worker-cfg] %s → %s", cam.get('name', cam['device_id']), rtsp)

            logger.info("🚀 [worker-cfg] %d cameras loaded for worker %s", len(sources), worker_id)
            return sources

        except Exception as e:
            logger.warning("Worker own-config fetch error: %s", e)
            return None

    def fetch_all_worker_configs(self) -> Optional[List[Dict]]:
        """
        Fetch all worker configurations from the API.
        
        Returns:
            List[Dict]: List of camera configurations, or None if failed
        """
        try:
            url = urljoin(self.base_url, '/api/analytics/worker-configs')
            logger.info(f"API URL: {url}")
            
            response = self.session.get(url, timeout=30)
            
            if response.status_code == 200:
                data = response.json()
                if data.get('status') == 'success' and 'data' in data:
                    configurations = data['data']
                    logger.info(f"Successfully retrieved configurations for {len(configurations)} cameras.")
                    return configurations
                else:
                    logger.error(f"API returned unsuccessful response: {data}")
                    return None
            else:
                logger.error(f"API request failed with status {response.status_code}: {response.text}")
                return None
                
        except Exception as e:
            logger.error(f"Error fetching worker configurations: {e}")
            logger.error(f"Full traceback: {traceback.format_exc()}")
            return None

    def fetch_focused_device(self) -> Optional[str]:
        """
        Fetch the currently focused device ID from the API.
        
        Returns:
            str: Focused device ID, or None if no focus is set
        """
        try:
            url = urljoin(self.base_url, '/api/inference/focus')
            response = self.session.get(url, timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                return data.get('focusedDeviceId')
            return None
        except Exception as e:
            logger.debug(f"Error fetching focused device: {e}")
            return None

    def get_config(self) -> Dict:
        """
        Get configuration for this specific pipeline.
        Compatible with existing pipeline code.
        
        Returns:
            Dict: Pipeline configuration
        """
        try:
            strict_api_mode = str(os.getenv('INFERENCE_STRICT_API_CONFIG', '')).lower() in ('1', 'true', 'yes', 'on')

            # Respect local-only mode from config file
            if self.config.get('local_only') is True:
                logger.info("Local-only mode enabled in config.yaml; skipping API config fetch.")
                local_config = self.config.copy()
                local_config['api_base_url'] = self.base_url
                local_config['api_token'] = self.token
                return local_config

            # ── Priority 1: worker-specific endpoint (WORKER_ID + AUTH_TOKEN) ──
            # Each Jetson knows its own WORKER_ID and AUTH_TOKEN and fetches only
            # its assigned cameras.  No admin token required; no IRIS_JETSON_ID filter needed.
            worker_sources = self.fetch_worker_own_config()
            if worker_sources is not None:
                if worker_sources:
                    return {
                        'api_base_url': self.base_url,
                        'api_token':    self.token,
                        'rtsp_sources': worker_sources,
                    }
                # Empty list from the worker endpoint means no cameras assigned yet.
                if strict_api_mode:
                    return {'api_base_url': self.base_url, 'api_token': self.token, 'rtsp_sources': []}
                # Otherwise fall through to admin endpoint / local fallback.
                logger.info("Worker config returned 0 cameras — falling back to admin endpoint.")

            # ── Priority 2: admin endpoint (all cameras, filtered by IRIS_JETSON_ID) ──
            all_configs = self.fetch_all_worker_configs()
            focused_device = self.fetch_focused_device()
            
            if all_configs is not None and self.analytic_code:
                # Filter configurations for this analytic type
                filtered_sources = []
                jetson_id = str(os.getenv('IRIS_JETSON_ID', '')).strip()
                
                for camera_config in all_configs:
                    # If in Focus Mode, skip devices that are not focused
                    if focused_device and camera_config['id'] != focused_device:
                        continue

                    # Check if this camera has the analytic we're looking for
                    for analytic in camera_config.get('analytics', []):
                        if analytic.get('analyticCode') == self.analytic_code:
                            analytic_config = analytic.get('config', {}) or {}
                            if not isinstance(analytic_config, dict):
                                analytic_config = {}

                            # Optional hard filter so each Jetson loads only its own cameras.
                            if jetson_id:
                                assigned_jetson = str(
                                    analytic_config.get('jetson_id')
                                    or analytic_config.get('worker_id')
                                    or camera_config.get('workerId')
                                    or ''
                                ).strip()
                                if assigned_jetson and assigned_jetson != jetson_id:
                                    break

                            # Convert API format to pipeline format
                            pipeline_config = {
                                'camera_id': camera_config['id'],
                                'name': camera_config['name'],
                                'rtsp_url': camera_config['rtspUrl'],
                                'location_id': camera_config['location']['id'],
                                'interval': 5,  # Default interval
                                'confidence': 0.2,  # Default confidence
                                'skip_frames': 4,  # Default skip frames
                                'fps': 15,  # Default FPS
                                'rtsp_transport': 'tcp',
                                'buffer_size': 10,
                                'model_size': 'yolov8s.pt',  # Default model - will be overridden by pipeline
                                'line_position': 0.5,  # Default line position for flow
                                'analytic_config': analytic_config,
                            }

                            # Update with analytic-specific settings
                            if analytic_config.get('confidence'):
                                pipeline_config['confidence'] = analytic_config['confidence']
                            if analytic_config.get('fps'):
                                pipeline_config['fps'] = analytic_config['fps']
                            if analytic_config.get('skip_frames'):
                                pipeline_config['skip_frames'] = analytic_config['skip_frames']
                            if analytic_config.get('rtsp_transport'):
                                pipeline_config['rtsp_transport'] = analytic_config['rtsp_transport']
                            if analytic_config.get('buffer_size'):
                                pipeline_config['buffer_size'] = analytic_config['buffer_size']
                            
                            # Only include active analytics
                            if analytic_config.get('isActive', True):
                                filtered_sources.append(pipeline_config)
                                logger.info(f"✅ Added camera {camera_config['name']} for {self.analytic_code} analytics")
                            break  # Found the analytic we want, no need to check others
                
                if focused_device:
                    logger.info(f"🎯 FOCUS MODE: Filtering for device {focused_device}")

                if filtered_sources:
                    result = {
                        'api_base_url': self.base_url,
                        'api_token': self.token,
                        'rtsp_sources': filtered_sources
                    }
                    logger.info(f"🚀 Configured {len(filtered_sources)} cameras for {self.analytic_code} analytics")
                    return result
                else:
                    logger.debug(f"⚠️  No cameras found with {self.analytic_code} analytics")
                    if strict_api_mode:
                        logger.info("Strict API mode enabled: using API-only empty source set (no local fallback).")
                        return {
                            'api_base_url': self.base_url,
                            'api_token': self.token,
                            'rtsp_sources': []
                        }

            if strict_api_mode:
                logger.info("Strict API mode enabled: API unavailable or no matching configs; using API-only empty source set.")
                return {
                    'api_base_url': self.base_url,
                    'api_token': self.token,
                    'rtsp_sources': []
                }
            
            # Fallback to local config file
            logger.info("Using local configuration file")
            local_config = self.config.copy()
            local_config['api_base_url'] = self.base_url
            local_config['api_token'] = self.token
            
            return local_config
            
        except Exception as e:
            logger.error(f"Error getting configuration: {e}")
            strict_api_mode = str(os.getenv('INFERENCE_STRICT_API_CONFIG', '')).lower() in ('1', 'true', 'yes', 'on')
            if strict_api_mode:
                logger.info("Strict API mode enabled: returning empty API-only configuration after error.")
                return {
                    'api_base_url': self.base_url,
                    'api_token': self.token,
                    'rtsp_sources': []
                }
            # Return local config as fallback
            local_config = self.config.copy()
            local_config['api_base_url'] = self.base_url
            local_config['api_token'] = self.token
            return local_config

    def run_with_orchestrator(self, worker_function: Callable, pipeline_type: str, 
                            status_interval: int = 300) -> int:
        """
        Run the pipeline using the process orchestrator.
        
        Args:
            worker_function: Function to run in each camera worker process
            pipeline_type: Type of pipeline for logging
            status_interval: Status report interval in seconds
            
        Returns:
            int: Exit code (0 for success, 1 for error)
        """
        try:
            # Get configuration
            config = self.get_config()
            
            # Create orchestrator
            orchestrator = GenericPipelineOrchestrator(
                config_manager=self,
                worker_function=worker_function,
                pipeline_type=pipeline_type
            )
            
            # Shutdown flag for clean exit
            shutdown_requested = threading.Event()
            
            # Enhanced signal handler
            def enhanced_signal_handler(signum, frame):
                logger.info(f"Received signal {signum}, initiating shutdown...")
                shutdown_requested.set()
                orchestrator.stop()
            
            # Register signal handlers
            signal.signal(signal.SIGINT, enhanced_signal_handler)
            signal.signal(signal.SIGTERM, enhanced_signal_handler)
            
            # Start orchestrator
            orchestrator.start()
            
            # Main loop with status reporting
            last_status_time = datetime.now()
            
            try:
                while not shutdown_requested.is_set():
                    # Print status periodically
                    now = datetime.now()
                    if (now - last_status_time).total_seconds() >= status_interval:
                        status = orchestrator.get_status()
                        logger.info(f"System Status: {status['running_cameras']}/{status['total_cameras']} cameras running, "
                                  f"{status['failed_cameras']} failed")
                        last_status_time = now
                    
                    # Check for shutdown every second instead of 30 seconds
                    shutdown_requested.wait(1.0)
                    
            except KeyboardInterrupt:
                logger.info("Keyboard interrupt received")
                shutdown_requested.set()
            
        except Exception as e:
            logger.error(f"Fatal error: {e}")
            import traceback
            traceback.print_exc()
            return 1
        
        finally:
            if 'orchestrator' in locals():
                logger.info("Performing final cleanup...")
                orchestrator.stop()
                # Give processes time to clean up
                time.sleep(2)
        
        logger.info("Pipeline shutdown complete")
        return 0

    @staticmethod
    def create_main_function(worker_function: Callable, pipeline_type: str, 
                           default_analytic_code: str, script_path: str) -> Callable:
        """
        Create a main function for a pipeline that uses the orchestrator.
        
        Args:
            worker_function: Function to run in each camera worker process
            pipeline_type: Type of pipeline (e.g., 'crowd-flow', 'crowd-simple', 'anpr')
            default_analytic_code: Default analytics code for this pipeline
            script_path: Path to the script file (use __file__)
            
        Returns:
            Callable: Main function that can be called with sys.exit()
        """
        def main():
            # Load IRIS environment first
            load_iris_environment()
            
            parser = argparse.ArgumentParser(description=f'{pipeline_type} Master Process Orchestrator')
            
            script_dir = Path(script_path).parent
            default_config = script_dir / 'config.yaml'
            
            parser.add_argument('--config', default=str(default_config),
                               help='Path to YAML configuration file')
            parser.add_argument('--api-base-url', 
                               default=os.getenv('IRIS_API_BASE_URL', 'http://localhost:3002/api'),
                               help='Base URL for API calls')
            parser.add_argument('--api-token', help='API token for authentication')
            parser.add_argument('--analytic-code', default=default_analytic_code,
                               help='Analytics code to fetch configuration for')
            parser.add_argument('--status-interval', type=int, default=300,
                               help='Status report interval in seconds')
            
            args = parser.parse_args()
            
            # Initialize config manager
            config_manager = AnalyticsConfigManager(
                config_path=args.config,
                api_base_url=args.api_base_url,
                api_token=args.api_token,
                analytic_code=args.analytic_code
            )
            
            # Run with orchestrator
            return config_manager.run_with_orchestrator(
                worker_function=worker_function,
                pipeline_type=pipeline_type,
                status_interval=args.status_interval
            )
        
        return main


# Legacy compatibility for existing pipelines
ConfigManager = AnalyticsConfigManager

if __name__ == '__main__':
    # Example usage:
    # This shows how a pipeline's run script would use this manager.
    
    # The config file is expected to be in a directory relative to this script.
    # For demonstration, we assume a structure like: services/pipelines/common/ and services/personid/config.yaml
    config_file_path = Path(__file__).parent.parent.parent / 'personid' / 'config.yaml'
    
    if not config_file_path.exists():
        logger.error(f"Configuration file not found at: {config_file_path}")
        sys.exit(1)

    config_manager = AnalyticsConfigManager(config_path=str(config_file_path))
    all_configs = config_manager.fetch_all_worker_configs()
    
    if all_configs:
        logger.info("\n=== All Raw Worker Configurations Fetched ===")
        import json
        logger.info(json.dumps(all_configs, indent=2))
        logger.info("\nEach pipeline will now filter these configurations for its own use.")
