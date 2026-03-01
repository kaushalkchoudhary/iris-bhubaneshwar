import cv2
import numpy as np


class Visualizer:
    """Lightweight visualizer for VCC/ANPR Pipeline."""

    # Colors (B, G, R)
    COLOR_VEHICLE = (255, 100, 0)  # Blue-ish for vehicles
    COLOR_PLATE = (0, 255, 255)    # Yellow for plates
    COLOR_TEXT = (255, 255, 255)   # White

    def draw_tracks(self, frame, traffic_tracks, plate_results=None):
        """Draw vehicle and plate tracking boxes.

        Args:
            frame: Image to draw on.
            traffic_tracks: Supervision Detections object for traffic.
            plate_results: Optional dict {track_id: (text, conf)} for OCR results.
        """
        annotated_frame = frame.copy()

        if traffic_tracks.tracker_id is None:
            return annotated_frame

        for i, track_id in enumerate(traffic_tracks.tracker_id):
            box = traffic_tracks.xyxy[i].astype(int)
            cls_id = int(traffic_tracks.class_id[i]) if traffic_tracks.class_id is not None else -1

            if cls_id == 5:  # Plate
                color = self.COLOR_PLATE
                label = f"Plate #{track_id}"
                if plate_results and track_id in plate_results:
                    text, conf = plate_results[track_id]
                    label = f"{text} ({conf:.2f})"
            else:
                color = self.COLOR_VEHICLE
                vehicle_type = {0: 'Auto', 1: 'Bus', 2: 'Car', 3: 'Motorcycle', 4: 'Truck'}.get(cls_id, 'Vehicle')
                label = f"{vehicle_type} #{track_id}"

            cv2.rectangle(annotated_frame, (box[0], box[1]), (box[2], box[3]), color, 2)
            self._draw_label(annotated_frame, label, box, color)

        return annotated_frame

    def _draw_label(self, frame, label, box, bg_color):
        """Helper to draw a filled text box."""
        (text_w, text_h), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 1)
        x1, y1 = box[0], box[1]
        cv2.rectangle(frame, (x1, y1 - 20), (x1 + text_w, y1), bg_color, -1)
        cv2.putText(frame, label, (x1, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.6, self.COLOR_TEXT, 1)

    def draw_stats(self, frame, frame_idx, total_frames, fps=0):
        """Draw HUD statistics."""
        info = f"Frame: {frame_idx}/{total_frames} | FPS: {fps:.1f}"
        cv2.putText(frame, info, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
