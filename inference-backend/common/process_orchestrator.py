#!/usr/bin/env python3
"""
Generic Process Orchestrator for Analytics Pipelines
- Manages individual camera worker processes with resource monitoring and auto-recovery
- Can be used by any analytics pipeline (crowd-flow-count, crowd-simple-count, anpr-india, etc.)
- Handles configuration reloading and process monitoring.
"""

import logging
import time
from multiprocessing import Queue, Event, Process
from datetime import datetime
from typing import Dict, Callable, Optional, Union, TypedDict, TYPE_CHECKING
import threading
import psutil
import signal
import os

from common.common_types import ErrorResult

# Union type for all possible result queue items
if TYPE_CHECKING:
    ResultQueueItem = Union[ErrorResult, Dict]  # Dict for other result types
else:
    ResultQueueItem = Union  # Type alias for runtime

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler()]
)

class ResourceLimits:
    """Resource limits per camera process"""
    MAX_CPU_PERCENT = 200.0  # 2 cores = 200% (on multi-core system)
    MAX_MEMORY_MB = 2048     # 2GB RAM limit
    MAX_RESTART_ATTEMPTS = 20
    RESTART_COOLDOWN_SECONDS = 5
    HEALTH_CHECK_INTERVAL = 3   # Check every 3s so dead cameras are restarted quickly

class CameraWorkerProcess:
    """Manages a single camera worker process with health monitoring"""
    
    def __init__(self, camera_config: dict, result_queue: Queue, stop_event: Event, 
                 worker_function: Callable, pipeline_type: str):
        self.camera_config = camera_config
        self.camera_id = camera_config['camera_id']
        self.result_queue = result_queue
        self.stop_event = stop_event
        self.worker_function = worker_function
        self.pipeline_type = pipeline_type
        
        # GPU tracking
        self.gpu_id = None  # Will be set when worker starts
        
        # Process management
        self.process: Optional[Process] = None
        self.psutil_process: Optional[psutil.Process] = None
        
        # Resource monitoring
        self.restart_count = 0
        self.last_restart_time = None
        self.creation_time = datetime.now()
        self.last_health_check = datetime.now()
        
        # Status tracking
        self.status = "stopped"  # stopped, starting, running, restarting, failed
        self.last_error = None
        
        self.logger = logging.getLogger(f'{pipeline_type}_worker_{self.camera_id[:8]}')
        self.logger.info(f"Camera worker initialized for {self.camera_id}")
    
    def start(self):
        """Start the camera worker process"""
        if self.process and self.process.is_alive():
            self.logger.warning(f"Camera {self.camera_id} process already running")
            return
        
        try:
            self.status = "starting"
            self.logger.info(f"Starting camera worker process for {self.camera_id}")
            
            # Create new process
            self.process = Process(
                target=self.worker_function,
                args=(self.camera_config, self.result_queue, self.stop_event),
                name=f"{self.pipeline_type}-{self.camera_id[:8]}"
            )
            self.process.start()
            
            # Get psutil process for monitoring
            self.psutil_process = psutil.Process(self.process.pid)
            
            # Set CPU affinity to assign 2 cores per camera
            try:
                cpu_count = psutil.cpu_count()
                if cpu_count > 2:
                    # Assign 2 consecutive cores based on camera index
                    base_core = (hash(self.camera_id) % (cpu_count // 2)) * 2
                    assigned_cores = [base_core, base_core + 1]
                    self.psutil_process.cpu_affinity(assigned_cores)
                    self.logger.info(f"Camera {self.camera_id} assigned to CPU cores {assigned_cores}")
                elif cpu_count == 2:
                    # Use both cores if only 2 available
                    self.psutil_process.cpu_affinity([0, 1])
                    self.logger.info(f"Camera {self.camera_id} assigned to CPU cores [0, 1]")
            except Exception as e:
                self.logger.warning(f"Could not set CPU affinity for {self.camera_id}: {e}")
            
            # Try to determine GPU ID from camera config or process name
            try:
                if hasattr(self.camera_config, 'get'):
                    self.gpu_id = self.camera_config.get('gpu_id')
                elif 'gpu_id' in self.camera_config:
                    self.gpu_id = self.camera_config['gpu_id']
                else:
                    # Extract from process name if available
                    process_name = self.process.name
                    if 'gpu' in process_name.lower():
                        import re
                        match = re.search(r'gpu[:\-]?(\d+)', process_name.lower())
                        if match:
                            self.gpu_id = int(match.group(1))
            except Exception as e:
                self.logger.debug(f"Could not determine GPU ID for {self.camera_id}: {e}")
            
            self.status = "running"
            self.last_health_check = datetime.now()
            
        except Exception as e:
            self.status = "failed"
            self.last_error = str(e)
            self.logger.error(f"Failed to start camera {self.camera_id}: {e}")
    
    def stop(self, timeout: int = 3):
        """Stop the camera worker process gracefully"""
        try:
            self.status = "stopped"
            if not self.process:
                return

            self.logger.info(f"Stopping camera worker process for {self.camera_id}")

            # Signal the process to stop
            self.stop_event.set()

            # Wait for graceful shutdown (short timeout — dead processes return instantly)
            self.process.join(timeout=timeout)

            # Force terminate if still alive
            if self.process.is_alive():
                self.logger.warning(f"Force terminating unresponsive worker for {self.camera_id}")
                self.process.terminate()
                self.process.join(timeout=2)

                # Kill if still alive
                if self.process.is_alive():
                    self.logger.error(f"Force killing stubborn worker for {self.camera_id}")
                    self.process.kill()
                    self.process.join(timeout=1)
            
            self.process = None
            self.status = "stopped"
            self.logger.info(f"Camera worker {self.camera_id} stopped successfully")
            
        except Exception as e:
            self.logger.error(f"Error stopping camera {self.camera_id}: {e}")
            # Ensure process is cleaned up even on error
            if self.process and self.process.is_alive():
                try:
                    self.process.kill()
                except:
                    pass
            self.process = None
            self.status = "stopped"
    
    def restart(self):
        """Restart the camera worker process"""
        if not self._can_restart():
            self.logger.warning(f"Camera {self.camera_id} has exceeded restart limits")
            self.status = "failed"
            return
        
        self.logger.info(f"Restarting camera worker process for {self.camera_id}")
        self.status = "restarting"

        # Stop current process
        self.stop()

        # Brief pause so OS releases resources (file handles, GPU context, etc.)
        time.sleep(0.3)

        # Clear stop event for new process
        self.stop_event.clear()
        
        # Update restart tracking
        self.restart_count += 1
        self.last_restart_time = datetime.now()
        
        # Start new process
        self.start()
    
    def check_health(self) -> dict:
        """Check process health and resource usage"""
        health_status = {
            'camera_id': self.camera_id,
            'pipeline_type': self.pipeline_type,
            'status': self.status,
            'alive': False,
            'cpu_percent': 0.0,
            'memory_mb': 0.0,
            'restart_count': self.restart_count,
            'uptime_seconds': 0,
            'needs_restart': False,
            'last_error': self.last_error
        }
        
        if not self.process or not self.process.is_alive():
            health_status['status'] = 'stopped'
            return health_status
        
        try:
            if self.psutil_process and self.psutil_process.is_running():
                health_status['alive'] = True
                
                # Get resource usage
                cpu_percent = self.psutil_process.cpu_percent()
                memory_info = self.psutil_process.memory_info()
                memory_mb = memory_info.rss / (1024 * 1024)  # Convert to MB
                
                health_status['cpu_percent'] = cpu_percent
                health_status['memory_mb'] = memory_mb
                health_status['uptime_seconds'] = (datetime.now() - self.creation_time).total_seconds()
                
                # Check resource limits
                if cpu_percent > ResourceLimits.MAX_CPU_PERCENT:
                    self.logger.warning(f"Camera {self.camera_id} exceeding CPU limit: {cpu_percent:.1f}%")
                    health_status['needs_restart'] = True
                    health_status['last_error'] = f"CPU usage {cpu_percent:.1f}% > {ResourceLimits.MAX_CPU_PERCENT}%"
                
                if memory_mb > ResourceLimits.MAX_MEMORY_MB:
                    self.logger.warning(f"Camera {self.camera_id} exceeding memory limit: {memory_mb:.1f}MB")
                    health_status['needs_restart'] = True
                    health_status['last_error'] = f"Memory usage {memory_mb:.1f}MB > {ResourceLimits.MAX_MEMORY_MB}MB"
                
        except (psutil.NoSuchProcess, psutil.AccessDenied) as e:
            self.logger.warning(f"Error checking health for camera {self.camera_id}: {e}")
            health_status['needs_restart'] = True
            health_status['last_error'] = str(e)
        
        self.last_health_check = datetime.now()
        return health_status
    
    def _can_restart(self) -> bool:
        """Check if process can be restarted based on limits"""
        if self.restart_count >= ResourceLimits.MAX_RESTART_ATTEMPTS:
            return False
        
        if self.last_restart_time:
            time_since_restart = datetime.now() - self.last_restart_time
            if time_since_restart.total_seconds() < ResourceLimits.RESTART_COOLDOWN_SECONDS:
                return False
        
        return True


class GenericPipelineOrchestrator:
    """Generic master process that orchestrates camera worker processes for any pipeline type"""
    
    def __init__(self, config_manager, worker_function: Callable, pipeline_type: str):
        """
        Initialize the orchestrator
        
        Args:
            config_manager: Configuration manager instance
            worker_function: Function to run in each camera worker process
            pipeline_type: Type of pipeline (e.g., 'crowd-flow', 'crowd-simple', 'anpr')
        """
        self.config_manager = config_manager
        self.worker_function = worker_function
        self.pipeline_type = pipeline_type

        # Process management
        self.camera_workers: Dict[str, CameraWorkerProcess] = {}
        self.result_queue: Queue = Queue() #Queue[ResultQueueItem]
        self.shutdown_event = Event()

        # Monitoring thread
        self.monitor_thread = None
        self.config_reload_thread = None

        # Last successfully fetched non-empty sources — used to avoid stopping
        # cameras on transient API failures (strict_api_mode returning []).
        self._last_good_sources: List[dict] = []
        
        self.logger = logging.getLogger(f'{pipeline_type}_orchestrator')
        self.logger.info(f"{pipeline_type} Orchestrator initialized")
    
    def start(self):
        """Start the orchestrator and all camera processes"""
        self.logger.info(f"Starting {self.pipeline_type} Orchestrator")
        
        # Load initial configuration
        self._reload_configuration()
        
        # Start monitoring thread
        self.monitor_thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self.monitor_thread.start()
        
        # Start config reload thread
        self.config_reload_thread = threading.Thread(target=self._config_reload_loop, daemon=True)
        self.config_reload_thread.start()
        
        self.logger.info("Orchestrator started successfully")
    
    def stop(self):
        """Stop all camera processes and shutdown orchestrator"""
        self.logger.info(f"Stopping {self.pipeline_type} Orchestrator")
        
        # Signal shutdown
        self.shutdown_event.set()
        
        # Stop all camera workers
        for camera_id, worker in self.camera_workers.items():
            worker.stop()
        
        # Wait for threads to finish
        if self.monitor_thread:
            self.monitor_thread.join(timeout=10)
        if self.config_reload_thread:
            self.config_reload_thread.join(timeout=10)
        
        # Clear workers
        self.camera_workers.clear()
        
        self.logger.info("Orchestrator stopped")
    
    def _reload_configuration(self):
        """Reload configuration and update camera workers"""
        try:
            config = self.config_manager.get_config()
            sources = config.get('rtsp_sources', [])

            # If the API returned an empty list but we have running cameras, this
            # is likely a transient failure (network blip, backend restarting).
            # Keep the current cameras running and skip this reload cycle to
            # avoid a "stop everything on API hiccup" storm.
            if not sources and self.camera_workers:
                self.logger.warning("Config reload returned 0 sources but %d cameras are running — keeping them (transient API failure?)", len(self.camera_workers))
                return

            # Record last good sources for future transient-failure protection.
            if sources:
                self._last_good_sources = sources

            # Get current and new camera IDs
            current_camera_ids = set(self.camera_workers.keys())
            new_camera_ids = {source['camera_id'] for source in sources}
            
            # Stop removed cameras
            cameras_to_remove = current_camera_ids - new_camera_ids
            for camera_id in cameras_to_remove:
                self.logger.info(f"Removing camera {camera_id}")
                self.camera_workers[camera_id].stop()
                del self.camera_workers[camera_id]
            
            # Add new cameras
            cameras_to_add = new_camera_ids - current_camera_ids
            for source in sources:
                camera_id = source['camera_id']
                if camera_id in cameras_to_add:
                    self.logger.info(f"Adding new camera {camera_id}")
                    
                    # Add global settings to source config
                    source['api_base_url'] = config.get('api_base_url')
                    source['api_token'] = config.get('api_token')
                    
                    # Create worker and start
                    worker = CameraWorkerProcess(
                        source, self.result_queue, Event(), 
                        self.worker_function, self.pipeline_type
                    )
                    self.camera_workers[camera_id] = worker
                    worker.start()
            
            # Update existing cameras if config changed
            for source in sources:
                camera_id = source['camera_id']
                if camera_id in current_camera_ids and camera_id not in cameras_to_add:
                    # Add global settings
                    source['api_base_url'] = config.get('api_base_url')
                    source['api_token'] = config.get('api_token')
                    
                    # Check if config changed
                    if self.camera_workers[camera_id].camera_config != source:
                        self.logger.info(f"Configuration changed for camera {camera_id}, restarting")
                        self.camera_workers[camera_id].stop()
                        worker = CameraWorkerProcess(
                            source, self.result_queue, Event(), 
                            self.worker_function, self.pipeline_type
                        )
                        self.camera_workers[camera_id] = worker
                        worker.start()
            
            self.logger.info(f"Configuration reloaded: {len(self.camera_workers)} active cameras")
            
        except Exception as e:
            self.logger.error(f"Error reloading configuration: {e}")
    
    def _monitor_loop(self):
        """Main monitoring loop for health checks and resource monitoring"""
        self.logger.info("Starting monitoring loop")
        
        # GPU monitoring variables
        last_gpu_status_time = 0
        gpu_status_interval = 60  # Log GPU status every 60 seconds
        
        while not self.shutdown_event.is_set():
            try:
                # Health check all camera workers
                for camera_id, worker in list(self.camera_workers.items()):
                    health = worker.check_health()
                    
                    # Log health status
                    if health['alive']:
                        self.logger.debug(f"Camera {camera_id}: CPU {health['cpu_percent']:.1f}%, "
                                       f"Memory {health['memory_mb']:.1f}MB, "
                                       f"Uptime {health['uptime_seconds']:.0f}s")
                    
                    # Restart due to resource overuse
                    if health['needs_restart'] and worker.status not in ('restarting', 'starting'):
                        self.logger.warning(f"Restarting camera {camera_id}: {health['last_error']}")
                        threading.Thread(
                            target=worker.restart, daemon=True,
                            name=f"Restart-{camera_id[:8]}"
                        ).start()

                    # Restart dead process (exited unexpectedly — frame grabber died,
                    # inference thread crashed, RTSP permanent failure, etc.)
                    elif not health['alive'] and worker.status not in ('restarting', 'starting', 'failed'):
                        self.logger.warning(f"Camera {camera_id} process died unexpectedly — restarting now")
                        threading.Thread(
                            target=worker.restart, daemon=True,
                            name=f"Restart-{camera_id[:8]}"
                        ).start()

                    # Remove permanently failed workers
                    elif worker.status == 'failed' and not worker._can_restart():
                        self.logger.error(f"Camera {camera_id} permanently failed, removing")
                        worker.stop()
                        del self.camera_workers[camera_id]
                
                # GPU monitoring (if config manager supports it)
                current_time = time.time()
                if current_time - last_gpu_status_time >= gpu_status_interval:
                    try:
                        if hasattr(self.config_manager, 'get_gpu_status'):
                            gpu_status = self.config_manager.get_gpu_status()
                            if gpu_status:
                                self.logger.info("=== GPU Status ===")
                                for gpu_id, status in gpu_status.items():
                                    if 'error' not in status:
                                        self.logger.info(f"GPU {gpu_id}: {status['name']} | "
                                                      f"Memory: {status['memory_allocated_gb']}GB/{status['memory_total_gb']}GB "
                                                      f"({status['memory_usage_percent']}%) | "
                                                      f"Temp: {status.get('temperature', 'N/A')}°C | "
                                                      f"Util: {status.get('utilization', 'N/A')}%")
                                    else:
                                        self.logger.warning(f"GPU {gpu_id}: {status['error']}")
                                
                                # Log camera distribution across GPUs
                                gpu_camera_counts = {}
                                for worker in self.camera_workers.values():
                                    if hasattr(worker, 'gpu_id'):
                                        gpu_id = worker.gpu_id
                                        gpu_camera_counts[gpu_id] = gpu_camera_counts.get(gpu_id, 0) + 1
                                
                                if gpu_camera_counts:
                                    self.logger.info("=== Camera Distribution ===")
                                    for gpu_id, count in gpu_camera_counts.items():
                                        self.logger.info(f"GPU {gpu_id}: {count} cameras")
                                
                                last_gpu_status_time = current_time
                    except Exception as e:
                        self.logger.debug(f"GPU monitoring not available: {e}")
                
                # Process result queue
                self._process_results()
                
                # Wait for next check
                self.shutdown_event.wait(ResourceLimits.HEALTH_CHECK_INTERVAL)
                
            except Exception as e:
                self.logger.error(f"Error in monitoring loop: {e}")
                self.shutdown_event.wait(10)
    
    def _config_reload_loop(self):
        """Configuration reload loop"""
        self.logger.info("Starting configuration reload loop")
        
        while not self.shutdown_event.is_set():
            try:
                self._reload_configuration()
                # Wait 5 seconds before next reload (increased frequency for responsive focus mode)
                if self.shutdown_event.wait(5):
                    break
            except Exception as e:
                self.logger.error(f"Error in config reload loop: {e}")
                self.shutdown_event.wait(30)
    
    def _process_results(self):
        """Process results from camera worker processes"""
        while not self.result_queue.empty():
            try:
                result = self.result_queue.get_nowait()
                if result['type'] == 'error':
                    self.logger.error(f"Camera {result['camera_id']} reported error: {result['error']}")
                else:
                    # Handle other result types (detection results, etc.)
                    self.logger.debug(f"Received result from camera {result.get('camera_id', 'unknown')}")
            except:
                break
    
    def get_status(self) -> dict:
        """Get overall system status"""
        status = {
            'timestamp': datetime.now().isoformat(),
            'pipeline_type': self.pipeline_type,
            'total_cameras': len(self.camera_workers),
            'running_cameras': 0,
            'failed_cameras': 0,
            'cameras': {}
        }
        
        for camera_id, worker in self.camera_workers.items():
            health = worker.check_health()
            status['cameras'][camera_id] = health
            
            if health['alive']:
                status['running_cameras'] += 1
            elif health['status'] == 'failed':
                status['failed_cameras'] += 1
        
        return status


def signal_handler(orchestrator):
    """Handle shutdown signals"""
    def handler(signum, frame):
        logger = logging.getLogger('orchestrator')
        logger.info(f"Received signal {signum}, shutting down...")
        orchestrator.stop()
        # Force exit after cleanup
        import sys
        sys.exit(0) 
