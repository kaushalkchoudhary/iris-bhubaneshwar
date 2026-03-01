#!/usr/bin/env python3
"""
Crowd Flow Analytics Pipeline — Line-crossing entry/exit tracking using YOLOv8
Adapted from iris2 crowd-flow-count pipeline for iris-sringeri backend.
"""

import cv2
import numpy as np
from ultralytics import YOLO
import time
from datetime import datetime
import threading
import base64
import requests
import json
from collections import deque
from typing import Optional, Dict, List, Tuple
import logging
import os
from pathlib import Path


def setup_logging(name: str) -> logging.Logger:
    log_dir = Path("logs")
    log_dir.mkdir(exist_ok=True)

    logger = logging.getLogger(f"pipeline.{name}")
    logger.setLevel(logging.INFO)

    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))

    api_file_handler = logging.FileHandler(log_dir / f"{name}_api_responses.log")
    api_file_handler.setLevel(logging.INFO)
    api_file_handler.setFormatter(logging.Formatter('%(asctime)s - %(message)s'))

    logger.addHandler(console_handler)
    logger.addHandler(api_file_handler)
    return logger


class LineCrossingTracker:
    """
    Tracks people crossing a virtual horizontal line for crowd flow analysis.
    Detects crossing direction (incoming / outgoing) per frame-to-frame Y delta.
    """

    def __init__(self, line_y: int, line_color: Tuple[int, int, int] = (0, 0, 255)):
        self.line_y = line_y
        self.line_color = line_color
        self.tracked_objects: Dict = {}
        self.crossing_count = 0
        self.incoming_count = 0
        self.outgoing_count = 0
        # rolling deque of flow events for per-interval reporting
        self.flow_events: deque = deque(maxlen=300)

    def update(self, detections: List[Dict]) -> Tuple[int, int, int]:
        """Update tracking and count crossings. Returns (new_crossings, new_incoming, new_outgoing)."""
        new_crossings = 0
        new_incoming = 0
        new_outgoing = 0
        current_objects: Dict = {}

        for detection in detections:
            if detection['class_name'] not in {'person', 'people', 'head'}:
                continue

            bbox = detection['bbox']
            center_x = int((bbox[0] + bbox[2]) / 2)
            center_y = int((bbox[1] + bbox[3]) / 2)

            best_match = None
            best_dist = float('inf')
            for obj_id, obj_data in self.tracked_objects.items():
                prev_cx = int((obj_data['bbox'][0] + obj_data['bbox'][2]) / 2)
                prev_cy = int((obj_data['bbox'][1] + obj_data['bbox'][3]) / 2)
                dist = ((center_x - prev_cx) ** 2 + (center_y - prev_cy) ** 2) ** 0.5
                if dist < best_dist and dist < 100:
                    best_dist = dist
                    best_match = obj_id

            obj_id = best_match if best_match is not None else id(detection)
            prev_center_y = self.tracked_objects[best_match].get(
                'last_center_y',
                int((self.tracked_objects[best_match]['bbox'][1] + self.tracked_objects[best_match]['bbox'][3]) / 2)
            ) if best_match is not None else center_y

            # Detect crossing
            crossed = (
                (prev_center_y < self.line_y and center_y >= self.line_y) or
                (prev_center_y > self.line_y and center_y <= self.line_y)
            )
            if crossed and best_match is not None and not self.tracked_objects[best_match].get('crossed', False):
                direction = 'incoming' if center_y >= self.line_y else 'outgoing'
                new_crossings += 1
                self.crossing_count += 1
                if direction == 'incoming':
                    new_incoming += 1
                    self.incoming_count += 1
                else:
                    new_outgoing += 1
                    self.outgoing_count += 1

                self.flow_events.append({
                    'timestamp': time.time(),
                    'direction': direction,
                    'position': (center_x, center_y)
                })
                current_objects[obj_id] = {'bbox': bbox, 'crossed': True, 'direction': direction, 'last_center_y': center_y}
            else:
                current_objects[obj_id] = {
                    'bbox': bbox,
                    'crossed': self.tracked_objects.get(obj_id, {}).get('crossed', False),
                    'direction': self.tracked_objects.get(obj_id, {}).get('direction', 'unknown'),
                    'last_center_y': center_y
                }

        self.tracked_objects = current_objects
        return new_crossings, new_incoming, new_outgoing

    def get_recent_flow_data(self, time_window: int = 300) -> Tuple[int, int]:
        """Return (flow_in, flow_out) counts within the given time window (seconds)."""
        now = time.time()
        cutoff = now - time_window
        flow_in = sum(1 for e in self.flow_events if e['timestamp'] >= cutoff and e['direction'] == 'incoming')
        flow_out = sum(1 for e in self.flow_events if e['timestamp'] >= cutoff and e['direction'] == 'outgoing')
        return flow_in, flow_out

    def draw_line_and_counters(self, frame: np.ndarray) -> np.ndarray:
        """Draw the crossing line and flow counters on the frame."""
        height, width = frame.shape[:2]
        cv2.line(frame, (0, self.line_y), (width, self.line_y), self.line_color, 3)
        label = f"Flow Line | Total: {self.crossing_count} | In: {self.incoming_count} | Out: {self.outgoing_count}"
        cv2.putText(frame, label, (10, self.line_y - 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, self.line_color, 2)
        return frame


class CrowdFlowPipeline:
    """
    Analytics pipeline for RTSP streams with YOLOv8 detection and line-crossing flow analysis.
    Posts flow data (flow_in, flow_out, peopleCount) to the iris backend crowd analysis endpoint.
    """

    def __init__(self, name: str, rtsp_url: str, camera_id: str, location_id: str,
                 interval: int = 5, model_size: str = "crowd-counting-8hvzc-pvx6p-1.pt",
                 confidence: float = 0.2, skip_frames: int = 2, fps: int = 30,
                 api_base_url: str = None, api_token: str = None,
                 rtsp_transport: str = "tcp", buffer_size: int = 5,
                 line_position: float = 0.5):

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
        self.line_position = line_position
        self.frame_skip_counter = 0
        self.model = None
        self.cap = None
        self.line_tracker: Optional[LineCrossingTracker] = None
        self.running = False

        # Persist cumulative counts across reconnects / video file loops
        self.cumulative_incoming = 0
        self.cumulative_outgoing = 0

        self.latest_frame = None
        self.frame_lock = threading.Lock()
        self.stop_event = threading.Event()

        self.frame_count = 0
        self.processed_frame_count = 0
        self.detection_count = 0
        self.start_time = None

        self.person_classes = {'person', 'people', 'head'}

        # API
        self.api_base_url = api_base_url or "http://localhost:3002"
        self.api_token = api_token
        base = self.api_base_url.rstrip('/').rstrip('/api').rstrip('/')
        self.api_url = f"{base}/api/inference/crowd/analysis"
        self.api_call_interval = interval
        self.last_api_call_time = 0

        # Rolling window of per-frame people counts for stable reporting
        self.people_count_window: deque = deque(maxlen=200)
        self.current_people_count = 0

        self.logger = setup_logging(name)

    # ── Model / capture ─────────────────────────────────────────────────────

    def initialize_model(self) -> bool:
        try:
            script_dir = Path(__file__).parent
            if self.model_size.endswith('.pt'):
                model_path = script_dir / 'models' / self.model_size
                if not model_path.exists():
                    model_path = script_dir / self.model_size
                if model_path.exists():
                    print(f"Loading crowd-flow model: {model_path}")
                    self.model = YOLO(str(model_path))
                else:
                    print(f"Model not found at {model_path}, falling back to yolov8s.pt")
                    self.model = YOLO("yolov8s.pt")
            else:
                self.model = YOLO(self.model_size)
            print("Model loaded successfully!")
            return True
        except Exception as e:
            print(f"Error loading model: {e}")
            return False

    def initialize_video_capture(self) -> bool:
        try:
            print(f"Connecting to RTSP stream: {self.rtsp_url}")
            if self.rtsp_transport.lower() == "tcp":
                os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"
            elif "OPENCV_FFMPEG_CAPTURE_OPTIONS" in os.environ:
                del os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"]

            self.cap = cv2.VideoCapture(self.rtsp_url, cv2.CAP_FFMPEG)
            self.cap.set(cv2.CAP_PROP_BUFFERSIZE, self.buffer_size)
            self.cap.set(cv2.CAP_PROP_FPS, self.fps)

            ret, frame = self.cap.read()
            if not ret:
                print("Failed to read frame from RTSP stream")
                return False

            height, width = frame.shape[:2]
            print(f"Connected: {width}x{height} @ {self.fps}fps")

            # Save cumulative counts before replacing tracker (handles reconnects)
            if self.line_tracker is not None:
                self.cumulative_incoming += self.line_tracker.incoming_count
                self.cumulative_outgoing += self.line_tracker.outgoing_count

            line_y = int(height * self.line_position)
            self.line_tracker = LineCrossingTracker(line_y)
            print(f"Flow detection line at Y={line_y} ({self.line_position*100:.0f}% from top)")

            with self.frame_lock:
                self.latest_frame = frame
            return True

        except Exception as e:
            print(f"Error connecting to RTSP stream: {e}")
            return False

    def _reader_loop(self):
        while not self.stop_event.is_set():
            if self.cap and self.cap.isOpened():
                ret, frame = self.cap.read()
                if ret:
                    with self.frame_lock:
                        self.latest_frame = frame
                else:
                    print("Stream disconnected, reconnecting...")
                    self.cap.release()
                    time.sleep(5)
                    self.initialize_video_capture()
            else:
                time.sleep(5)
                self.initialize_video_capture()

    def _start_reader_thread(self):
        threading.Thread(target=self._reader_loop, daemon=True).start()

    # ── API ─────────────────────────────────────────────────────────────────

    def should_make_api_call(self) -> bool:
        return (time.time() - self.last_api_call_time) >= self.api_call_interval

    def make_api_call(self, flow_in: int, flow_out: int):
        try:
            headers = {'Content-Type': 'application/json'}
            if self.api_token:
                headers['Authorization'] = f'Bearer {self.api_token}'

            current_count = max(self.people_count_window) if self.people_count_window else self.current_people_count
            net_flow = flow_in - flow_out

            if current_count < 50:
                density_level = "LOW"
            elif current_count < 150:
                density_level = "MEDIUM"
            elif current_count < 500:
                density_level = "HIGH"
            else:
                density_level = "CRITICAL"

            payload = {
                "deviceId": self.camera_id,
                "peopleCount": current_count,
                "cumulativeCount": self.cumulative_incoming + (self.line_tracker.incoming_count if self.line_tracker else 0),
                "flowRate": float(net_flow),
                "densityLevel": density_level,
                "movementType": "FLOWING" if abs(net_flow) > 2 else "STATIC",
                "congestionLevel": min(100, current_count // 5),
                "confidence": round(min(0.95, max(0.7, 0.85 + (flow_in + flow_out) * 0.02)), 2),
                "modelType": "yolov8-crowd-flow",
                "timestamp": datetime.now().isoformat() + "Z",
            }

            self.logger.info(
                f"Flow API | Camera: {self.camera_id} | People: {current_count} "
                f"| In: {flow_in} | Out: {flow_out} | Net: {net_flow:+d} | Density: {density_level}"
            )

            response = requests.post(self.api_url, headers=headers, json=payload, timeout=10)
            if response.status_code in (200, 201):
                self.logger.info(f"Flow API call OK for {self.name}")
            else:
                self.logger.error(f"Flow API call failed for {self.name}: {response.status_code} {response.text}")

        except Exception as e:
            self.logger.error(f"Flow API call error for {self.name}: {e}")

    # ── Frame processing ─────────────────────────────────────────────────────

    def process_frame(self, frame: np.ndarray) -> Tuple[np.ndarray, List[Dict]]:
        try:
            results = self.model(frame, conf=self.confidence, verbose=False, max_det=1000)
            detections = []
            annotated_frame = frame.copy()

            for result in results:
                if result.boxes is None:
                    continue
                for box in result.boxes:
                    x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                    conf = float(box.conf[0].cpu().numpy())
                    class_id = int(box.cls[0].cpu().numpy())
                    class_name = self.model.names[class_id]

                    det = {
                        'bbox': [int(x1), int(y1), int(x2), int(y2)],
                        'confidence': conf,
                        'class_id': class_id,
                        'class_name': class_name,
                    }
                    detections.append(det)

                    if class_name in self.person_classes:
                        cv2.rectangle(annotated_frame, (int(x1), int(y1)), (int(x2), int(y2)), (0, 255, 0), 2)

            frame_count = sum(1 for d in detections if d['class_name'] in self.person_classes)
            self.people_count_window.append(frame_count)
            self.current_people_count = frame_count

            if self.line_tracker:
                self.line_tracker.update(detections)
                annotated_frame = self.line_tracker.draw_line_and_counters(annotated_frame)

                if self.should_make_api_call():
                    flow_in, flow_out = self.line_tracker.get_recent_flow_data(self.api_call_interval)
                    threading.Thread(target=self.make_api_call, args=(flow_in, flow_out), daemon=True).start()
                    self.last_api_call_time = time.time()

            return annotated_frame, detections

        except Exception as e:
            print(f"Error processing frame: {e}")
            return frame, []

    def print_detection_results(self, detections: List[Dict], frame_number: int):
        if frame_number % 50 != 0 and self.current_people_count == 0:
            return
        ts = datetime.now().strftime("%H:%M:%S")
        flow_stats = ""
        if self.line_tracker:
            flow_stats = (
                f" | In: {self.line_tracker.incoming_count} "
                f"| Out: {self.line_tracker.outgoing_count} "
                f"| Net: {self.line_tracker.incoming_count - self.line_tracker.outgoing_count:+d}"
            )
        print(f"[{ts}] {self.name} | Frame #{frame_number} | People: {self.current_people_count}{flow_stats}")
        self.detection_count += len(detections)

    # ── Run ──────────────────────────────────────────────────────────────────

    def run_with_stop_event(self, stop_event, display_video: bool = False,
                            save_output: bool = False, output_path: str = "output.mp4"):
        """Run pipeline controlled by an external stop_event (used by process orchestrator)."""
        if not self.initialize_model():
            return False
        if not self.initialize_video_capture():
            return False

        self.running = True
        self.start_time = time.time()
        self._start_reader_thread()

        print(f"\nCrowd-flow pipeline started: {self.name}")
        print(f"RTSP: {self.rtsp_url} | Model: {self.model_size} | Line: {self.line_position*100:.0f}%")
        print("=" * 50)

        try:
            while self.running and not stop_event.is_set():
                try:
                    with self.frame_lock:
                        frame = self.latest_frame

                    if frame is None:
                        time.sleep(0.5)
                        continue

                    self.frame_count += 1
                    self.frame_skip_counter += 1
                    if self.frame_skip_counter < self.skip_frames:
                        continue

                    self.frame_skip_counter = 0
                    self.processed_frame_count += 1

                    processed_frame, detections = self.process_frame(frame.copy())
                    self.print_detection_results(detections, self.processed_frame_count)

                    if self.processed_frame_count % 100 == 0:
                        elapsed = time.time() - self.start_time
                        fps = self.processed_frame_count / elapsed if elapsed > 0 else 0
                        print(f"[Stats] {self.name} | Frames: {self.processed_frame_count} | FPS: {fps:.1f} | Runtime: {elapsed:.0f}s")

                except KeyboardInterrupt:
                    break
                except Exception as e:
                    print(f"Error in processing loop: {e}")
                    continue

        finally:
            self.running = False
            self.stop_event.set()
            if self.cap:
                self.cap.release()
            if self.line_tracker:
                total_in = self.cumulative_incoming + self.line_tracker.incoming_count
                total_out = self.cumulative_outgoing + self.line_tracker.outgoing_count
                print(f"[{self.name}] Final: In={total_in} Out={total_out} Net={total_in - total_out:+d}")
            print(f"Crowd-flow pipeline stopped: {self.name}")

        return True

    def run(self, display_video: bool = False, save_output: bool = False, output_path: str = "output.mp4"):
        """Fallback run method (delegates to run_with_stop_event with an internal stop)."""
        return self.run_with_stop_event(threading.Event(), display_video, save_output, output_path)
