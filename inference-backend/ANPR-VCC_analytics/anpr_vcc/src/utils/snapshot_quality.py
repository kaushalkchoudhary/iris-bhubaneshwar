"""
Snapshot Quality Assessment Utilities.

Provides functions for:
- Blur detection using Laplacian variance
- Snapshot quality scoring
- Best frame selection from buffer
"""

import cv2
import numpy as np
from typing import List, Tuple, Optional


def calculate_blur_score(image: np.ndarray) -> float:
    """
    Calculate blur score using Laplacian variance method.
    
    Args:
        image: Input image (BGR or grayscale)
        
    Returns:
        float: Variance of Laplacian (higher = sharper, lower = blurrier)
               Typical values: <50 very blurry, 50-100 blurry, >100 sharp
    """
    if image is None or image.size == 0:
        return 0.0
    
    # Convert to grayscale if needed
    if len(image.shape) == 3:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    else:
        gray = image
    
    # Calculate Laplacian variance
    laplacian = cv2.Laplacian(gray, cv2.CV_64F)
    variance = laplacian.var()
    
    return float(variance)


def calculate_snapshot_quality(frame: np.ndarray, bbox: np.ndarray, confidence: float) -> float:
    """
    Calculate overall quality score for a snapshot.
    
    Quality Score = 0.5 * sharpness_norm + 0.3 * size_norm + 0.2 * confidence
    
    Args:
        frame: Full frame image
        bbox: Bounding box [x1, y1, x2, y2]
        confidence: Detection confidence (0-1)
        
    Returns:
        float: Quality score (0-1, higher is better)
    """
    if frame is None or bbox is None:
        return 0.0
    
    x1, y1, x2, y2 = map(int, bbox)
    h, w = frame.shape[:2]
    
    # Ensure valid crop bounds
    x1 = max(0, x1)
    y1 = max(0, y1)
    x2 = min(w, x2)
    y2 = min(h, y2)
    
    if x2 <= x1 or y2 <= y1:
        return 0.0
    
    # Crop the detection region
    crop = frame[y1:y2, x1:x2]
    
    # 1. Sharpness component (most important)
    blur_score = calculate_blur_score(crop)
    # Normalize: 0-200 range mapped to 0-1
    sharpness_norm = min(1.0, blur_score / 200.0)
    
    # 2. Size component (larger detections tend to be clearer)
    bbox_area = (x2 - x1) * (y2 - y1)
    frame_area = w * h
    size_ratio = bbox_area / frame_area
    # Normalize: 0.01-0.5 range mapped to 0-1
    size_norm = min(1.0, (size_ratio - 0.01) / 0.49)
    size_norm = max(0.0, size_norm)
    
    # 3. Confidence component
    conf_norm = confidence
    
    # Combined quality score
    quality = 0.5 * sharpness_norm + 0.3 * size_norm + 0.2 * conf_norm
    
    return float(quality)


def select_best_snapshot(
    snapshot_buffer: List[Tuple[np.ndarray, np.ndarray, float, Optional[np.ndarray]]], 
    blur_threshold: float = 100.0,
    min_quality: float = 0.3
) -> Optional[Tuple[np.ndarray, np.ndarray, float, Optional[np.ndarray], float]]:
    """
    Select the best snapshot from a buffer of frames.
    
    Args:
        snapshot_buffer: List of (frame, bbox, confidence, plate_bbox) tuples
        blur_threshold: Minimum blur score to consider (default 100.0)
        min_quality: Minimum quality score to accept (default 0.3)
        
    Returns:
        Tuple of (best_frame, bbox, confidence, plate_bbox, quality_score) or None if all frames unsuitable
    """
    if not snapshot_buffer:
        return None
    
    best_snapshot = None
    best_quality = 0.0
    
    for frame, bbox, confidence, plate_bbox in snapshot_buffer:
        # Calculate quality score
        quality = calculate_snapshot_quality(frame, bbox, confidence)
        
        # Check blur threshold on cropped region
        x1, y1, x2, y2 = map(int, bbox)
        h, w = frame.shape[:2]
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w, x2), min(h, y2)
        
        if x2 > x1 and y2 > y1:
            crop = frame[y1:y2, x1:x2]
            blur_score = calculate_blur_score(crop)
            
            # Skip if too blurry
            if blur_score < blur_threshold:
                continue
            
            # Skip if quality too low
            if quality < min_quality:
                continue
            
            # Update best if this is better
            if quality > best_quality:
                best_quality = quality
                best_snapshot = (frame, bbox, confidence, plate_bbox, quality)
    
    return best_snapshot


def is_frame_acceptable(frame: np.ndarray, bbox: np.ndarray, blur_threshold: float = 100.0) -> bool:
    """
    Quick check if a frame meets minimum quality standards.
    
    Args:
        frame: Input frame
        bbox: Bounding box [x1, y1, x2, y2]
        blur_threshold: Minimum acceptable blur score
        
    Returns:
        bool: True if frame is acceptable, False if too blurry
    """
    if frame is None or bbox is None:
        return False
    
    x1, y1, x2, y2 = map(int, bbox)
    h, w = frame.shape[:2]
    
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(w, x2), min(h, y2)
    
    if x2 <= x1 or y2 <= y1:
        return False
    
    crop = frame[y1:y2, x1:x2]
    blur_score = calculate_blur_score(crop)
    
    return blur_score >= blur_threshold
