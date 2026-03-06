#!/usr/bin/env python3
"""
FRS-only inference launcher.
Starts only the frs-analytics/run.py service — no ANPR, crowd, or crowd-flow.
Use this on Jetsons (via EDGE_FRS_ONLY=1) or on the central Mac for FRS dev.
"""

from __future__ import annotations

import argparse
import logging
import os
import re
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Optional

ANSI_RE = re.compile(r"\x1B\[[0-?]*[ -/]*[@-~]")


def sanitize_log_text(value: str) -> str:
    clean = ANSI_RE.sub("", value)
    clean = clean.encode("ascii", "ignore").decode("ascii")
    return clean.strip()


def build_logger(logs_dir: Path, log_file: Optional[Path] = None) -> logging.Logger:
    """Build logger. Stdout-only by default; pass log_file to also write to disk."""
    logger = logging.getLogger("frs-launcher")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()

    fmt = logging.Formatter("%(asctime)s | %(levelname)s | %(message)s")

    ch = logging.StreamHandler(sys.stdout)
    ch.setFormatter(fmt)
    logger.addHandler(ch)

    if log_file is not None:
        log_file.parent.mkdir(parents=True, exist_ok=True)
        fh = logging.FileHandler(log_file)
        fh.setFormatter(fmt)
        logger.addHandler(fh)
    return logger


def stream_output(name: str, pipe, logs_dir: Path, main_logger: logging.Logger,
                  write_service_log: bool = True) -> None:
    service_log = (logs_dir / f"{name}.log") if write_service_log else None
    file_handle = service_log.open("a", encoding="utf-8") if service_log else None
    try:
        for line in iter(pipe.readline, ""):
            msg = sanitize_log_text(line.rstrip())
            if not msg:
                continue
            main_logger.info("[%s] %s", name, msg)
            if file_handle:
                file_handle.write(msg + "\n")
                file_handle.flush()
    finally:
        if file_handle:
            file_handle.close()


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parent
    venv_python3 = root / ".venv" / "bin" / "python3"
    venv_python = root / ".venv" / "bin" / "python"
    default_python = str(
        venv_python3 if venv_python3.exists() else
        venv_python if venv_python.exists() else
        sys.executable
    )
    p = argparse.ArgumentParser(description="Start FRS-only inference service.")
    p.add_argument("--python-bin", default=default_python)
    p.add_argument("--api-base-url", default=os.getenv("IRIS_API_BASE_URL", "http://localhost:3002/api"))
    p.add_argument("--logs-dir", default="logs")
    p.add_argument("--frs-local-only", action="store_true", help="Use local config.yaml only (skip API fetch)")
    p.add_argument("--max-restarts", type=int, default=10)
    p.add_argument("--single-log", action="store_true")
    p.add_argument(
        "--combined-log-file",
        default=os.getenv("INFERENCE_COMBINED_LOG", ""),
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()
    root = Path(__file__).resolve().parent
    logs_dir = (root / args.logs_dir).resolve()
    env_single_log = str(os.getenv("INFERENCE_SINGLE_LOG", "")).lower() in ("1", "true", "yes", "on")
    single_log = bool(args.single_log or env_single_log)
    # Default: stdout/journald only — no log files on disk.
    # Set EDGE_LOG_TO_FILE=1 to write logs to disk (dev/debug only).
    log_to_file = str(os.getenv("EDGE_LOG_TO_FILE", "")).lower() in ("1", "true", "yes", "on")
    combined_log = Path(args.combined_log_file).resolve() if args.combined_log_file else (logs_dir / "frs.log")
    file_log = (combined_log if single_log else logs_dir / "frs-launcher.log") if log_to_file else None
    logger = build_logger(logs_dir, file_log)

    base_env = dict(os.environ)
    base_env["PYTHONUNBUFFERED"] = "1"
    base_env["IRIS_API_BASE_URL"] = args.api_base_url
    base_env.setdefault("INFERENCE_STRICT_API_CONFIG", "0")
    base_env.setdefault("FRS_FORCE_API", "0")

    frs_cmd = [args.python_bin, "run.py"]
    if args.frs_local_only:
        frs_cmd.append("--local-only")

    frs_gpu = os.getenv("FRS_GPU")
    if frs_gpu is not None and frs_gpu != "":
        base_env["CUDA_VISIBLE_DEVICES"] = frs_gpu

    frs_dir = root / "frs-analytics"
    if not frs_dir.exists():
        logger.error("frs-analytics directory not found at %s", frs_dir)
        return 1

    write_service_log = log_to_file and not single_log

    stop_event = threading.Event()
    restart_count = 0

    def _handle_signal(signum, _frame):
        logger.info("Received signal %s, shutting down...", signum)
        stop_event.set()

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    # ── Embedding server (GPU) ─────────────────────────────────────────────────
    # Start embedding_server.py so the central Mac can offload face embedding
    # computation to this Jetson's GPU.  Runs on EMBEDDING_SERVER_PORT (default 5555).
    # Set EDGE_EMBED_SERVER=0 to skip on Jetsons that don't need to serve enrollments.
    _embed_enabled = str(os.getenv("EDGE_EMBED_SERVER", "1")).lower() not in ("0", "false", "no", "off")
    embed_server_script = frs_dir / "embedding_server.py"
    embed_proc: Optional[subprocess.Popen] = None
    if _embed_enabled and embed_server_script.exists():
        embed_cmd = [args.python_bin, str(embed_server_script)]
        embed_env = dict(base_env)
        embed_env.setdefault("EMBEDDING_SERVER_PORT", "5555")
        try:
            embed_proc = subprocess.Popen(
                embed_cmd,
                cwd=str(frs_dir),
                env=embed_env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            threading.Thread(
                target=stream_output,
                args=("embed-server", embed_proc.stdout, logs_dir, logger, write_service_log),
                daemon=True,
            ).start()
            logger.info("Embedding server started (pid=%s, port=%s)", embed_proc.pid, embed_env["EMBEDDING_SERVER_PORT"])
        except Exception as exc:
            logger.warning("Could not start embedding server: %s", exc)
            embed_proc = None
    else:
        logger.warning("embedding_server.py not found at %s — skipping", embed_server_script)

    logger.info("Starting FRS service | gpu=%s | cmd=%s", frs_gpu or "all", " ".join(frs_cmd))

    def start_proc() -> subprocess.Popen:
        proc = subprocess.Popen(
            frs_cmd,
            cwd=str(frs_dir),
            env=base_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        t = threading.Thread(
            target=stream_output,
            args=("frs", proc.stdout, logs_dir, logger, write_service_log),
            daemon=True,
        )
        t.start()
        return proc

    proc = start_proc()

    try:
        while not stop_event.is_set():
            time.sleep(1)
            code = proc.poll()
            if code is None:
                continue
            if stop_event.is_set():
                break
            if restart_count >= args.max_restarts:
                logger.error("FRS exited (code=%s) and restart limit (%d) reached. Stopping.", code, args.max_restarts)
                break
            restart_count += 1
            logger.warning("FRS exited (code=%s). Restarting (%d/%d)...", code, restart_count, args.max_restarts)
            time.sleep(2)
            proc = start_proc()
    finally:
        if proc.poll() is None:
            logger.info("Stopping FRS process (pid=%s)", proc.pid)
            proc.terminate()
            try:
                proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                logger.warning("Force killing FRS process")
                proc.kill()
                proc.wait(timeout=5)
        if embed_proc is not None and embed_proc.poll() is None:
            logger.info("Stopping embedding server (pid=%s)", embed_proc.pid)
            embed_proc.terminate()
            try:
                embed_proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                embed_proc.kill()
        logger.info("FRS launcher stopped.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
