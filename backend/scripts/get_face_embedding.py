import argparse
import sys
import json
import numpy as np
import cv2
import insightface
from insightface.app import FaceAnalysis

import logging
import os

# Silence chatty libraries
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
logging.getLogger('insightface').setLevel(logging.ERROR)
logging.getLogger('onnxruntime').setLevel(logging.ERROR)

def get_embedding(image_path):
    # Initialize InsightFace
    # Use CPU for enrollment to avoid VRAM conflict with the main pipeline if running on same machine
    app = FaceAnalysis(allowed_modules=['detection', 'recognition'], providers=['CPUExecutionProvider'])
    
    # Silence stdout during prepare
    import contextlib
    with contextlib.redirect_stdout(open(os.devnull, 'w')):
        app.prepare(ctx_id=-1, det_size=(640, 640))

    # Read image
    img = cv2.imread(image_path)
    if img is None:
        print(json.dumps({"error": "Failed to read image"}))
        return

    # Get faces
    faces = app.get(img)

    if len(faces) == 0:
        print(json.dumps({"error": "No face detected"}))
        return
    
    # If multiple faces, take the largest one
    best_face = max(faces, key=lambda f: (f.bbox[2]-f.bbox[0]) * (f.bbox[3]-f.bbox[1]))

    # Output embedding
    embedding = best_face.embedding.tolist()
    print(json.dumps({
        "success": True, 
        "embedding": embedding,
        "bbox": best_face.bbox.tolist()
    }))

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("image_path", help="Path to the image file")
    args = parser.parse_args()
    
    get_embedding(args.image_path)
