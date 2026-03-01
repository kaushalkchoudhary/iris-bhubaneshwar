#!/usr/bin/env python3
"""
WebSocket Client for Live Frame Streaming to IRIS Backend.
Uses plain WebSocket binary protocol to push frames to /ws/publish.

Binary frame format (send):
  [0x01][1 byte keyLen]["workerID.cameraID"][JPEG bytes]   → frame
  [0x02][1 byte keyLen]["workerID.cameraID"][JSON bytes]   → detection data
"""

import json
import logging
import os
import threading
import time
from typing import Dict, List, Optional

import cv2
import numpy as np
import websocket  # websocket-client library

logger = logging.getLogger(__name__)


def _server_to_ws_url(server_url: str) -> str:
    """Convert http(s) server URL to ws(s) URL for /ws/publish."""
    url = server_url.rstrip("/")
    if url.startswith("https://"):
        url = "wss://" + url[len("https://"):]
    elif url.startswith("http://"):
        url = "ws://" + url[len("http://"):]
    return url + "/ws/publish"


class LivePreviewWebSocketClient:
    """
    WebSocket client that publishes live JPEG frames and face detections to the
    IRIS backend via the binary /ws/publish endpoint.
    """

    def __init__(
        self,
        server_url: str = "http://localhost:3002",
        camera_id: str = None,
        max_fps: int = 5,
        jpeg_quality: int = 75,
        frame_resize_height: int = 480,
    ):
        # Resolve server URL: prefer env vars over any loopback/localhost URL.
        # Covers localhost:3002, 127.0.0.1:3900 (edge gateway), etc. — any
        # 127.x.x.x host cannot serve WebSocket traffic for remote Jetsons.
        import re as _re
        if _re.match(r"https?://(localhost|127\.)", server_url):
            server_url = os.environ.get(
                "IRIS_WS_SERVER_URL",
                os.environ.get("EDGE_SERVER_URL", server_url),
            )

        self.ws_url = _server_to_ws_url(server_url)
        self.camera_id = camera_id or "unknown"
        self.worker_id = os.environ.get("WORKER_ID", "unknown")
        self.camera_key = f"{self.worker_id}.{self.camera_id}"

        self.max_fps = max_fps
        self.jpeg_quality = jpeg_quality
        self.frame_resize_height = frame_resize_height

        self.min_frame_interval = 1.0 / max_fps if max_fps > 0 else 0.2
        self.last_frame_time: float = 0.0

        self._ws: Optional[websocket.WebSocketApp] = None
        self._ws_lock = threading.Lock()
        self._send_lock = threading.Lock()  # serializes concurrent sends from multiple threads
        self._connected = False
        self._stop = threading.Event()

        logger.info(
            "LivePreviewWebSocketClient init: camera=%s key=%s url=%s",
            self.camera_id,
            self.camera_key,
            self.ws_url,
        )
        self._start_connection()

    # ── connection management ──────────────────────────────────────────────

    def _on_open(self, ws):
        self._connected = True
        logger.info("✅ Feed publisher connected: %s (cam=%s)", self.ws_url, self.camera_id)

    def _on_error(self, ws, error):
        logger.debug("Feed publisher WS error for %s: %s", self.camera_id, error)
        self._connected = False

    def _on_close(self, ws, close_status_code, close_msg):
        self._connected = False
        logger.debug("Feed publisher WS closed for %s", self.camera_id)

    def _run_loop(self):
        """Connection loop with reconnect."""
        while not self._stop.is_set():
            try:
                ws = websocket.WebSocketApp(
                    self.ws_url,
                    on_open=self._on_open,
                    on_error=self._on_error,
                    on_close=self._on_close,
                )
                with self._ws_lock:
                    self._ws = ws
                ws.run_forever(ping_interval=30, ping_timeout=10)
            except Exception as e:
                logger.debug("Feed publisher connect error for %s: %s", self.camera_id, e)
            finally:
                self._connected = False
                with self._ws_lock:
                    self._ws = None
            if not self._stop.is_set():
                time.sleep(5)  # reconnect delay

    def _start_connection(self):
        t = threading.Thread(target=self._run_loop, daemon=True, name=f"WSPub-{self.camera_id[:8]}")
        t.start()

    # ── frame helpers ──────────────────────────────────────────────────────

    def _resize(self, frame: np.ndarray) -> np.ndarray:
        if self.frame_resize_height is None:
            return frame
        h, w = frame.shape[:2]
        if h <= self.frame_resize_height:
            return frame
        new_w = int((self.frame_resize_height / h) * w)
        return cv2.resize(frame, (new_w, self.frame_resize_height), interpolation=cv2.INTER_AREA)

    def _encode_jpeg(self, frame: np.ndarray) -> Optional[bytes]:
        ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), self.jpeg_quality])
        return buf.tobytes() if ok else None

    def _draw_boxes(self, frame: np.ndarray, faces: List[Dict], scale_x: float, scale_y: float) -> np.ndarray:
        out = frame.copy()
        for face in faces:
            bbox = face.get("bbox", [])
            if len(bbox) < 4:
                continue
            x1 = int(float(bbox[0]) * scale_x)
            y1 = int(float(bbox[1]) * scale_y)
            x2 = int(float(bbox[2]) * scale_x)
            y2 = int(float(bbox[3]) * scale_y)
            conf = face.get("det_score", face.get("confidence", 0.0))
            color = (0, 255, 0) if conf > 0.8 else (0, 255, 255) if conf > 0.6 else (0, 0, 255)
            cv2.rectangle(out, (x1, y1), (x2, y2), color, 2)
        return out

    # ── send helpers ───────────────────────────────────────────────────────

    def _send_binary(self, subtype: int, payload: bytes) -> bool:
        """Send [subtype][keyLen][cameraKey][payload] as binary WebSocket message."""
        if not self._connected:
            return False
        key_bytes = self.camera_key.encode("utf-8")
        if len(key_bytes) > 255:
            logger.warning("Camera key too long: %s", self.camera_key)
            return False
        msg = bytes([subtype, len(key_bytes)]) + key_bytes + payload
        try:
            with self._ws_lock:
                ws = self._ws
            if ws is None:
                return False
            with self._send_lock:
                ws.send(msg, opcode=websocket.ABNF.OPCODE_BINARY)
            return True
        except Exception as e:
            logger.debug("WS send error for %s: %s", self.camera_id, e)
            self._connected = False
            return False

    # ── public API ─────────────────────────────────────────────────────────

    def send_frame(self, frame: np.ndarray, detections: Optional[List[Dict]] = None, metadata: Optional[Dict] = None):
        """Compress and send a raw JPEG frame to the backend (no bbox drawing).
        If detections are provided, a scaled 0x02 detection JSON is also sent so
        the frontend can overlay bounding boxes without any server-side drawing."""
        now = time.time()
        if now - self.last_frame_time < self.min_frame_interval:
            return
        if not self._connected:
            return

        try:
            orig_h, orig_w = frame.shape[:2]
            resized = self._resize(frame)
            res_h, res_w = resized.shape[:2]
            # Scale factors used only for bbox coordinate conversion (no drawing).
            sx = res_w / orig_w
            sy = res_h / orig_h

            # No bbox drawing — send the raw (possibly downscaled) JPEG.
            jpeg = self._encode_jpeg(resized)
            if jpeg is None:
                return

            if self._send_binary(0x01, jpeg):
                self.last_frame_time = now

                # Send detection overlay data so the frontend can draw boxes itself.
                if detections:
                    det_payload = json.dumps({
                        "camera_id": self.camera_id,
                        "timestamp": now,
                        "detections": [
                            {
                                "type": "face",
                                "confidence": float(f.get("det_score", f.get("confidence", 0.0))),
                                "bbox": [
                                    int(float(f["bbox"][0]) * sx),
                                    int(float(f["bbox"][1]) * sy),
                                    int((float(f["bbox"][2]) - float(f["bbox"][0])) * sx),
                                    int((float(f["bbox"][3]) - float(f["bbox"][1])) * sy),
                                ],
                                "label": f.get("name", "Unknown"),
                                "color": "#f97316",
                            }
                            for f in detections
                            if f.get("bbox") and len(f["bbox"]) >= 4
                        ],
                    }).encode("utf-8")
                    self._send_binary(0x02, det_payload)
        except Exception as e:
            logger.debug("send_frame error for %s: %s", self.camera_id, e)

    def send_detections(self, detections: List[Dict]):
        """Send only the detection JSON overlay (0x02) without sending a video frame."""
        if not self._connected or not detections:
            return
        try:
            now = time.time()
            det_payload = json.dumps({
                "camera_id": self.camera_id,
                "timestamp": now,
                "detections": [
                    {
                        "type": "face",
                        "confidence": float(f.get("det_score", f.get("confidence", 0.0))),
                        "bbox": [
                            int(float(f["bbox"][0])),
                            int(float(f["bbox"][1])),
                            int(float(f["bbox"][2]) - float(f["bbox"][0])),
                            int(float(f["bbox"][3]) - float(f["bbox"][1])),
                        ],
                        "label": f.get("name", "Unknown"),
                        "color": "#f97316",
                    }
                    for f in detections
                    if f.get("bbox") and len(f["bbox"]) >= 4
                ],
            }).encode("utf-8")
            self._send_binary(0x02, det_payload)
        except Exception as e:
            logger.debug("send_detections error for %s: %s", self.camera_id, e)

    def send_detection_highlight(self, frame: np.ndarray, detection: Dict):
        """Send a single detection highlight frame (best-effort, same as send_frame)."""
        if not self._connected:
            return
        try:
            orig_h, orig_w = frame.shape[:2]
            resized = self._resize(frame)
            res_h, res_w = resized.shape[:2]
            sx = res_w / orig_w
            sy = res_h / orig_h

            bbox = detection.get("bbox", [])
            if len(bbox) >= 4:
                x1, y1 = int(float(bbox[0]) * sx), int(float(bbox[1]) * sy)
                x2, y2 = int(float(bbox[2]) * sx), int(float(bbox[3]) * sy)
                cv2.rectangle(resized, (x1, y1), (x2, y2), (0, 0, 255), 2)

            jpeg = self._encode_jpeg(resized)
            if jpeg:
                self._send_binary(0x01, jpeg)
        except Exception as e:
            logger.debug("send_detection_highlight error for %s: %s", self.camera_id, e)

    def is_connected(self) -> bool:
        return self._connected

    def disconnect(self):
        self._stop.set()
        try:
            with self._ws_lock:
                ws = self._ws
            if ws:
                ws.close()
        except Exception:
            pass
        logger.info("Feed publisher disconnected for camera %s", self.camera_id)

    def __del__(self):
        self.disconnect()


def create_live_preview_client(
    camera_id: str,
    server_url: str = "http://localhost:3002",
    max_fps: int = 30,
    frame_resize_height: int = 720,
) -> LivePreviewWebSocketClient:
    return LivePreviewWebSocketClient(
        server_url=server_url,
        camera_id=camera_id,
        max_fps=max_fps,
        frame_resize_height=frame_resize_height,
    )
