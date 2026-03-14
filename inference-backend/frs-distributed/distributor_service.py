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
from typing import Any, Dict, List, Optional, Tuple

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
        self.watchlist_url = _env("FRS_WATCHLIST_URL", f"{self.gateway}/api/inference/frs/persons")
        self.watchlist_version_url = _env(
            "FRS_WATCHLIST_VERSION_URL",
            f"{self.gateway}/api/inference/frs/watchlist-version",
        )
        self.ingress_node_id = _env("FRS_INGRESS_NODE_ID", _env("EDGE_DEVICE_NAME", "ingress-node"))
        self.camera_fps = _env_int("FRS_DISTRIBUTED_FPS", 4)
        self.jpeg_quality = _env_int("FRS_DISTRIBUTED_JPEG_QUALITY", 75)
        self.plan_refresh_sec = _env_int("FRS_DISTRIBUTED_PLAN_REFRESH_SEC", 30)
        # Poll lightweight version frequently; refresh full embeddings only when version changes.
        self.watchlist_poll_sec = _env_int("FRS_WATCHLIST_POLL_SEC", 5)
        self.watchlist_force_refresh_sec = _env_int("FRS_WATCHLIST_FORCE_REFRESH_SEC", 900)
        self.heartbeat_sec = _env_int("FRS_DISTRIBUTED_HEARTBEAT_SEC", 5)
        self.http_timeout_sec = _env_int("FRS_DISTRIBUTED_HTTP_TIMEOUT_SEC", 10)
        self.match_threshold = float(os.getenv("FRS_MATCH_THRESHOLD", "0.35").strip() or "0.35")
        self.worker_id = _env("WORKER_ID", "")
        self.only_assigned_cameras = _env("FRS_ONLY_ASSIGNED_CAMS", "1").lower() not in ("0", "false", "no")
        self.auth_token = _env("AUTH_TOKEN", "")
        self.auth_headers: Dict[str, str] = {}
        if self.worker_id:
            self.auth_headers["X-Worker-ID"] = self.worker_id
        if self.auth_token:
            self.auth_headers["X-Auth-Token"] = self.auth_token

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
        self.watchlist_people: List[Dict[str, Any]] = []
        self.watchlist_version: int = -1
        self.watchlist_last_full_refresh: float = 0.0

    def refresh_plan(self) -> None:
        try:
            resp = self.session.get(
                self.plan_url,
                timeout=self.http_timeout_sec,
                headers=self.auth_headers or None,
            )
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

            filtered_cameras = [c for c in cameras if str(c.get("rtsp_url", "")).strip()]
            if self.only_assigned_cameras and self.worker_id:
                filtered_cameras = [
                    c for c in filtered_cameras
                    if str(c.get("assigned_worker_id", "")).strip() == self.worker_id
                ]

            if self.only_assigned_cameras and self.worker_id:
                dynamic_targets = [t for t in dynamic_targets if t.worker_id == self.worker_id]

            with self._lock:
                self.cameras = filtered_cameras
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

    def fetch_watchlist_version(self) -> int:
        try:
            resp = self.session.get(
                self.watchlist_version_url,
                timeout=self.http_timeout_sec,
                headers=self.auth_headers or None,
            )
            if resp.status_code != 200:
                return -1
            body = resp.json() or {}
            v = body.get("version", -1)
            return int(v)
        except Exception:
            return -1

    def refresh_watchlist(self, force: bool = False) -> None:
        now = time.time()
        if not force:
            remote_version = self.fetch_watchlist_version()
            if remote_version != -1:
                if remote_version == self.watchlist_version:
                    # Keep local embeddings; avoid full fetch unless periodic safety refresh.
                    if now - self.watchlist_last_full_refresh < self.watchlist_force_refresh_sec:
                        return
        try:
            resp = self.session.get(
                self.watchlist_url,
                timeout=self.http_timeout_sec,
                headers=self.auth_headers or None,
            )
            if resp.status_code != 200:
                return
            raw_people = resp.json() or []
            people: List[Dict[str, Any]] = []
            for p in raw_people:
                pid = str(p.get("id", "")).strip()
                if not pid:
                    continue
                name = str(p.get("name", "")).strip() or pid
                category = str((p.get("category") or "")).strip()
                emb_vectors: List[np.ndarray] = []

                candidates: List[Any] = []
                if "embeddings" in p:
                    candidates.append(p.get("embeddings"))
                if "embedding" in p:
                    candidates.append(p.get("embedding"))

                for source in candidates:
                    if source is None:
                        continue
                    parsed = source
                    if isinstance(parsed, str):
                        try:
                            parsed = json.loads(parsed)
                        except Exception:
                            parsed = None
                    if parsed is None:
                        continue
                    if not isinstance(parsed, list):
                        parsed = [parsed]
                    for entry in parsed:
                        if isinstance(entry, dict) and "embedding" in entry:
                            entry = entry.get("embedding")
                        if isinstance(entry, str):
                            try:
                                entry = json.loads(entry)
                            except Exception:
                                continue
                        if not isinstance(entry, (list, tuple)):
                            continue
                        try:
                            arr = np.asarray(entry, dtype=np.float32).reshape(-1)
                        except Exception:
                            continue
                        if arr.size < 32:
                            continue
                        norm = float(np.linalg.norm(arr))
                        if norm <= 0:
                            continue
                        emb_vectors.append(arr / norm)

                if emb_vectors:
                    people.append({
                        "id": pid,
                        "name": name,
                        "category": category,
                        "embeddings": emb_vectors,
                    })
            with self._lock:
                self.watchlist_people = people
                rv = self.fetch_watchlist_version()
                if rv != -1:
                    self.watchlist_version = rv
                self.watchlist_last_full_refresh = now
        except Exception:
            pass

    def match_watchlist(self, embedding: List[float]) -> Tuple[Optional[Dict[str, Any]], float]:
        try:
            vec = np.asarray(embedding, dtype=np.float32).reshape(-1)
        except Exception:
            return None, 0.0
        if vec.size < 32:
            return None, 0.0
        norm = float(np.linalg.norm(vec))
        if norm <= 0:
            return None, 0.0
        target = vec / norm

        with self._lock:
            people = list(self.watchlist_people)

        best_person: Optional[Dict[str, Any]] = None
        best_score = -1.0
        for p in people:
            for src in p.get("embeddings", []):
                try:
                    score = float(np.dot(target, src))
                except Exception:
                    continue
                if score > best_score:
                    best_score = score
                    best_person = p
        if best_person is None or best_score < self.match_threshold:
            return None, max(best_score, 0.0)
        return best_person, best_score

    def mesh_snapshot(
        self,
        frame: np.ndarray,
        detections: List[Dict[str, Any]],
        primary_bbox: List[float],
        known: bool,
    ) -> Optional[bytes]:
        if frame is None:
            return None
        try:
            out = frame.copy()
            overlay = out.copy()
            primary = tuple(int(v) for v in primary_bbox[:4]) if len(primary_bbox) >= 4 else None
            # Keep mesh green on the primary face even when unknown (per legacy UI expectation).
            primary_color = (0, 255, 0)
            for face in detections:
                fb = face.get("bbox", []) or []
                if len(fb) < 4:
                    continue
                fx1, fy1, fx2, fy2 = map(int, fb[:4])
                this_bbox = (fx1, fy1, fx2, fy2)
                is_primary = primary is not None and this_bbox == primary
                color = primary_color if is_primary else (140, 140, 140)
                cx = (fx1 + fx2) // 2
                cy = (fy1 + fy2) // 2
                ax = max(1, int((fx2 - fx1) / 2 * 1.08))
                ay = max(1, int((fy2 - fy1) / 2 * 1.08))
                step = max(4, (ax + ay) // 7)
                curve = 0.28
                seg = 12
                for dy in range(-ay, ay + 1, step):
                    tc = dy / ay
                    if abs(tc) >= 1.0:
                        continue
                    x_half = ax * (1.0 - tc * tc) ** 0.5
                    pts_h = []
                    for i in range(seg + 1):
                        xn = -1.0 + 2.0 * i / seg
                        pts_h.append([int(cx + xn * x_half), int(cy + dy * (1.0 - curve * (1.0 - xn * xn)))])
                    cv2.polylines(overlay, [np.array(pts_h, np.int32)], False, color, 1)
                for dx in range(-ax, ax + 1, step):
                    tc = dx / ax
                    if abs(tc) >= 1.0:
                        continue
                    y_half = ay * (1.0 - tc * tc) ** 0.5
                    pts_v = []
                    for i in range(seg + 1):
                        yn = -1.0 + 2.0 * i / seg
                        pts_v.append([int(cx + dx * (1.0 - curve * (1.0 - yn * yn))), int(cy + yn * y_half)])
                    cv2.polylines(overlay, [np.array(pts_v, np.int32)], False, color, 1)
                cv2.ellipse(overlay, (cx, cy), (ax, ay), 0, 0, 360, color, 1)
            cv2.addWeighted(overlay, 0.35, out, 0.65, 0, out)
            ok, jpg = cv2.imencode(".jpg", out, [int(cv2.IMWRITE_JPEG_QUALITY), self.jpeg_quality])
            if not ok:
                return None
            return jpg.tobytes()
        except Exception:
            return None

    def publish_event(
        self,
        camera_id: str,
        detection: Dict[str, Any],
        detections: List[Dict[str, Any]],
        frame_id: str,
        frame: np.ndarray,
        matched_person: Optional[Dict[str, Any]],
        match_score: float,
    ) -> None:
        embedding = detection.get("embedding", []) or []
        is_known = matched_person is not None
        bbox = detection.get("bbox", []) or []
        event = {
            "id": f"frs_dist_{camera_id}_{int(time.time() * 1000)}",
            "worker_id": "frs-distributor",
            "device_id": camera_id,
            "type": "person_match" if is_known else "face_detected",
            "data": {
                "confidence": float(match_score if is_known else detection.get("det_score", 0.0)),
                "bbox": bbox,
                "frame_id": frame_id,
                "faceEmbedding": encode_embedding(embedding),
                "metadata": {
                    "source": "distributed_frs",
                    "is_known": is_known,
                    "match_score": float(match_score),
                },
            },
        }
        if is_known:
            event["data"]["person_id"] = matched_person.get("id", "")
            event["data"]["person_name"] = matched_person.get("name", "")
            event["data"]["metadata"]["person_id"] = matched_person.get("id", "")
            event["data"]["metadata"]["person_name"] = matched_person.get("name", "")
            event["data"]["metadata"]["person_category"] = matched_person.get("category", "")

        try:
            mesh_bytes = self.mesh_snapshot(frame, detections, bbox, is_known)
            if mesh_bytes is None:
                ok, jpg = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), self.jpeg_quality])
                if not ok:
                    return
                mesh_bytes = jpg.tobytes()
            files = {"frame.jpg": ("frame.jpg", mesh_bytes, "image/jpeg")}
            if is_known and len(bbox) >= 4:
                x1, y1, x2, y2 = map(int, bbox[:4])
                h, w = frame.shape[:2]
                x1 = max(0, min(w - 1, x1))
                x2 = max(0, min(w, x2))
                y1 = max(0, min(h - 1, y1))
                y2 = max(0, min(h, y2))
                if x2 > x1 and y2 > y1:
                    crop = frame[y1:y2, x1:x2]
                    if crop is not None and crop.size > 0:
                        okc, cj = cv2.imencode(".jpg", crop, [int(cv2.IMWRITE_JPEG_QUALITY), self.jpeg_quality])
                        if okc:
                            files["face_crop.jpg"] = ("face_crop.jpg", cj.tobytes(), "image/jpeg")
            resp = self.session.post(
                self.events_ingest_url,
                data={"event": json.dumps(event)},
                files=files,
                headers=self.auth_headers or None,
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
                        matched_person, score = self.match_watchlist(embedding)
                        self.publish_event(camera_id, det, detections, frame_id, frame, matched_person, score)
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
                "worker_id": self.worker_id,
                "processed_frames": self.processed_frames,
                "published_events": self.published_events,
                "connected_cameras": len(self.cameras),
                "active_assignments": self.assignments,
                "metadata": {
                    "targets": [t.worker_id for t in self.targets],
                },
            }
            try:
                self.session.post(
                    self.heartbeat_url,
                    json=payload,
                    timeout=self.http_timeout_sec,
                    headers=self.auth_headers or None,
                )
            except Exception:
                pass
            time.sleep(max(self.heartbeat_sec, 1))

    def run(self) -> int:
        hb = threading.Thread(target=self.heartbeat_loop, daemon=True)
        hb.start()
        last_plan_refresh = 0.0
        last_watchlist_poll = 0.0
        self.refresh_watchlist(force=True)

        try:
            while not self.stop_event.is_set():
                now = time.time()
                if now - last_plan_refresh >= self.plan_refresh_sec:
                    last_plan_refresh = now
                    self.refresh_plan()
                    self.reconcile_camera_workers()
                if now - last_watchlist_poll >= self.watchlist_poll_sec:
                    last_watchlist_poll = now
                    self.refresh_watchlist(force=False)

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
