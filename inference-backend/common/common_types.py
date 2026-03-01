#!/usr/bin/env python3
"""
Common type definitions for analytics pipelines.
"""

from typing import TypedDict, Tuple, List, Dict, Optional, Literal
import numpy as np
from numpy.typing import NDArray

class ErrorResult(TypedDict):
    """Type definition for error messages in result queue"""
    type: str  # Always "error"
    camera_id: str
    error: str
    timestamp: str 

# Type for OpenCV BGR image frames (height × width × 3 channels, uint8)
VideoFrame = NDArray[np.uint8]  # Shape: (height, width, 3)

# Type alias for frame queue items
FrameQueueItem = Tuple[str, VideoFrame]
"""Frame queue item type used by FrameGrabber and consumers.

The tuple contains:
1. camera_id (str): Unique identifier for the camera/grabber that produced the frame
                   Used by consumers to track which camera the frame came from
2. frame (VideoFrame): The actual video frame as a numpy array
                      Shape is (height, width, 3) where:
                      - height: Variable frame height in pixels
                      - width: Variable frame width in pixels
                      - 3: BGR color channels used by OpenCV
                      Data type is np.uint8 with values 0-255
""" 


# Define the type for ANPRDetectionFile using Literal
ANPRDetectionFile = Literal[
    "best_annotated_frame.jpg",
    "first_annotated_frame.jpg",
    "last_annotated_frame.jpg",
    "plate_crop.jpg"
]

# Define the FrameFiles TypedDict
class FrameFiles(TypedDict):
    files: List[ANPRDetectionFile]  # List of annotated frame files

# Define the DateFolder TypedDict
class DateFolder(TypedDict):
    __root__: Dict[int, Optional[FrameFiles]]  # Mapping of track IDs to their files

# Define the UUIDFolder TypedDict
class UUIDFolder(TypedDict):
    __root__: Dict[str, DateFolder]  # Mapping of dates to their track files

# Define the Faces TypedDict
class Faces(TypedDict):
    __root__: List[str]  # List of face image files

# Define the Frames TypedDict
class Frames(TypedDict):
    __root__: List[str]  # List of frame image files

# Define the DataDirectory TypedDict
class DataDirectory(TypedDict):
    anpr: UUIDFolder  # ANPR data organized by UUID
    faces: Faces  # Face images
    frames: Frames  # Frame images

# Example of how to use the DataDirectory TypedDict
data_directory: DataDirectory = {
    "anpr": {
        "__root__": {
            "0d9036d6-625c-48d6-ba97-cb41eec70a32": {
                "__root__": {
                    1: {
                        "files": [
                            "best_annotated_frame.jpg",
                            "first_annotated_frame.jpg",
                            "last_annotated_frame.jpg",
                            "plate_crop.jpg"
                        ]
                    },
                    2: {
                        "files": [
                           "best_annotated_frame.jpg",
                            "first_annotated_frame.jpg",
                            "last_annotated_frame.jpg",
                            "plate_crop.jpg",
                        ]
                    },
                    # Additional track IDs can be added here...
                }
            },
            "21c0f7c9-1fc7-403c-8cb3-4191d0bca0c2": {
                "__root__": {
                    1: {
                        "files": [
                            # Files for track_id 1
                        ]
                    }
                }
            },
            "29d61a0a-fd86-480b-a32a-8d7f7a197783": {
                "__root__": {
                    # Dates without track files can be represented as None
                }
            },
            # Additional UUIDs and their date folders...
        }
    },
    "faces": {
        "__root__": [
            "1753865031422-5311688d-fad4-4651-9b64-e2e26ea923aa.jpg",
            "1753865031525-4964e86a-50f6-4215-b2d9-b678c1802ae6.jpg",
        ]
    },
    "frames": {
        "__root__": [
            "1753865031422-fc566b09-cb1d-46a7-b292-3623b6c43337.jpg",
            "1753865031525-596021b4-a65b-4e36-a718-7fe4e4e5bb17.jpg",
        ]
    }
}

# Print the structured data directory
# print(data_directory)
