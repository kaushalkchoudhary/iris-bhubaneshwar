#!/usr/bin/env python3
"""
Duplicate Face Tracker
Prevents duplicate face reports using embedding similarity and quality scoring
"""

import numpy as np
import time
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass
import logging

logger = logging.getLogger(__name__)

@dataclass
class TrackedFace:
    """Stores information about a tracked face"""
    embedding: np.ndarray
    camera_id: str
    first_seen: float
    last_seen: float
    last_reported: float
    best_quality_score: float
    best_bbox: List[float]
    best_frame_data: Optional[Dict] = None
    detection_count: int = 1
    report_count: int = 0

class DuplicateTracker:
    """
    Tracks faces to prevent duplicate reports while maintaining quality
    """
    
    def __init__(self, 
                 similarity_threshold: float = 0.65,
                 short_window: float = 30.0,  # 30 seconds
                 long_window: float = 300.0,  # 5 minutes
                 max_tracked_faces: int = 1000):
        """
        Initialize the duplicate tracker
        
        Args:
            similarity_threshold: Cosine similarity threshold for same person (0.0-1.0)
            short_window: Time window for immediate duplicates (seconds)
            long_window: Time window before allowing re-report (seconds)
            max_tracked_faces: Maximum faces to track (LRU eviction)
        """
        self.similarity_threshold = similarity_threshold
        self.short_window = short_window
        self.long_window = long_window
        self.max_tracked_faces = max_tracked_faces
        
        # Store tracked faces with embedding as key
        self.tracked_faces: List[TrackedFace] = []
        
        # Statistics
        self.stats = {
            'total_checked': 0,
            'duplicates_found': 0,
            'quality_updates': 0,
            'reports_allowed': 0
        }
        
    def calculate_quality_score(self, face_data: Dict) -> float:
        """
        Calculate quality score for a face detection
        
        Args:
            face_data: Face detection data with bbox, confidence, etc.
            
        Returns:
            Quality score (0.0-1.0)
        """
        score = 0.0
        
        # Face size (larger is better)
        bbox = face_data.get('bbox', [])
        if len(bbox) >= 4:
            width = bbox[2] - bbox[0]
            height = bbox[3] - bbox[1]
            area = width * height
            # Normalize to 0-1 assuming ideal face is 200x200 pixels
            size_score = min(area / (200 * 200), 1.0)
            score += size_score * 0.4
        
        # Detection confidence
        confidence = face_data.get('embedding_norm', 0)
        normalized_conf = min(confidence / 30.0, 1.0)
        score += normalized_conf * 0.4
        
        # Face angle (frontal is better) - could be enhanced with landmark analysis
        # For now, use aspect ratio as proxy
        if len(bbox) >= 4:
            aspect_ratio = (bbox[3] - bbox[1]) / max(bbox[2] - bbox[0], 1)
            # Ideal aspect ratio is around 1.3
            angle_score = 1.0 - abs(aspect_ratio - 1.3) / 1.3
            score += max(0, angle_score) * 0.2
            
        return score
    
    def cosine_similarity(self, emb1: np.ndarray, emb2: np.ndarray) -> float:
        """Calculate cosine similarity between two embeddings"""
        return np.dot(emb1, emb2) / (np.linalg.norm(emb1) * np.linalg.norm(emb2))
    
    def find_duplicate(self, embedding: np.ndarray) -> Optional[Tuple[int, float]]:
        """
        Find if this embedding matches any tracked face
        
        Returns:
            Tuple of (index, similarity) if match found, None otherwise
        """
        if not isinstance(embedding, np.ndarray):
            embedding = np.array(embedding, dtype=np.float32)
            
        best_match_idx = -1
        best_similarity = 0.0
        
        for idx, tracked in enumerate(self.tracked_faces):
            similarity = self.cosine_similarity(embedding, tracked.embedding)
            if similarity > best_similarity and similarity >= self.similarity_threshold:
                best_similarity = similarity
                best_match_idx = idx
                
        if best_match_idx >= 0:
            return (best_match_idx, best_similarity)
        return None
    
    def should_report_face(self, 
                          face_data: Dict, 
                          camera_id: str,
                          frame_data: Optional[Dict] = None) -> Tuple[bool, Optional[Dict], str]:
        """
        Check if a face should be reported and return the best quality data
        
        Args:
            face_data: Current face detection data
            camera_id: Camera ID
            frame_data: Optional frame metadata
            
        Returns:
            Tuple of (should_report, best_face_data, reason)
        """
        self.stats['total_checked'] += 1
        current_time = time.time()
        
        # Extract embedding
        embedding = face_data.get('embedding')
        if not embedding:
            return True, face_data, "no_embedding"
            
        # Calculate quality score
        quality_score = self.calculate_quality_score(face_data)
        
        # Check for duplicates
        match = self.find_duplicate(embedding)
        
        if match is None:
            # New face - add to tracker
            if len(self.tracked_faces) >= self.max_tracked_faces:
                # Remove oldest entry (LRU)
                oldest_idx = min(range(len(self.tracked_faces)), 
                               key=lambda i: self.tracked_faces[i].last_seen)
                self.tracked_faces.pop(oldest_idx)
            
            tracked = TrackedFace(
                embedding=np.array(embedding, dtype=np.float32),
                camera_id=camera_id,
                first_seen=current_time,
                last_seen=current_time,
                last_reported=current_time,
                best_quality_score=quality_score,
                best_bbox=face_data.get('bbox', []),
                best_frame_data=face_data,
                detection_count=1,
                report_count=1
            )
            self.tracked_faces.append(tracked)
            self.stats['reports_allowed'] += 1
            
            logger.debug(f"New face detected with quality score: {quality_score:.3f}")
            return True, face_data, "new_face"
        
        # Found duplicate
        idx, similarity = match
        tracked = self.tracked_faces[idx]
        tracked.last_seen = current_time
        tracked.detection_count += 1
        self.stats['duplicates_found'] += 1
        
        # Check if quality is better
        if quality_score > tracked.best_quality_score:
            tracked.best_quality_score = quality_score
            tracked.best_bbox = face_data.get('bbox', [])
            tracked.best_frame_data = face_data
            self.stats['quality_updates'] += 1
            
            # Use short window for quality updates
            if current_time - tracked.last_reported >= self.short_window:
                tracked.last_reported = current_time
                tracked.report_count += 1
                self.stats['reports_allowed'] += 1
                
                logger.debug(f"Reporting better quality face (similarity: {similarity:.3f}, "
                           f"quality: {quality_score:.3f} > {tracked.best_quality_score:.3f})")
                return True, face_data, "quality_update"
        
        # Check if enough time has passed for re-report
        time_since_report = current_time - tracked.last_reported
        if time_since_report >= self.long_window:
            tracked.last_reported = current_time
            tracked.report_count += 1
            self.stats['reports_allowed'] += 1
            
            logger.debug(f"Re-reporting face after {time_since_report:.1f}s (similarity: {similarity:.3f})")
            return True, tracked.best_frame_data or face_data, "time_window"
        
        # Skip this duplicate
        logger.debug(f"Skipping duplicate face (similarity: {similarity:.3f}, "
                   f"last reported: {time_since_report:.1f}s ago)")
        return False, None, "duplicate"
    
    def get_statistics(self) -> Dict:
        """Get tracker statistics"""
        stats = self.stats.copy()
        stats['tracked_faces'] = len(self.tracked_faces)
        stats['duplicate_rate'] = int(stats['duplicates_found'] / 
                                 max(stats['total_checked'], 1)) * 100
        return stats
    
    def cleanup_old_faces(self, max_age: float = 3600.0):
        """Remove faces older than max_age seconds"""
        current_time = time.time()
        original_count = len(self.tracked_faces)
        
        self.tracked_faces = [
            face for face in self.tracked_faces 
            if current_time - face.last_seen < max_age
        ]
        
        removed = original_count - len(self.tracked_faces)
        if removed > 0:
            logger.info(f"Cleaned up {removed} old faces from tracker") 