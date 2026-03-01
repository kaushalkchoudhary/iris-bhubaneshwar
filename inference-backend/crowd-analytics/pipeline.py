#!/usr/bin/env python3
"""
RTSP Analytics Pipeline for Video Stream Object Detection using YOLOv8
"""

import cv2
import numpy as np
from ultralytics import YOLO
import time
from datetime import datetime
import threading
import queue
import base64
import requests
import json
from collections import deque
from typing import Optional, Dict, List, Tuple
import logging
import os
from pathlib import Path


def setup_logging(name: str) -> logging.Logger:
    """
    Setup logging configuration for a pipeline instance

    Args:
        name: Name of the pipeline instance

    Returns:
        logging.Logger: Configured logger instance
    """
    # Create logs directory if it doesn't exist
    log_dir = Path("logs")
    log_dir.mkdir(exist_ok=True)

    # Create a logger for this pipeline instance
    logger = logging.getLogger(f"pipeline.{name}")
    logger.setLevel(logging.INFO)

    # Create handlers
    # Console handler
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    console_formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    console_handler.setFormatter(console_formatter)

    # File handler for API responses
    api_file_handler = logging.FileHandler(log_dir / f"{name}_api_responses.log")
    api_file_handler.setLevel(logging.INFO)
    api_formatter = logging.Formatter('%(asctime)s - %(message)s')
    api_file_handler.setFormatter(api_formatter)

    # Add handlers to logger
    logger.addHandler(console_handler)
    logger.addHandler(api_file_handler)

    return logger


class RTSPAnalyticsPipeline:
    """
    Analytics pipeline for processing RTSP video streams with YOLOv8 object detection
    """

    def __init__(self, name: str, rtsp_url: str, camera_id: str, location_id: str, interval: int = 5, model_size: str = "yolov8s.pt",
                 confidence: float = 0.1, skip_frames: int = 2, fps: int = 30, api_base_url: str = None, api_token: str = None,
                 rtsp_transport: str = "tcp", buffer_size: int = 5):
        """
        Initialize the analytics pipeline

        Args:
            name: Name of the pipeline instance
            rtsp_url: RTSP stream URL
            camera_id: Camera ID for API calls
            location_id: Location ID for API calls
            interval: API call interval in seconds (default: 5)
            model_size: YOLOv8 model size (yolov8s.pt for small)
            confidence: Confidence threshold for detections
            skip_frames: Process every Nth frame (2 = half FPS, 3 = third FPS, etc.)
            fps: Target FPS for video capture (default: 30)
            api_base_url: Base URL for API calls
            api_token: API token for authentication
            rtsp_transport: RTSP transport protocol ("tcp" or "udp")
            buffer_size: Video capture buffer size
        """
        self.name = name
        self.rtsp_url = rtsp_url
        self.camera_id = camera_id
        self.location_id = location_id
        self.model_size = model_size
        self.confidence = confidence
        self.skip_frames = skip_frames
        self.fps = fps
        self.rtsp_transport = rtsp_transport
        self.buffer_size = buffer_size
        self.frame_skip_counter = 0
        self.model = None
        self.cap = None
        self.results_queue = queue.Queue()
        self.running = False

        # Threading for non-blocking frame reading
        self.latest_frame = None
        self.frame_lock = threading.Lock()
        self.stop_event = threading.Event()

        # Statistics
        self.frame_count = 0
        self.processed_frame_count = 0
        self.detection_count = 0
        self.start_time = None

        # Custom label mapping
        self.custom_labels = {
            'person': 'devotee',
            'people': 'devotee'  # Handle both possible class names
        }

        # Valid person class names — includes custom model classes ('people', 'head')
        self.person_classes = {'person', 'people', 'head'}

        # API integration
        self.api_base_url = api_base_url or "http://localhost:3002"
        self.api_token = api_token
        # Remove trailing slash and /api/ from base URL if present, then construct the full endpoint
        base_url = self.api_base_url.rstrip('/').rstrip('/api')
        self.api_url = f"{base_url}/api/inference/crowd/analysis"
        self.api_call_interval = interval

        # Track devotee counts and frames for API calls
        self.devotee_counts = deque(maxlen=90)  # Store last 90 counts
        self.last_raw_frame = None
        self.last_annotated_frame = None
        self.last_api_call_time = 0

        # Cumulative total: count new people entering (positive frame-to-frame deltas)
        self.cumulative_total = 0
        self.last_frame_count = 0

        # Try to restore cumulative from last saved DB record so restarts don't reset it
        self._restore_cumulative_from_db()

        # Live frame: send heatmap-annotated frame every N processed frames
        self.live_frame_counter = 0
        self.live_frame_interval = 5  # send every 5 processed frames
        base_url_clean = self.api_base_url.rstrip('/').rstrip('/api')
        self.live_frame_url = f"{base_url_clean}/api/inference/crowd/live-frame"

        # For movement and demographic analysis
        self.previous_detections = deque(maxlen=30)

        # Setup logging
        self.logger = setup_logging(name)

    def _restore_cumulative_from_db(self):
        """Query the backend for the last stored cumulativeCount so restarts don't reset to 0"""
        try:
            base = self.api_base_url.rstrip('/').rstrip('/api')
            url = f"{base}/api/inference/crowd/analysis?deviceId={self.camera_id}&limit=1"
            resp = requests.get(url, timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, list) and len(data) > 0:
                    saved = data[0].get('cumulativeCount')
                    if saved and isinstance(saved, int) and saved > 0:
                        self.cumulative_total = saved
                        print(f"[{self.name}] Restored cumulative total from DB: {saved}")
                        return
            print(f"[{self.name}] No previous cumulative data found, starting from 0")
        except Exception as e:
            print(f"[{self.name}] Could not restore cumulative from DB: {e}, starting from 0")

    def get_display_label(self, class_name: str) -> str:
        """Get the display label for a class name, applying custom mappings"""
        return self.custom_labels.get(class_name, class_name)

    def frame_to_base64(self, frame: np.ndarray) -> str:
        """Convert frame to base64 encoded JPEG string"""
        try:
            # Resize frame to Full HD (1920x1080) for API upload
            resized_frame = cv2.resize(frame, (1920, 1080), interpolation=cv2.INTER_AREA)

            # Encode frame as JPEG with high quality
            _, buffer = cv2.imencode('.jpg', resized_frame, [cv2.IMWRITE_JPEG_QUALITY, 85])

            # Convert to base64
            jpg_as_text = base64.b64encode(buffer).decode('utf-8')

            # Add data URI prefix
            base64_string = f"data:image/jpeg;base64,{jpg_as_text}"

            return base64_string

        except Exception as e:
            print(f"Error converting frame to base64: {e}")
            return "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k="

    def get_average_devotee_count(self) -> int:
        """Calculate the average devotee count from recent frames"""
        if not self.devotee_counts:
            return 0
        return round(sum(self.devotee_counts) / len(self.devotee_counts))

    def calculate_trend_analysis(self) -> dict:
        """Calculate actual trend analysis based on historical devotee counts"""
        if len(self.devotee_counts) < 10:
            return {
                "trend": "insufficient_data",
                "confidence": 0.0,
                "rate_of_change": 0.0
            }

        # Calculate trend over last 30 frames (roughly 3 seconds)
        recent_counts = list(self.devotee_counts)[-30:]
        older_counts = list(self.devotee_counts)[-60:-30] if len(self.devotee_counts) >= 60 else recent_counts[:15]

        recent_avg = sum(recent_counts) / len(recent_counts)
        older_avg = sum(older_counts) / len(older_counts)

        change_rate = (recent_avg - older_avg) / max(older_avg, 1) * 100  # Percentage change

        if change_rate > 5:
            trend = "increasing"
        elif change_rate < -5:
            trend = "decreasing"
        else:
            trend = "stable"

        # Calculate confidence based on data consistency
        variance = np.var(recent_counts) if len(recent_counts) > 1 else 0
        confidence = max(0.3, min(0.95, 1.0 - (variance / max(recent_avg, 1))))

        return {
            "trend": trend,
            "confidence": round(confidence, 2),
            "rate_of_change": round(change_rate, 2)
        }

    def calculate_movement_analysis(self, current_detections: List[Dict]) -> dict:
        """Analyze movement patterns based on detection positions"""
        devotee_detections = [d for d in current_detections if d['class_name'] in self.person_classes]

        if not devotee_detections:
            return {
                "movementPattern": "no_people",
                "averageSpeed": 0.0,
                "dwellTime": 0.0,
                "density_per_area": 0.0
            }

        # Calculate density (people per frame area - assuming 1920x1080 reference)
        frame_area = 1920 * 1080  # Reference frame size
        density_per_area = len(devotee_detections) / frame_area * 1000000  # People per million pixels

        # Analyze movement based on detection spread
        positions = [(d['bbox'][0] + d['bbox'][2])/2 for d in devotee_detections]  # Center X coordinates
        position_variance = np.var(positions) if len(positions) > 1 else 0

        # Determine movement pattern based on position distribution
        if len(devotee_detections) < 5:
            movement_pattern = "sparse"
        elif position_variance < 1000:  # Low variance = clustered
            movement_pattern = "clustered"
        elif len(devotee_detections) > 50:
            movement_pattern = "crowded"
        else:
            movement_pattern = "distributed"

        # Estimate average speed (simplified - would need frame-to-frame tracking for real speed)
        estimated_speed = min(2.0, position_variance / 10000)  # Rough estimation

        # Estimate dwell time based on density
        dwell_time = min(30.0, len(devotee_detections) / 10)  # More people = longer dwell time

        return {
            "movementPattern": movement_pattern,
            "averageSpeed": round(estimated_speed, 1),
            "dwellTime": round(dwell_time, 1),
            "density_per_area": round(density_per_area, 3)
        }

    def calculate_age_demographics(self, current_detections: List[Dict]) -> dict:
        """Estimate age demographics (simplified - real implementation would need age detection model)"""
        devotee_count = sum(1 for d in current_detections if d['class_name'] in self.person_classes)

        if devotee_count == 0:
            return {"0-18": 0, "19-35": 0, "36-55": 0, "55+": 0}

        # Simplified estimation based on typical religious gathering demographics
        # In a real implementation, you'd use an age detection model
        return {
            "0-18": round(devotee_count * 0.15),  # 15% children/teens
            "19-35": round(devotee_count * 0.35), # 35% young adults
            "36-55": round(devotee_count * 0.35), # 35% middle-aged
            "55+": round(devotee_count * 0.15)    # 15% elderly
        }

    def log_api_response(self, response: requests.Response, payload: dict):
        """Log API response details, excluding base64 image data"""
        try:
            # Create a copy of the payload without the image data
            payload_for_log = payload.copy()
            payload_for_log['annotatedImageUrl'] = '<base64_image_data_omitted>'
            payload_for_log['rawImageUrl'] = '<base64_image_data_omitted>'

            log_entry = {
                "timestamp": datetime.now().isoformat(),
                "request": {
                    "url": self.api_url,
                    "method": "POST",
                    "headers": {k: v for k, v in response.request.headers.items() if k.lower() != 'authorization'},
                    "payload": payload_for_log
                },
                "response": {
                    "status_code": response.status_code,
                    "headers": dict(response.headers),
                    "body": response.json() if response.headers.get('content-type', '').startswith('application/json') else response.text
                }
            }

            # Log the formatted JSON response
            self.logger.info(f"API Response Log:\n{json.dumps(log_entry, indent=2)}")

        except Exception as e:
            self.logger.error(f"Error logging API response: {e}")

    def generate_heatmap_frame(self, frame: np.ndarray, detections: list) -> np.ndarray:
        """Overlay a crowd density heatmap — dense clusters turn red, sparse areas stay cool"""
        h, w = frame.shape[:2]
        heatmap = np.zeros((h, w), dtype=np.float32)

        person_dets = [d for d in detections if d['class_name'] in self.person_classes]
        for det in person_dets:
            x1, y1, x2, y2 = det['bbox']
            cx, cy = int((x1 + x2) / 2), int((y1 + y2) / 2)
            # Each person ADDS to the heatmap — overlapping people accumulate heat
            radius = max(60, int((x2 - x1) * 1.2))
            blob = np.zeros((h, w), dtype=np.float32)
            cv2.circle(blob, (cx, cy), radius, 1.0, -1)
            heatmap += blob

        # Wide blur so nearby people blend into one hot zone
        heatmap = cv2.GaussianBlur(heatmap, (151, 151), 0)

        # Normalize: dense clusters → red, single person → blue/green, empty → deep blue
        if heatmap.max() > 0:
            heatmap = heatmap / heatmap.max()

        heatmap_colored = cv2.applyColorMap((heatmap * 255).astype(np.uint8), cv2.COLORMAP_JET)

        # Fixed blend — blue tint covers the whole frame, dense areas turn red
        result = cv2.addWeighted(frame.copy(), 0.55, heatmap_colored, 0.45, 0)

        return result

    def send_live_frame(self, frame: np.ndarray):
        """POST heatmap frame to backend in-memory store — no disk write"""
        try:
            small = cv2.resize(frame, (640, 360), interpolation=cv2.INTER_LINEAR)
            _, buf = cv2.imencode('.jpg', small, [cv2.IMWRITE_JPEG_QUALITY, 75])
            b64 = base64.b64encode(buf).decode('utf-8')
            requests.post(
                self.live_frame_url,
                json={"deviceId": self.camera_id, "frame": f"data:image/jpeg;base64,{b64}"},
                timeout=3
            )
        except Exception:
            pass  # non-critical

    def make_api_call(self, devotee_count: int, raw_frame_base64: str, annotated_frame_base64: str):
        """Make API call with crowd count and frame data to Go backend"""
        try:
            headers = {
                'Content-Type': 'application/json'
            }
            if self.api_token:
                headers['Authorization'] = f'Bearer {self.api_token}'

            # Derive density from current instantaneous count
            if devotee_count < 50:
                density_level = "LOW"
            elif devotee_count < 150:
                density_level = "MEDIUM"
            elif devotee_count < 1000:
                density_level = "HIGH"
            else:
                density_level = "CRITICAL"

            # Scale: 1000 people = 100% congestion
            congestion_level = min(100, int(devotee_count / 1000 * 100))

            # Go backend format:
            # peopleCount = current frame occupancy (for hotspot ranking)
            # cumulativeCount = running daily total footfall (for Total People KPI)
            payload = {
                "deviceId": self.camera_id,
                "peopleCount": devotee_count,
                "cumulativeCount": self.cumulative_total,
                "flowRate": 0.0,
                "densityLevel": density_level,
                "movementType": "STATIC",
                "congestionLevel": congestion_level,
                "confidence": 0.85,
                "modelType": "yolov8-crowd-unified",
                "timestamp": datetime.now().isoformat() + "Z",
            }

            self.logger.info(f"\n📡 API call - Camera: {self.camera_id} | Current: {devotee_count} | Total Footfall: {self.cumulative_total} | Density: {density_level}")

            response = requests.post(self.api_url, headers=headers, json=payload, timeout=10)

            if response.status_code == 200 or response.status_code == 201:
                self.logger.info(f"✅ API call successful for {self.name}")
            else:
                self.logger.error(f"❌ API call failed for {self.name} - Status: {response.status_code}")
                self.logger.error(f"Response: {response.text}")

        except requests.exceptions.RequestException as e:
            self.logger.error(f"❌ API request error for {self.name}: {e}")
        except Exception as e:
            self.logger.error(f"❌ Unexpected error in API call for {self.name}: {e}")

    def should_make_api_call(self) -> bool:
        """Check if it's time to make an API call"""
        current_time = time.time()
        return (current_time - self.last_api_call_time) >= self.api_call_interval

    def initialize_model(self) -> bool:
        """Initialize YOLOv8 model"""
        try:
            # Get the directory where this script is located
            script_dir = Path(__file__).parent

            # Check if model_size is a filename (contains .pt) or just a model name
            if self.model_size.endswith('.pt'):
                # Look in local models/ folder first, then script dir
                model_path = script_dir / 'models' / self.model_size
                if not model_path.exists():
                    model_path = script_dir / self.model_size
                if model_path.exists():
                    print(f"Loading custom YOLOv8 model: {model_path}")
                    self.model = YOLO(str(model_path))
                else:
                    print(f"Custom model file not found: {model_path}")
                    print(f"Falling back to default YOLOv8 model: yolov8s.pt")
                    self.model = YOLO("yolov8s.pt")
            else:
                # Standard YOLOv8 model (will be downloaded if not present)
                print(f"Loading YOLOv8 model: {self.model_size}")
                self.model = YOLO(self.model_size)

            print("Model loaded successfully!")
            return True
        except Exception as e:
            print(f"Error loading model: {e}")
            return False

    def initialize_video_capture(self) -> bool:
        """Initialize video capture from RTSP stream"""
        try:
            print(f"Connecting to RTSP stream: {self.rtsp_url}")

            # Set RTSP transport protocol if using FFMPEG backend
            if self.rtsp_transport.lower() == "tcp":
                os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"
            else:
                # Default is often UDP, but let's clear the env var to be safe
                if "OPENCV_FFMPEG_CAPTURE_OPTIONS" in os.environ:
                    del os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"]

            self.cap = cv2.VideoCapture(self.rtsp_url, cv2.CAP_FFMPEG)

            # Set buffer size to reduce latency
            self.cap.set(cv2.CAP_PROP_BUFFERSIZE, self.buffer_size)

            # Set target FPS
            self.cap.set(cv2.CAP_PROP_FPS, self.fps)

            # Test if we can read a frame
            ret, frame = self.cap.read()
            if ret:
                print(f"Successfully connected to RTSP stream")
                print(f"  Backend: {self.cap.getBackendName()}")
                print(f"  Frame size: {frame.shape[1]}x{frame.shape[0]}")
                print(f"  Target FPS: {self.fps}")
                # Store the first frame
                with self.frame_lock:
                    self.latest_frame = frame
                return True
            else:
                print("Failed to read frame from RTSP stream")
                return False

        except Exception as e:
            print(f"Error connecting to RTSP stream: {e}")
            return False

    def _reader_loop(self):
        """Internal loop to continuously read frames from the stream"""
        while not self.stop_event.is_set():
            if self.cap and self.cap.isOpened():
                ret, frame = self.cap.read()
                if ret:
                    with self.frame_lock:
                        self.latest_frame = frame
                else:
                    print("Stream disconnected. Attempting to reconnect...")
                    self.cap.release()
                    time.sleep(5)  # Wait before trying to reconnect
                    self.initialize_video_capture()
            else:
                # Wait before trying to re-initialize
                time.sleep(5)
                self.initialize_video_capture()

    def _start_reader_thread(self):
        """Starts the frame reader thread"""
        print("Starting frame reader thread...")
        reader_thread = threading.Thread(target=self._reader_loop, daemon=True)
        reader_thread.start()

    def process_frame(self, frame: np.ndarray) -> Tuple[np.ndarray, List[Dict]]:
        """Process a single frame with YOLOv8 object detection"""
        try:
            # Store raw frame before any processing
            raw_frame = frame.copy()

            # Run YOLOv8 inference
            results = self.model(frame, conf=self.confidence, verbose=False, imgsz=640, iou=0.6, max_det=2000)

            detections = []
            devotee_count = 0

            # Create annotated frame copy for drawing
            annotated_frame = frame.copy()

            # Process results
            for result in results:
                boxes = result.boxes
                if boxes is not None:
                    for box in boxes:
                        # Extract detection information
                        x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                        confidence = box.conf[0].cpu().numpy()
                        class_id = int(box.cls[0].cpu().numpy())
                        class_name = self.model.names[class_id]
                        display_label = self.get_display_label(class_name)

                        # Count devotees (persons or people)
                        if class_name in self.person_classes:
                            devotee_count += 1

                        detection = {
                            'bbox': [int(x1), int(y1), int(x2), int(y2)],
                            'confidence': float(confidence),
                            'class_id': class_id,
                            'class_name': class_name,
                            'display_label': display_label
                        }
                        detections.append(detection)

                        # Draw bounding box on annotated frame only
                        cv2.rectangle(annotated_frame, (int(x1), int(y1)), (int(x2), int(y2)), (0, 255, 0), 2)

                        # Add label with custom display name
                        label = f"{display_label}: {confidence:.2f}"
                        cv2.putText(annotated_frame, label, (int(x1), int(y1) - 10),
                                  cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)

            # Store devotee count for averaging
            self.devotee_counts.append(devotee_count)

            # Send live heatmap frame every N processed frames (no disk I/O)
            self.live_frame_counter += 1
            if self.live_frame_counter >= self.live_frame_interval:
                self.live_frame_counter = 0
                heatmap_frame = self.generate_heatmap_frame(raw_frame, detections)
                threading.Thread(target=self.send_live_frame, args=(heatmap_frame,), daemon=True).start()

            # Store both raw and annotated frames for API calls
            self.last_raw_frame = raw_frame
            self.last_annotated_frame = annotated_frame

            # Check if we should make an API call
            if self.should_make_api_call() and self.last_raw_frame is not None:
                current_count = devotee_count  # instantaneous count for Live Now
                # Accumulate cumulative only at API interval, comparing to last API call count
                if current_count > self.last_frame_count:
                    self.cumulative_total += (current_count - self.last_frame_count)
                self.last_frame_count = current_count
                # Make API call in a separate thread to avoid blocking
                api_thread = threading.Thread(
                    target=self.make_api_call,
                    args=(current_count, "", ""),
                    daemon=True
                )
                api_thread.start()

                self.last_api_call_time = time.time()

            return annotated_frame, detections

        except Exception as e:
            print(f"Error processing frame: {e}")
            return frame, []

    def print_detection_results(self, detections: List[Dict], frame_number: int):
        """Print detection results summary to console"""
        timestamp = datetime.now().strftime("%H:%M:%S")

        # Count devotees in current frame
        current_devotees = sum(1 for d in detections if d['class_name'] in self.person_classes)
        avg_devotees = self.get_average_devotee_count()

        # Only print summary every 50 frames to reduce noise
        if frame_number % 50 == 0 or current_devotees > 0:
            total_objects = len(detections) - current_devotees
            print(f"[{timestamp}] {self.name} | Frame #{frame_number} | Devotees: {current_devotees} (avg: {avg_devotees}) | Objects: {total_objects}")

            self.detection_count += len(detections)

    def print_statistics(self):
        """Print pipeline statistics"""
        if self.start_time:
            elapsed_time = time.time() - self.start_time
            total_fps = self.frame_count / elapsed_time if elapsed_time > 0 else 0
            processing_fps = self.processed_frame_count / elapsed_time if elapsed_time > 0 else 0

            print(f"\n{'='*50}")
            print(f"Pipeline Statistics:")
            print(f"  Total frames: {self.frame_count}")
            print(f"  Processed frames: {self.processed_frame_count}")
            print(f"  Skip ratio: 1:{self.skip_frames} frames")
            print(f"  Total FPS: {total_fps:.1f}")
            print(f"  Processing FPS: {processing_fps:.1f}")
            print(f"  Total detections: {self.detection_count}")
            print(f"  Runtime: {elapsed_time:.1f} seconds")
            print(f"{'='*50}")

    def run(self, display_video: bool = False, save_output: bool = False, output_path: str = "output.mp4"):
        """Run the analytics pipeline"""
        # Initialize model and video capture
        if not self.initialize_model():
            return False

        if not self.initialize_video_capture():
            return False

        self.running = True
        self.start_time = time.time()

        # Start the non-blocking frame reader
        self._start_reader_thread()

        print(f"\nStarting analytics pipeline...")
        print(f"RTSP URL: {self.rtsp_url}")
        print(f"Model: {self.model_size}")
        print(f"Confidence threshold: {self.confidence}")
        print("="*50)

        try:
            while self.running:
                try:
                    with self.frame_lock:
                        frame = self.latest_frame

                    if frame is None:
                        # Wait for the reader thread to capture the first frame
                        time.sleep(0.5)
                        continue

                    # Update total frame counter
                    self.frame_count += 1

                    # Skip frames logic is now implicitly handled by the reader thread
                    self.frame_skip_counter += 1
                    if self.frame_skip_counter < self.skip_frames:
                        continue

                    self.frame_skip_counter = 0
                    self.processed_frame_count += 1

                    # Process frame
                    try:
                        # Create a copy for processing to avoid race conditions
                        processed_frame, detections = self.process_frame(frame.copy())
                    except Exception as e:
                        print(f"Error processing frame: {e}")
                        continue

                    if processed_frame is None:
                        print("Failed to process frame, skipping...")
                        continue

                    # Print detection results
                    self.print_detection_results(detections, self.processed_frame_count)

                    # Print statistics every 50 processed frames
                    if self.processed_frame_count % 50 == 0:
                        self.print_statistics()

                except KeyboardInterrupt:
                    print("\nReceived keyboard interrupt, stopping...")
                    break
                except Exception as e:
                    print(f"Error in processing loop: {e}")
                    import traceback
                    traceback.print_exc()
                    continue

        except Exception as e:
            print(f"Fatal error in main loop: {e}")
            import traceback
            traceback.print_exc()

        finally:
            # Cleanup
            print("\nCleaning up resources...")
            self.running = False
            self.stop_event.set()

            try:
                if self.cap:
                    self.cap.release()
            except Exception as e:
                print(f"Error releasing capture: {e}")

            # Print final statistics
            self.print_statistics()
            print("Pipeline stopped.")

        return True
