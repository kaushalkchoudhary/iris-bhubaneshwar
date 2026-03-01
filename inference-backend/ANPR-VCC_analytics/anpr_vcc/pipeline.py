
import cv2
import time
import numpy as np
from collections import defaultdict
from datetime import datetime
import os

from anpr_vcc.config.config import Config
from anpr_vcc.src.core.detector import Detector
from anpr_vcc.src.core.ocr import OCRRecognizer
from anpr_vcc.src.core.tracker import Tracker
from anpr_vcc.src.results_io.visualizer import Visualizer
from anpr_vcc.central_server_client import (
    send_vcc_event_async,
    send_anpr_detection_async
)


def map_vehicle_class_name(yolo_class_name: str) -> str:
    """Map YOLO class names to dashboard convention."""
    mapping = {
        'motorcycle': '2W',
        'car': '4W',
        'auto': 'AUTO',
        'truck': 'TRUCK',
        'bus': 'BUS',
        'plate': 'UNKNOWN',
    }
    return mapping.get(yolo_class_name.lower(), 'UNKNOWN')


def _box_area(box):
    """Calculate area of a bounding box [x1, y1, x2, y2]."""
    return max(0, box[2] - box[0]) * max(0, box[3] - box[1])


def _intersection_area(box_a, box_b):
    """Calculate intersection area of two boxes."""
    ix1 = max(box_a[0], box_b[0])
    iy1 = max(box_a[1], box_b[1])
    ix2 = min(box_a[2], box_b[2])
    iy2 = min(box_a[3], box_b[3])
    if ix2 <= ix1 or iy2 <= iy1:
        return 0.0
    return (ix2 - ix1) * (iy2 - iy1)


def associate_plate_to_vehicle(vehicle_box, plate_boxes, max_distance=200):
    """Find the best matching plate for a vehicle using center-distance.

    Args:
        vehicle_box: [x1, y1, x2, y2] of vehicle
        plate_boxes: list of [x1, y1, x2, y2] for candidate plates
        max_distance: maximum allowed distance (pixels)

    Returns:
        Index of the best plate or None
    """
    if not plate_boxes:
        return None

    vx1, vy1, vx2, vy2 = vehicle_box
    vcx = (vx1 + vx2) / 2
    vcy = (vy1 + vy2) / 2

    best_idx = None
    best_dist = max_distance

    for idx, p in enumerate(plate_boxes):
        pcx = (p[0] + p[2]) / 2
        pcy = (p[1] + p[3]) / 2
        dist = ((pcx - vcx) ** 2 + (pcy - vcy) ** 2) ** 0.5
        # Plate should be within the vehicle's bounding box vertically
        if p[1] >= vy1 and p[3] <= vy2 and dist < best_dist:
            best_dist = dist
            best_idx = idx

    return best_idx


class VCCAnprPipeline:
    def __init__(self, camera_id=1, camera_name=None, config=None, frame_callback=None):
        self.camera_id = camera_id
        self.camera_name = camera_name or f"CAMERA_{camera_id}"
        self.config = config or {}
        self.frame_callback = frame_callback

        self.enabled_modes = Config.ENABLED_DETECTION_MODES

        print(f"Initializing VCC/ANPR Pipeline (Camera {self.camera_name})...")
        print(f"Enabled Detection Modes: {self.enabled_modes}")

        # Models
        self.detector_traffic = Detector(Config.MODEL_TRAFFIC, Config.DEVICE)
        print(f"Traffic Model Classes: {self.detector_traffic.model.names}")
        self.ocr = OCRRecognizer()

        self.tracker_traffic = Tracker()
        self.visualizer = Visualizer()

        # Throttling state for OCR
        self.last_ocr_frames = {}  # {vehicle_id: frame_idx}

        # VCC state
        self.vcc_counts = defaultdict(int)       # Current frame counts
        self.vcc_total_counts = defaultdict(int) # Session totals
        self.vcc_seen_vehicles = set()            # Unique vehicle IDs

        # ANPR state
        self.anpr_sent_vehicles = {}  # {track_id: timestamp} for deduplication

    def _cleanup_tracking_dicts(self, current_frame_idx):
        """Periodically clean tracking dictionaries to prevent memory leaks."""
        MAX_TRACKING_AGE = 100  # frames

        # Clean old OCR frames
        old_ids = [vid for vid, last_frame in self.last_ocr_frames.items()
                   if (current_frame_idx - last_frame) > MAX_TRACKING_AGE]
        for vid in old_ids:
            del self.last_ocr_frames[vid]

        # Clean old ANPR tracking
        current_time = time.time()
        old_ids = [vid for vid, timestamp in self.anpr_sent_vehicles.items()
                   if (current_time - timestamp) > 60]
        for vid in old_ids:
            del self.anpr_sent_vehicles[vid]

        # Limit VCC seen vehicles
        if len(self.vcc_seen_vehicles) > 5000:
            self.vcc_seen_vehicles.clear()

    def run_on_stream(self, source):
        """Process video file or RTSP stream."""
        is_rtsp = source.lower().startswith("rtsp://")

        cap = None
        if is_rtsp:
            print(f"[{self.camera_name}] Using FFMPEG for RTSP stream...", flush=True)
            if 'OPENCV_FFMPEG_CAPTURE_OPTIONS' not in os.environ:
                os.environ['OPENCV_FFMPEG_CAPTURE_OPTIONS'] = 'rtsp_transport;tcp|buffer_size;4096000|max_delay;5000000'
            cap = cv2.VideoCapture(source, cv2.CAP_FFMPEG)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 3)
        else:
            cap = cv2.VideoCapture(source)

        if not cap.isOpened():
            raise ConnectionError(f"Could not open source: {source}")

        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if total_frames < 0 or total_frames > 1000000 or is_rtsp:
            total_str = "Live Stream"
            total_frames = float('inf')
        else:
            total_str = f"{total_frames} frames"

        frame_idx = 0
        fps_start_time = time.time()
        fps_frame_count = 0
        current_fps = 0.0

        print(f"[Camera {self.camera_id}] Starting processing on {source} ({total_str})...")

        while True:
            try:
                ret, frame = cap.read()
                if not ret:
                    if is_rtsp:
                        print(f"[{self.camera_name}] Connection lost. Reconnecting in {Config.RECONNECT_DELAY}s...", flush=True)
                        cap.release()
                        time.sleep(Config.RECONNECT_DELAY)
                        try:
                            if 'OPENCV_FFMPEG_CAPTURE_OPTIONS' not in os.environ:
                                os.environ['OPENCV_FFMPEG_CAPTURE_OPTIONS'] = 'rtsp_transport;tcp|buffer_size;4096000|max_delay;5000000'
                            cap = cv2.VideoCapture(source, cv2.CAP_FFMPEG)
                            cap.set(cv2.CAP_PROP_BUFFERSIZE, 3)
                            if not cap.isOpened():
                                print(f"  Reconnection failed.", flush=True)
                            else:
                                print(f"  Reconnected!", flush=True)
                        except Exception as e:
                            print(f"  Reconnection error: {e}", flush=True)
                        continue
                    else:
                        print(f"Stream or file ended at frame {frame_idx}.")
                        break

                if frame is None:
                    print(f"Warning: Received empty frame at index {frame_idx}. Skipping.")
                    continue

                if frame_idx % (Config.FRAME_SKIP + 1) != 0:
                    frame_idx += 1
                    continue

                frame_idx += 1

                # Periodic memory cleanup every 500 frames
                if frame_idx % 500 == 0:
                    self._cleanup_tracking_dicts(frame_idx)

                # --- 1. Detection ---
                detections_traffic = self.detector_traffic.detect(frame, Config.CONF_PLATE)

                # --- 2. Filter & Track ---
                traffic_for_tracking = []
                plates_raw = []  # [x1, y1, x2, y2, conf, cls]

                for d in detections_traffic:
                    cls_id = int(d[5])
                    conf = d[4]
                    if cls_id == 5:  # plate class
                        if conf >= Config.CONF_PLATE:
                            plates_raw.append(d)
                    else:
                        if conf >= Config.CONF_TRAFFIC_DEFAULT:
                            traffic_for_tracking.append(d)

                sv_tracks_traffic = self.tracker_traffic.update(traffic_for_tracking)

                # --- 3. FPS Calculation ---
                fps_frame_count += 1
                if time.time() - fps_start_time >= 1.0:
                    current_fps = fps_frame_count / (time.time() - fps_start_time)
                    fps_frame_count = 0
                    fps_start_time = time.time()

                # --- 4. Streaming Callback ---
                if self.frame_callback:
                    try:
                        self.frame_callback(frame)
                    except Exception as e:
                        print(f"Streaming callback error: {e}")

                # --- 5. Debug Print ---
                if frame_idx % 10 == 0:
                    plate_texts = []
                    if sv_tracks_traffic.tracker_id is not None:
                        for tid in sv_tracks_traffic.tracker_id:
                            text, conf = self.ocr.get_best_text(tid)
                            if text:
                                plate_texts.append(f"{text}({conf:.2f})")
                    plate_info = f" | Plates: {', '.join(plate_texts) if plate_texts else str(len(plates_raw))}"
                    print(f"Frame {frame_idx} | Traffic: {len(traffic_for_tracking)}{plate_info} | FPS: {current_fps:.2f}", flush=True)

                # --- 6. VCC Mode ---
                if "vcc" in self.enabled_modes:
                    self._process_vcc(sv_tracks_traffic, frame_idx)

                # --- 7. ANPR Mode ---
                if "anpr" in self.enabled_modes:
                    self._process_anpr(sv_tracks_traffic, plates_raw, frame, frame_idx)

            except Exception as e:
                print(f"\nCRITICAL ERROR at frame {frame_idx}: {e}")
                import traceback
                traceback.print_exc()
                break

        cap.release()
        print("Processing complete.")

    def _process_vcc(self, sv_tracks_traffic, frame_idx):
        """Process VCC (Vehicle Classification & Counting) mode."""
        self.vcc_counts.clear()

        if sv_tracks_traffic.tracker_id is None:
            return

        for i, track_id in enumerate(sv_tracks_traffic.tracker_id):
            class_id = int(sv_tracks_traffic.class_id[i])
            yolo_class_name = self.detector_traffic.model.names[class_id]
            dashboard_class_name = map_vehicle_class_name(yolo_class_name)

            if dashboard_class_name == "UNKNOWN":
                continue

            self.vcc_counts[dashboard_class_name] += 1

            if track_id not in self.vcc_seen_vehicles:
                self.vcc_seen_vehicles.add(track_id)
                self.vcc_total_counts[dashboard_class_name] += 1

        if frame_idx % Config.VCC_SEND_INTERVAL_FRAMES == 0 and self.vcc_counts:
            send_vcc_event_async(
                camera_id=self.camera_id,
                vehicle_counts=dict(self.vcc_counts),
                timestamp=datetime.now(),
                camera_name=self.camera_name
            )

    def _process_anpr(self, sv_tracks_traffic, plates_raw, frame, frame_idx):
        """Process ANPR (Automatic Number Plate Recognition) mode."""
        if sv_tracks_traffic.tracker_id is None:
            return

        current_time = time.time()
        h_img, w_img = frame.shape[:2]

        for i, track_id in enumerate(sv_tracks_traffic.tracker_id):
            bbox = sv_tracks_traffic.xyxy[i]
            class_id = int(sv_tracks_traffic.class_id[i])
            yolo_class_name = self.detector_traffic.model.names[class_id]
            dashboard_class_name = map_vehicle_class_name(yolo_class_name)

            if dashboard_class_name == "UNKNOWN":
                continue

            # Deduplication check
            if track_id in self.anpr_sent_vehicles:
                last_sent_time = self.anpr_sent_vehicles[track_id]
                if (current_time - last_sent_time) < Config.ANPR_DEDUPE_WINDOW:
                    continue

            # Find plate for this vehicle
            plate_boxes_only = [p[:4] for p in plates_raw]
            plate_idx = associate_plate_to_vehicle(bbox, plate_boxes_only)

            if plate_idx is not None:
                plate_box = plates_raw[plate_idx][:4]
                plate_conf = plates_raw[plate_idx][4]

                if plate_conf < Config.ANPR_MIN_PLATE_CONFIDENCE:
                    continue

                # Crop plate with padding
                px1, py1, px2, py2 = map(int, plate_box)
                pad = 5
                px1 = max(0, px1 - pad)
                py1 = max(0, py1 - pad)
                px2 = min(w_img, px2 + pad)
                py2 = min(h_img, py2 + pad)

                plate_crop = frame[py1:py2, px1:px2]

                if plate_crop.size > 0:
                    ocr_result = self.ocr.recognize_batch([plate_crop])
                    if ocr_result:
                        _, plate_text = ocr_result[0]

                        # Save crops
                        anpr_output_dir = os.path.join(Config.OUTPUT_DIR, 'anpr')
                        os.makedirs(anpr_output_dir, exist_ok=True)

                        timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
                        plate_filename = f"plate_{track_id}_{timestamp_str}.jpg"
                        vehicle_filename = f"vehicle_{track_id}_{timestamp_str}.jpg"

                        plate_path = os.path.join(anpr_output_dir, plate_filename)
                        vehicle_path = os.path.join(anpr_output_dir, vehicle_filename)

                        cv2.imwrite(plate_path, plate_crop)

                        vx1, vy1, vx2, vy2 = map(int, bbox)
                        vehicle_crop = frame[vy1:vy2, vx1:vx2]
                        if vehicle_crop.size > 0:
                            cv2.imwrite(vehicle_path, vehicle_crop)

                        send_anpr_detection_async(
                            camera_id=self.camera_id,
                            plate_number=plate_text,
                            vehicle_type=dashboard_class_name,
                            plate_confidence=float(plate_conf),
                            plate_image_path=plate_path,
                            vehicle_image_path=vehicle_path,
                            timestamp=datetime.now(),
                            camera_name=self.camera_name
                        )

                        self.anpr_sent_vehicles[track_id] = current_time


# Backwards-compatibility alias
UnifiedPipeline = VCCAnprPipeline
