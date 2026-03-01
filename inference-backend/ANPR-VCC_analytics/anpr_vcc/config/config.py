"""
Pipeline Configuration for VCC and ANPR.
"""

import os
import torch

class Config:
    # --- Paths ---
    BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    # Weights: Use /app/weights in Docker, or project-root/weights locally
    WEIGHTS_DIR = "/app/weights" if os.path.exists("/app/weights") else os.path.join(os.path.dirname(BASE_DIR), "weights")

    OUTPUT_DIR = os.path.join(os.path.dirname(BASE_DIR), "output")

    # Model Paths
    MODEL_TRAFFIC = os.path.join(WEIGHTS_DIR, "Vcc_best.pt")  # Vehicles & Plates
    MODEL_OCR = os.path.join(WEIGHTS_DIR, "stage_2.pth")       # CRNN OCR (kept as PyTorch)

    # --- Detection Thresholds ---
    CONF_TRAFFIC_DEFAULT = 0.45
    CONF_PLATE = 0.45

    # OCR
    CONF_OCR = 0.1  # Accept almost all recognized text

    # --- Multi-Mode Detection ---
    ENABLED_DETECTION_MODES = ['vcc', 'anpr']

    # VCC (Vehicle Classification & Counting) Settings
    VCC_SEND_INTERVAL_FRAMES = 30  # Send VCC data every N frames (~5 sec at 6 FPS)

    # ANPR (Automatic Number Plate Recognition) Settings
    ANPR_MIN_PLATE_CONFIDENCE = 0.45  # Minimum confidence to send ANPR detection
    ANPR_DEDUPE_WINDOW = 300  # Seconds - Don't re-send same vehicle within this window

    # Tracking
    MIN_DETECTION_FRAMES = 5    # Require 5 frames of tracking before processing
    MAX_FRAME_GAP = 30          # Lost track recovery

    # Plate Association
    MAX_PLATE_DISTANCE = 50    # Max distance to associate plate with vehicle

    # --- Device ---
    DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

    # --- CRNN Settings ---
    CRNN_INPUT_SIZE = (192, 48)
    CRNN_CLASSES = 36  # 0-9, A-Z

    # --- RTSP Streaming Settings ---
    RECONNECT_DELAY = 5  # seconds between reconnection attempts
    STREAM_BUFFER_SIZE = 3  # frames to buffer
    FRAME_SKIP = 0  # skip N frames between processing (0 = process all frames)

    @staticmethod
    def setup():
        """Ensure necessary directories exist."""
        os.makedirs(Config.OUTPUT_DIR, exist_ok=True)
        os.makedirs(os.path.join(Config.OUTPUT_DIR, 'anpr'), exist_ok=True)
        os.makedirs(os.path.join(Config.OUTPUT_DIR, 'vcc'), exist_ok=True)
