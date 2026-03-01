#!/usr/bin/env python3
"""
IRIS edge node agent for Jetson deployments.

Responsibilities:
- register worker with central server (token or approval flow)
- persist worker credentials locally
- send periodic heartbeats
- pull worker config and trigger inference restarts on config version change
- run inference stack as a managed child process
"""

from __future__ import annotations

import json
import logging
import os
import signal
import socket
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests


def env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name, "")
    if raw == "":
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if raw == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def safe_strip(value: Optional[str]) -> str:
    return (value or "").strip()


class EdgeAgent:
    def __init__(self) -> None:
        self.server_url = safe_strip(os.getenv("EDGE_SERVER_URL", "http://127.0.0.1:3002")).rstrip("/")
        self.gateway_url = safe_strip(os.getenv("EDGE_GATEWAY_URL", "http://127.0.0.1:3900")).rstrip("/")
        self.api_base = f"{self.server_url}/api"
        self.request_timeout = env_int("EDGE_REQUEST_TIMEOUT_SEC", 15)
        self.heartbeat_interval = env_int("EDGE_HEARTBEAT_INTERVAL_SEC", 5)
        self.config_poll_interval = env_int("EDGE_CONFIG_POLL_INTERVAL_SEC", 10)
        self.retry_delay = env_int("EDGE_RETRY_DELAY_SEC", 5)
        self.state_path = Path(safe_strip(os.getenv("EDGE_STATE_PATH", "/var/lib/iris-edge/state.json")))
        self.logs_dir = Path(safe_strip(os.getenv("EDGE_LOG_DIR", "/var/log/iris-edge")))
        self.inference_root = Path(safe_strip(os.getenv("EDGE_INFERENCE_ROOT", "/opt/iris-edge/inference-backend")))
        self.python_bin = safe_strip(os.getenv("EDGE_PYTHON_BIN", "/opt/iris-edge/.venv/bin/python"))
        self.allow_approval_flow = env_bool("EDGE_ALLOW_APPROVAL_FLOW", False)
        self.approval_poll_interval = env_int("EDGE_APPROVAL_POLL_INTERVAL_SEC", 5)
        self.approval_timeout = env_int("EDGE_APPROVAL_TIMEOUT_SEC", 1800)

        self.device_name = safe_strip(os.getenv("EDGE_DEVICE_NAME", socket.gethostname()))
        self.device_ip = safe_strip(os.getenv("EDGE_DEVICE_IP", self._get_primary_ip()))
        self.device_mac = safe_strip(os.getenv("EDGE_DEVICE_MAC", self._get_mac_address()))
        self.device_model = safe_strip(os.getenv("EDGE_DEVICE_MODEL", "Jetson Orin Nano"))
        self.device_version = safe_strip(os.getenv("EDGE_DEVICE_VERSION", "1.0.0"))
        self.registration_token = safe_strip(os.getenv("EDGE_REGISTRATION_TOKEN", ""))

        self.worker_id = safe_strip(os.getenv("WORKER_ID", ""))
        self.auth_token = safe_strip(os.getenv("AUTH_TOKEN", ""))
        self.last_config_version: Optional[int] = None
        self.last_camera_count = 0
        self.last_analytics: List[str] = []
        self.child_proc: Optional[subprocess.Popen] = None
        self.stop_requested = False
        self.last_config_poll = 0.0
        self.last_heartbeat = 0.0

        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        self.logs_dir.mkdir(parents=True, exist_ok=True)

        self.logger = logging.getLogger("iris-edge-agent")
        self.logger.setLevel(logging.INFO)
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(logging.Formatter("%(asctime)s | %(levelname)s | %(message)s"))
        self.logger.handlers.clear()
        self.logger.addHandler(handler)

        self.session = requests.Session()
        self._load_state()

    def _get_primary_ip(self) -> str:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.connect(("8.8.8.8", 80))
                return s.getsockname()[0]
        except Exception:
            return "127.0.0.1"

    def _get_mac_address(self) -> str:
        value = uuid.getnode()
        parts = [f"{(value >> ele) & 0xFF:02x}" for ele in range(40, -1, -8)]
        return ":".join(parts)

    def _load_state(self) -> None:
        if not self.state_path.exists():
            return
        try:
            raw = json.loads(self.state_path.read_text(encoding="utf-8"))
            if not self.worker_id:
                self.worker_id = safe_strip(raw.get("worker_id"))
            if not self.auth_token:
                self.auth_token = safe_strip(raw.get("auth_token"))
            if self.last_config_version is None and isinstance(raw.get("config_version"), int):
                self.last_config_version = int(raw["config_version"])
        except Exception as exc:
            self.logger.warning("Failed reading state file (%s): %s", self.state_path, exc)

    def _save_state(self) -> None:
        payload = {
            "worker_id": self.worker_id,
            "auth_token": self.auth_token,
            "config_version": self.last_config_version,
            "updated_at": int(time.time()),
        }
        tmp = self.state_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        tmp.replace(self.state_path)

    def _ensure_credentials(self) -> bool:
        if self.worker_id and self.auth_token:
            return True

        if self.registration_token:
            return self._register_with_token()

        if self.allow_approval_flow:
            return self._request_and_wait_approval()

        self.logger.error(
            "Missing worker credentials. Provide EDGE_REGISTRATION_TOKEN or set WORKER_ID/AUTH_TOKEN."
        )
        return False

    def _register_with_token(self) -> bool:
        url = f"{self.api_base}/workers/register"
        payload = {
            "token": self.registration_token,
            "device_name": self.device_name,
            "ip": self.device_ip,
            "mac": self.device_mac,
            "model": self.device_model,
            "version": self.device_version,
        }
        try:
            resp = self.session.post(url, json=payload, timeout=self.request_timeout)
            if resp.status_code not in (200, 201):
                self.logger.error("Worker register failed (%s): %s", resp.status_code, resp.text[:400])
                return False
            data = resp.json()
            self.worker_id = safe_strip(data.get("worker_id"))
            self.auth_token = safe_strip(data.get("auth_token"))
            if not self.worker_id or not self.auth_token:
                self.logger.error("Register response missing worker_id/auth_token")
                return False
            self._save_state()
            self.logger.info("Registered worker successfully (worker_id=%s)", self.worker_id)
            return True
        except Exception as exc:
            self.logger.error("Worker register request failed: %s", exc)
            return False

    def _request_and_wait_approval(self) -> bool:
        request_url = f"{self.api_base}/workers/request-approval"
        payload = {
            "device_name": self.device_name,
            "ip": self.device_ip,
            "mac": self.device_mac,
            "model": self.device_model,
        }
        try:
            resp = self.session.post(request_url, json=payload, timeout=self.request_timeout)
            if resp.status_code not in (200, 201):
                self.logger.error("Approval request failed (%s): %s", resp.status_code, resp.text[:400])
                return False
            body = resp.json()
            status = safe_strip(body.get("status"))
            if status == "already_registered":
                self.worker_id = safe_strip(body.get("worker_id"))
                self.auth_token = safe_strip(body.get("auth_token"))
                if self.worker_id and self.auth_token:
                    self._save_state()
                    return True
                self.logger.error("Approval flow returned already_registered without credentials")
                return False

            request_id = safe_strip(body.get("request_id"))
            if not request_id:
                self.logger.error("Approval flow missing request_id")
                return False

            self.logger.info("Approval requested (request_id=%s). Waiting for admin approval...", request_id)
            deadline = time.time() + self.approval_timeout
            while not self.stop_requested and time.time() < deadline:
                ok, done = self._poll_approval_status(request_id)
                if done:
                    return ok
                time.sleep(self.approval_poll_interval)

            self.logger.error("Approval timed out")
            return False
        except Exception as exc:
            self.logger.error("Approval request failed: %s", exc)
            return False

    def _poll_approval_status(self, request_id: str) -> Tuple[bool, bool]:
        status_url = f"{self.api_base}/workers/approval-status/{request_id}"
        try:
            resp = self.session.get(status_url, timeout=self.request_timeout)
            if resp.status_code != 200:
                self.logger.warning("Approval status check failed (%s)", resp.status_code)
                return False, False
            body = resp.json()
            status = safe_strip(body.get("status"))
            if status == "approved":
                self.worker_id = safe_strip(body.get("worker_id"))
                self.auth_token = safe_strip(body.get("auth_token"))
                if self.worker_id and self.auth_token:
                    self._save_state()
                    self.logger.info("Worker approved (worker_id=%s)", self.worker_id)
                    return True, True
                self.logger.error("Approved status but credentials missing")
                return False, True
            if status == "rejected":
                self.logger.error("Worker approval rejected: %s", body.get("reject_reason"))
                return False, True
            return False, False
        except Exception as exc:
            self.logger.warning("Approval status check error: %s", exc)
            return False, False

    def _build_child_env(self) -> Dict[str, str]:
        env = dict(os.environ)
        env["WORKER_ID"] = self.worker_id
        env["AUTH_TOKEN"] = self.auth_token
        env["IRIS_JETSON_ID"] = self.worker_id
        # Inference processes talk to local edge gateway; gateway forwards to control-plane.
        env["CENTRAL_SERVER_URL"] = self.gateway_url
        env["IRIS_API_BASE_URL"] = f"{self.gateway_url}/api"
        env["INFERENCE_STRICT_API_CONFIG"] = os.getenv("INFERENCE_STRICT_API_CONFIG", "1")
        env["FRS_FORCE_API"] = os.getenv("FRS_FORCE_API", "1")
        return env

    def _start_inference(self) -> None:
        if self.child_proc and self.child_proc.poll() is None:
            return

        if not self.python_bin:
            self.python_bin = sys.executable

        if env_bool("EDGE_FRS_ONLY", False):
            # FRS-only mode: start only frs-analytics, nothing else.
            cmd = [self.python_bin, str(self.inference_root / "start_frs.py"), "--python-bin", self.python_bin]
            if env_bool("EDGE_FRS_LOCAL_ONLY", False):
                cmd.append("--frs-local-only")
        else:
            cmd = [self.python_bin, str(self.inference_root / "start_all_inference.py"), "--python-bin", self.python_bin]
            if not env_bool("EDGE_ENABLE_ANPR", True):
                cmd.append("--no-anpr-api")
            if not env_bool("EDGE_ENABLE_CROWD", True):
                cmd.append("--no-crowd")
            if not env_bool("EDGE_ENABLE_CROWD_FLOW", True):
                cmd.append("--no-crowd-flow")
            if not env_bool("EDGE_ENABLE_FRS", True):
                cmd.append("--no-frs")
            if env_bool("EDGE_FRS_LOCAL_ONLY", False):
                cmd.append("--frs-local-only")

        self.logger.info("Starting inference process: %s", " ".join(cmd))
        self.child_proc = subprocess.Popen(
            cmd,
            cwd=str(self.inference_root),
            env=self._build_child_env(),
            stdout=sys.stdout,
            stderr=sys.stderr,
        )

    def _stop_inference(self) -> None:
        if not self.child_proc:
            return
        if self.child_proc.poll() is not None:
            self.child_proc = None
            return
        self.logger.info("Stopping inference process (pid=%s)", self.child_proc.pid)
        self.child_proc.terminate()
        try:
            self.child_proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            self.logger.warning("Force killing inference process")
            self.child_proc.kill()
        self.child_proc = None

    def _restart_inference(self) -> None:
        self._stop_inference()
        time.sleep(1)
        self._start_inference()

    def _collect_resources(self) -> Dict[str, Any]:
        resources: Dict[str, Any] = {}

        # CPU load
        try:
            load1, _, _ = os.getloadavg()
            resources["cpu_load_1m"] = round(load1, 2)
        except Exception:
            pass

        # Memory usage from /proc/meminfo
        try:
            meminfo: Dict[str, float] = {}
            with open("/proc/meminfo", "r", encoding="utf-8") as f:
                for line in f:
                    key, val = line.split(":", 1)
                    meminfo[key.strip()] = float(val.strip().split()[0])
            total = meminfo.get("MemTotal", 0.0)
            available = meminfo.get("MemAvailable", 0.0)
            if total > 0:
                used_pct = ((total - available) / total) * 100.0
                resources["memory_percent"] = round(used_pct, 2)
        except Exception:
            pass

        # Optional thermal reading
        try:
            thermal = Path("/sys/class/thermal/thermal_zone0/temp")
            if thermal.exists():
                value = float(thermal.read_text(encoding="utf-8").strip())
                resources["temperature_c"] = round(value / 1000.0, 1)
        except Exception:
            pass

        return resources

    def _send_heartbeat(self) -> None:
        if not self.worker_id or not self.auth_token:
            return
        url = f"{self.api_base}/workers/{self.worker_id}/heartbeat"
        payload = {
            "resources": self._collect_resources(),
            "cameras_active": self.last_camera_count,
            "analytics_running": self.last_analytics,
            "events_stats": {},
        }
        headers = {"X-Auth-Token": self.auth_token}
        try:
            resp = self.session.post(url, json=payload, headers=headers, timeout=self.request_timeout)
            if resp.status_code != 200:
                self.logger.warning("Heartbeat failed (%s): %s", resp.status_code, resp.text[:200])
        except Exception as exc:
            self.logger.warning("Heartbeat request failed: %s", exc)

    def _poll_config(self) -> None:
        if not self.worker_id or not self.auth_token:
            return
        url = f"{self.api_base}/workers/{self.worker_id}/config"
        headers = {"X-Auth-Token": self.auth_token}
        try:
            resp = self.session.get(url, headers=headers, timeout=self.request_timeout)
            if resp.status_code != 200:
                self.logger.warning("Config poll failed (%s): %s", resp.status_code, resp.text[:200])
                return
            body = resp.json()
            config_version = body.get("config_version")
            cameras = body.get("cameras", []) or []
            analytics_set = set()
            for cam in cameras:
                for analytic in cam.get("analytics", []) or []:
                    if isinstance(analytic, str) and analytic.strip():
                        analytics_set.add(analytic.strip())
            self.last_camera_count = len(cameras)
            self.last_analytics = sorted(analytics_set)

            if isinstance(config_version, int):
                if self.last_config_version is None:
                    self.last_config_version = config_version
                    self._save_state()
                elif config_version != self.last_config_version:
                    self.logger.info(
                        "Config version changed (%s -> %s), restarting inference",
                        self.last_config_version,
                        config_version,
                    )
                    self.last_config_version = config_version
                    self._save_state()
                    self._restart_inference()
        except Exception as exc:
            self.logger.warning("Config poll error: %s", exc)

    def _handle_signal(self, signum: int, _frame: Any) -> None:
        self.logger.info("Received signal %s, shutting down", signum)
        self.stop_requested = True

    def run(self) -> int:
        signal.signal(signal.SIGTERM, self._handle_signal)
        signal.signal(signal.SIGINT, self._handle_signal)

        self.logger.info("Starting edge agent (server=%s, device=%s)", self.server_url, self.device_name)

        while not self.stop_requested:
            if not self._ensure_credentials():
                time.sleep(self.retry_delay)
                continue

            if not self.child_proc or self.child_proc.poll() is not None:
                self._start_inference()

            if self.child_proc and self.child_proc.poll() is not None:
                code = self.child_proc.returncode
                self.logger.warning("Inference exited with code %s; restarting in %ss", code, self.retry_delay)
                self.child_proc = None
                time.sleep(self.retry_delay)
                continue

            now = time.time()
            if now - self.last_config_poll >= self.config_poll_interval:
                self.last_config_poll = now
                self._poll_config()
            if now - self.last_heartbeat >= self.heartbeat_interval:
                self.last_heartbeat = now
                self._send_heartbeat()

            time.sleep(1)

        self._stop_inference()
        self.logger.info("Edge agent stopped")
        return 0


def main() -> int:
    return EdgeAgent().run()


if __name__ == "__main__":
    raise SystemExit(main())
