#!/usr/bin/env python3
"""
Distributed FRS ingress/distributor service.

Runs on the single camera-connected Jetson:
- pulls camera/worker plan from control-plane
- grabs frames from all RTSP streams
- dispatches inference requests to worker Jetsons
- publishes FRS events back to control-plane through local edge gateway
- reports node heartbeat/status
"""

from __future__ import annotations

import base64
import json
import os
import threading
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import cv2
import numpy as np
import requests


def _env(name: str, default: str) -> str:
    value = os.getenv(name, "").strip()
    return value if value else default


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except Exception:
        return default


def encode_embedding(embedding: List[float]) -> str:
    arr = np.asarray(embedding, dtype=np.float32)
    return base64.b64encode(arr.tobytes()).decode("utf-8")


@dataclass
class WorkerTarget:
    worker_id: str
    infer_url: str


class Distributor:
    def __init__(self) -> None:
        self.gateway = _env("EDGE_GATEWAY_URL", "http://127.0.0.1:3900").rstrip("/")
        self.plan_url = _env("FRS_DISTRIBUTED_PLAN_URL", f"{self.gateway}/api/frs/distributed/plan")
        self.heartbeat_url = _env("FRS_DISTRIBUTED_HEARTBEAT_URL", f"{self.gateway}/api/frs/distributed/heartbeat")
        self.events_ingest_url = _env("FRS_EVENTS_INGEST_URL", f"{self.gateway}/api/events/ingest")
        self.ingress_node_id = _env("FRS_INGRESS_NODE_ID", _env("EDGE_DEVICE_NAME", "ingress-node"))
        self.camera_fps = _env_int("FRS_DISTRIBUTED_FPS", 4)
        self.jpeg_quality = _env_int("FRS_DISTRIBUTED_JPEG_QUALITY", 75)
        self.plan_refresh_sec = _env_int("FRS_DISTRIBUTED_PLAN_REFRESH_SEC", 30)
        self.heartbeat_sec = _env_int("FRS_DISTRIBUTED_HEARTBEAT_SEC", 5)
        self.http_timeout_sec = _env_int("FRS_DISTRIBUTED_HTTP_TIMEOUT_SEC", 10)

        raw_workers = _env("FRS_WORKER_ENDPOINTS", "")
        # Expected format:
        # worker_id=http://10.10.0.11:8008/infer,worker_id2=http://10.10.0.14:8008/infer
        self.static_workers: List[WorkerTarget] = []
        for part in raw_workers.split(","):
            part = part.strip()
            if not part or "=" not in part:
                continue
            worker_id, url = part.split("=", 1)
            worker_id = worker_id.strip()
            url = url.strip().rstrip("/")
            if worker_id and url:
                self.static_workers.append(WorkerTarget(worker_id=worker_id, infer_url=url))

        self.session = requests.Session()
        self.stop_event = threading.Event()
        self.cameras: List[Dict[str, Any]] = []
        self.targets: List[WorkerTarget] = list(self.static_workers)
        self.target_index = 0
        self.processed_frames = 0
        self.published_events = 0
        self.assignments = 0
        self._lock = threading.Lock()
        self.camera_threads: Dict[str, threading.Thread] = {}
        self.camera_stop_flags: Dict[str, threading.Event] = {}

    def refresh_plan(self) -> None:
        try:
            resp = self.session.get(self.plan_url, timeout=self.http_timeout_sec)
            if resp.status_code != 200:
                return
            body = resp.json()
            cameras = body.get("cameras", []) or []
            workers = body.get("workers", []) or []

            dynamic_targets: List[WorkerTarget] = []
            for w in workers:
                wid = str(w.get("id", "")).strip()
                ip = str(w.get("ip", "")).strip()
                if not wid or not ip:
                    continue
                if str(w.get("status", "")).lower() in ("revoked",):
                    continue
                infer_url = f"http://{ip}:8008/infer"
                dynamic_targets.append(WorkerTarget(worker_id=wid, infer_url=infer_url))

            with self._lock:
                self.cameras = [c for c in cameras if str(c.get("rtsp_url", "")).strip()]
                if self.static_workers:
                    self.targets = list(self.static_workers)
                else:
                    self.targets = dynamic_targets
                self.assignments = sum(1 for c in self.cameras if str(c.get("assigned_worker_id", "")).strip())
        except Exception:
            pass

    def pick_target(self, camera: Dict[str, Any]) -> Optional[WorkerTarget]:
        with self._lock:
            if not self.targets:
                return None
            assigned_worker = str(camera.get("assigned_worker_id", "")).strip()
            if assigned_worker:
                for t in self.targets:
                    if t.worker_id == assigned_worker:
                        return t
            t = self.targets[self.target_index % len(self.targets)]
            self.target_index = (self.target_index + 1) % max(len(self.targets), 1)
            return t

    def publish_event(self, camera_id: str, detection: Dict[str, Any], frame_id: str) -> None:
        event = {
            "id": f"frs_dist_{camera_id}_{int(time.time() * 1000)}",
            "worker_id": "frs-distributor",
            "device_id": camera_id,
            "type": "face_detected",
            "data": {
                "confidence": float(detection.get("det_score", 0.0)),
                "bbox": detection.get("bbox", []),
                "frame_id": frame_id,
                "faceEmbedding": encode_embedding(detection.get("embedding", [])),
                "metadata": {
                    "source": "distributed_frs",
                    "is_known": False,
                },
            },
        }
        try:
            resp = self.session.post(
                self.events_ingest_url,
                data={"event": json.dumps(event)},
                timeout=self.http_timeout_sec,
            )
            if resp.status_code in (200, 201):
                self.published_events += 1
        except Exception:
            pass

    def camera_worker_loop(self, camera: Dict[str, Any], stop_flag: threading.Event) -> None:
        camera_id = str(camera.get("device_id") or camera.get("id") or "").strip()
        rtsp_url = str(camera.get("rtsp_url", "")).strip()
        if not camera_id or not rtsp_url:
            return

        cap = cv2.VideoCapture(rtsp_url)
        if not cap.isOpened():
            return

        frame_interval = max(int(30 / max(self.camera_fps, 1)), 1)
        frame_count = 0
        encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), self.jpeg_quality]

        try:
            while not self.stop_event.is_set() and not stop_flag.is_set():
                ok, frame = cap.read()
                if not ok or frame is None:
                    time.sleep(0.2)
                    continue

                frame_count += 1
                if frame_count % frame_interval != 0:
                    continue

                target = self.pick_target(camera)
                if target is None:
                    continue

                ok, jpg = cv2.imencode(".jpg", frame, encode_param)
                if not ok:
                    continue
                frame_bytes = jpg.tobytes()
                frame_id = f"{camera_id}_{int(time.time() * 1000)}"

                files = {"frame": ("frame.jpg", frame_bytes, "image/jpeg")}
                data = {"camera_id": camera_id, "frame_id": frame_id}

                try:
                    resp = self.session.post(
                        target.infer_url,
                        files=files,
                        data=data,
                        timeout=self.http_timeout_sec,
                    )
                    if resp.status_code != 200:
                        continue
                    body = resp.json()
                    detections = body.get("detections", []) or []
                    self.processed_frames += 1
                    for det in detections:
                        embedding = det.get("embedding", []) or []
                        if len(embedding) < 32:
                            continue
                        self.publish_event(camera_id, det, frame_id)
                except Exception:
                    continue
        finally:
            cap.release()

    def reconcile_camera_workers(self) -> None:
        desired: Dict[str, Dict[str, Any]] = {}
        for cam in self.cameras:
            cam_id = str(cam.get("device_id") or cam.get("id") or "").strip()
            if cam_id:
                desired[cam_id] = cam

        # Stop removed cameras
        for cam_id in list(self.camera_threads.keys()):
            if cam_id in desired:
                continue
            stop_flag = self.camera_stop_flags.get(cam_id)
            if stop_flag:
                stop_flag.set()
            t = self.camera_threads.get(cam_id)
            if t:
                t.join(timeout=2)
            self.camera_threads.pop(cam_id, None)
            self.camera_stop_flags.pop(cam_id, None)

        # Start new cameras
        for cam_id, cam in desired.items():
            if cam_id in self.camera_threads:
                continue
            flag = threading.Event()
            t = threading.Thread(target=self.camera_worker_loop, args=(cam, flag), daemon=True)
            self.camera_stop_flags[cam_id] = flag
            self.camera_threads[cam_id] = t
            t.start()

    def heartbeat_loop(self) -> None:
        while not self.stop_event.is_set():
            payload = {
                "node_id": self.ingress_node_id,
                "node_role": "ingress",
                "node_ip": _env("EDGE_DEVICE_IP", ""),
                "worker_id": _env("WORKER_ID", ""),
                "processed_frames": self.processed_frames,
                "published_events": self.published_events,
                "connected_cameras": len(self.cameras),
                "active_assignments": self.assignments,
                "metadata": {
                    "targets": [t.worker_id for t in self.targets],
                },
            }
            try:
                self.session.post(self.heartbeat_url, json=payload, timeout=self.http_timeout_sec)
            except Exception:
                pass
            time.sleep(max(self.heartbeat_sec, 1))

    def run(self) -> int:
        hb = threading.Thread(target=self.heartbeat_loop, daemon=True)
        hb.start()
        last_plan_refresh = 0.0

        try:
            while not self.stop_event.is_set():
                now = time.time()
                if now - last_plan_refresh >= self.plan_refresh_sec:
                    last_plan_refresh = now
                    self.refresh_plan()
                    self.reconcile_camera_workers()

                time.sleep(1)
        except KeyboardInterrupt:
            pass
        finally:
            self.stop_event.set()
            for stop_flag in self.camera_stop_flags.values():
                stop_flag.set()
            for t in self.camera_threads.values():
                t.join(timeout=2)
        return 0


if __name__ == "__main__":
    raise SystemExit(Distributor().run())
