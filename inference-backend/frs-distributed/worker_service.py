#!/usr/bin/env python3
"""
Distributed FRS worker service.

Runs on inference Jetsons and exposes HTTP endpoints for frame inference:
- GET /health
- POST /infer (multipart frame upload)
"""

from __future__ import annotations

import io
import os
import time
from typing import Any, Dict, List

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

try:
    from insightface.app import FaceAnalysis
except Exception:  # pragma: no cover
    FaceAnalysis = None


def _env(name: str, default: str) -> str:
    value = os.getenv(name, "").strip()
    return value if value else default


class FRSEngine:
    def __init__(self) -> None:
        self.enabled = False
        self.model_name = _env("FRS_MODEL_NAME", "buffalo_l")
        self.ctx_id = int(_env("FRS_CTX_ID", "0"))
        det_size_raw = _env("FRS_DET_SIZE", "640,640")
        det_w, det_h = 640, 640
        try:
            parts = [int(x.strip()) for x in det_size_raw.split(",")]
            if len(parts) == 2:
                det_w, det_h = parts
        except Exception:
            pass
        self.det_size = (det_w, det_h)
        self.app = None

        if FaceAnalysis is None:
            return

        try:
            self.app = FaceAnalysis(name=self.model_name)
            self.app.prepare(ctx_id=self.ctx_id, det_size=self.det_size)
            self.enabled = True
        except Exception:
            self.app = None
            self.enabled = False

    def infer(self, frame_bgr: np.ndarray) -> List[Dict[str, Any]]:
        if not self.enabled or self.app is None:
            return []

        faces = self.app.get(frame_bgr)
        out: List[Dict[str, Any]] = []
        for f in faces:
            bbox = [float(x) for x in f.bbox.tolist()] if getattr(f, "bbox", None) is not None else []
            det_score = float(getattr(f, "det_score", 0.0))
            embedding = []
            if getattr(f, "embedding", None) is not None:
                emb = np.asarray(f.embedding, dtype=np.float32)
                embedding = [float(x) for x in emb.tolist()]
            out.append({
                "bbox": bbox,
                "det_score": det_score,
                "embedding": embedding,
            })
        return out


app = FastAPI(title="IRIS Distributed FRS Worker", version="1.0.0")
engine = FRSEngine()
boot_time = time.time()


@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "model_loaded": engine.enabled,
        "model_name": engine.model_name,
        "uptime_sec": int(time.time() - boot_time),
    }


@app.post("/infer")
async def infer(
    frame: UploadFile = File(...),
    camera_id: str = Form(""),
    frame_id: str = Form(""),
) -> JSONResponse:
    raw = await frame.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty frame")

    npbuf = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(npbuf, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="invalid image")

    start = time.time()
    detections = engine.infer(img)
    latency_ms = int((time.time() - start) * 1000)

    return JSONResponse({
        "camera_id": camera_id,
        "frame_id": frame_id,
        "detections": detections,
        "count": len(detections),
        "latency_ms": latency_ms,
    })


if __name__ == "__main__":
    import uvicorn

    host = _env("FRS_WORKER_HOST", "0.0.0.0")
    port = int(_env("FRS_WORKER_PORT", "8008"))
    uvicorn.run(app, host=host, port=port)

