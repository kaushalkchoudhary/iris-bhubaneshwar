#!/usr/bin/env python3
"""
Type definitions for the FRS (Face Recognition System) pipeline.
"""

from typing import List, Optional, TypedDict
# Local import from common/ directory
from common.common_types import ErrorResult  # noqa: F401


class InferenceFaceData(TypedDict):
    """Type definition for face detection data"""
    bbox: List[float]             # [x1, y1, x2, y2] - bounding box coordinates
    det_score: Optional[float]    # Detection confidence score
    landmark: Optional[List[List[float]]]  # Facial landmarks
    embedding: Optional[List[float]]       # Face embedding vector
    embedding_norm: Optional[float]        # Embedding normalization value
    age: Optional[int]            # Predicted age
    gender: Optional[int]         # Predicted gender (0=female, 1=male in InsightFace)


class APIReporter_CameraConfig(TypedDict):
    """Camera configuration for API reporter."""
    location_id: str
    assignment_id: Optional[str]


class APIReporter_APIConfig(TypedDict):
    """API configuration for API reporter."""
    base_url: str
    token: str
    confidence_threshold: float
    similarity_threshold: float
    duplicate_short_window: float
    duplicate_long_window: float
    max_tracked_faces: int
    jpeg_quality: int
    full_frame_resize_height: Optional[int]
