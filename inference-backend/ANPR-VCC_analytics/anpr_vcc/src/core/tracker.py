
import supervision as sv
import numpy as np

class Tracker:
    def __init__(self, fps=30):
        # Initialize ByteTrack - compatible with supervision 0.20+
        # New API doesn't use track_thresh, track_buffer, match_thresh
        try:
            # Try new API first (supervision 0.20+)
            self.tracker = sv.ByteTrack(frame_rate=fps)
        except TypeError:
            # Fallback for older supervision versions
            try:
                self.tracker = sv.ByteTrack(
                    track_thresh=0.25,
                    track_buffer=30,
                    match_thresh=0.8,
                    frame_rate=fps
                )
            except TypeError:
                # Minimal fallback
                self.tracker = sv.ByteTrack()
    
    def update(self, detections):
        """
        Update tracker with detections.
        Input: list of [x1, y1, x2, y2, conf, cls]
        Returns: sv.Detections object with tracker_id
        """
        if not detections:
            return sv.Detections.empty()
            
        # Convert to supervision Detections
        xyxy = np.array([d[:4] for d in detections])
        confidence = np.array([d[4] for d in detections])
        class_id = np.array([int(d[5]) for d in detections])
        
        sv_detections = sv.Detections(
            xyxy=xyxy,
            confidence=confidence,
            class_id=class_id
        )
        
        # Update tracker
        return self.tracker.update_with_detections(sv_detections)
