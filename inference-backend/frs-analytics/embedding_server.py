#!/usr/bin/env python3
"""
Embedding Server — GPU face embedding endpoint.

Runs a lightweight HTTP server on port 5555 (configurable via EMBEDDING_SERVER_PORT).
The central Mac POSTs raw JPEG bytes to POST /embed and receives a 512-dim float array.
Uses InsightFace buffalo_l with CUDA (GPU) if available, CPU fallback.

This offloads enrollment embedding computation from the Mac (CPU-only) to the
Jetson GPU, keeping the central server as a pure listener/display node.
"""
from __future__ import annotations

import json
import logging
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import cv2
import numpy as np

logger = logging.getLogger("embedding_server")


def _load_model():
    """Load InsightFace buffalo_l — GPU preferred, CPU fallback."""
    try:
        from insightface.app import FaceAnalysis
        # Try GPU first, fall back to CPU automatically
        providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
        app = FaceAnalysis(name="buffalo_l", providers=providers)
        app.prepare(ctx_id=0, det_size=(640, 640))
        # Report which provider was actually used
        det = app.models.get("detection")
        prov = getattr(det, "providers", ["unknown"]) if det else ["unknown"]
        logger.info("InsightFace loaded — providers: %s", prov)
        return app
    except Exception as exc:
        logger.error("Failed to load InsightFace: %s", exc)
        return None


_model_lock = threading.Lock()
_model = None


def get_model():
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                _model = _load_model()
    return _model


class EmbedHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            ok = get_model() is not None
            body = json.dumps({"ok": ok}).encode()
            self.send_response(200 if ok else 503)
            self._headers(body)
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path != "/embed":
            self.send_response(404)
            self.end_headers()
            return

        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)

        model = get_model()
        if model is None:
            result = {"success": False, "error": "Model not loaded"}
        else:
            try:
                arr = np.frombuffer(body, dtype=np.uint8)
                img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
                if img is None:
                    raise ValueError("Failed to decode image")

                faces = model.get(img)
                if not faces:
                    result = {"success": False, "error": "No face detected"}
                else:
                    # Pick highest-confidence detection
                    face = max(faces, key=lambda f: f.det_score)
                    result = {
                        "success": True,
                        "embedding": face.embedding.tolist(),
                        "bbox": [float(x) for x in face.bbox],
                        "det_score": float(face.det_score),
                    }
            except Exception as exc:
                logger.warning("Embed error: %s", exc)
                result = {"success": False, "error": str(exc)}

        data = json.dumps(result).encode()
        self.send_response(200)
        self._headers(data)
        self.wfile.write(data)

    def _headers(self, body: bytes):
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()

    def log_message(self, fmt, *args):  # suppress default access logs
        pass


def run(port: int = 5555):
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
        stream=sys.stdout,
    )
    logger.info("Loading InsightFace model...")
    get_model()  # warm up at startup

    server = HTTPServer(("0.0.0.0", port), EmbedHandler)
    logger.info("Embedding server ready on port %d", port)
    server.serve_forever()


if __name__ == "__main__":
    port = int(os.environ.get("EMBEDDING_SERVER_PORT", "5555"))
    run(port)
