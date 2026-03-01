#!/usr/bin/env python3
"""
Run all inference services (ANPR/VCC API, Crowd, FRS) with:
- per-service GPU assignment
- per-service log files (optional)
- single combined log (optional)
- graceful shutdown
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
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

ANSI_RE = re.compile(r"\x1B\[[0-?]*[ -/]*[@-~]")


def sanitize_log_text(value: str) -> str:
    clean = ANSI_RE.sub("", value)
    # Keep logs ASCII-only for consistent readability in aggregated files.
    clean = clean.encode("ascii", "ignore").decode("ascii")
    return clean.strip()


@dataclass
class ServiceSpec:
    name: str
    cmd: List[str]
    cwd: Path
    gpu: Optional[str] = None


def build_logger(logs_dir: Path, log_file: Optional[Path] = None) -> logging.Logger:
    logs_dir.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("inference-orchestrator")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()

    fmt = logging.Formatter("%(asctime)s | %(levelname)s | %(message)s")

    ch = logging.StreamHandler(sys.stdout)
    ch.setFormatter(fmt)
    logger.addHandler(ch)

    target_log = log_file or (logs_dir / "orchestrator.log")
    target_log.parent.mkdir(parents=True, exist_ok=True)
    fh = logging.FileHandler(target_log)
    fh.setFormatter(fmt)
    logger.addHandler(fh)
    return logger


def stream_output(
    name: str,
    pipe,
    logs_dir: Path,
    main_logger: logging.Logger,
    write_service_log: bool = True,
) -> None:
    service_log: Optional[Path] = logs_dir / f"{name}.log" if write_service_log else None
    file_handle = service_log.open("a", encoding="utf-8") if service_log is not None else None
    try:
        for line in iter(pipe.readline, ""):
            msg = sanitize_log_text(line.rstrip())
            if not msg:
                continue
            prefixed = f"[{name}] {msg}"
            main_logger.info(prefixed)
            if file_handle is not None:
                file_handle.write(msg + "\n")
                file_handle.flush()
    finally:
        if file_handle is not None:
            file_handle.close()


def start_service(
    spec: ServiceSpec,
    base_env: Dict[str, str],
    logs_dir: Path,
    logger: logging.Logger,
    write_service_log: bool = True,
) -> subprocess.Popen:
    env = dict(base_env)
    if spec.gpu is not None and spec.gpu != "":
        env["CUDA_VISIBLE_DEVICES"] = spec.gpu

    logger.info("Starting %s | gpu=%s | cmd=%s", spec.name, env.get("CUDA_VISIBLE_DEVICES", "all"), " ".join(spec.cmd))
    proc = subprocess.Popen(
        spec.cmd,
        cwd=str(spec.cwd),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    t = threading.Thread(
        target=stream_output,
        args=(spec.name, proc.stdout, logs_dir, logger, write_service_log),
        daemon=True,
    )
    t.start()
    return proc


def stop_all(procs: Dict[str, subprocess.Popen], logger: logging.Logger) -> None:
    for name, proc in procs.items():
        if proc.poll() is None:
            logger.info("Stopping %s (pid=%s)", name, proc.pid)
            proc.terminate()

    deadline = time.time() + 10
    for name, proc in procs.items():
        if proc.poll() is None:
            remaining = max(0.1, deadline - time.time())
            try:
                proc.wait(timeout=remaining)
            except subprocess.TimeoutExpired:
                logger.warning("Force killing %s (pid=%s)", name, proc.pid)
                proc.kill()


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parent
    venv_python3 = repo_root / ".venv" / "bin" / "python3"
    venv_python = repo_root / ".venv" / "bin" / "python"
    default_python = str(
        venv_python3 if venv_python3.exists() else
        venv_python if venv_python.exists() else
        sys.executable
    )

    p = argparse.ArgumentParser(description="Start all inference services with logs and GPU control.")
    p.add_argument("--python-bin", default=default_python, help="Python interpreter path")
    p.add_argument("--api-base-url", default=os.getenv("IRIS_API_BASE_URL", "http://localhost:3001/api"))
    p.add_argument("--anpr-port", type=int, default=int(os.getenv("ANPR_API_PORT", "8001")), help=argparse.SUPPRESS)  # kept for backwards compat, no longer used
    p.add_argument("--logs-dir", default="logs")
    p.add_argument("--no-anpr-api", action="store_true", default=False)
    p.add_argument("--no-crowd", action="store_true", default=False)
    p.add_argument("--no-crowd-flow", action="store_true", default=False)
    p.add_argument("--no-frs", action="store_true")
    p.add_argument("--frs-local-only", action="store_true", help="Run FRS with local-only config source")
    p.add_argument("--max-restarts", type=int, default=10, help="Max restarts per service on unexpected exit")
    p.add_argument("--single-log", action="store_true", help="Write all inference logs into one combined file")
    p.add_argument(
        "--combined-log-file",
        default=os.getenv("INFERENCE_COMBINED_LOG", ""),
        help="Path for combined inference log file (used with --single-log).",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()
    root = Path(__file__).resolve().parent
    logs_dir = (root / args.logs_dir).resolve()
    env_single_log = str(os.getenv("INFERENCE_SINGLE_LOG", "")).lower() in ("1", "true", "yes", "on")
    single_log = bool(args.single_log or env_single_log)
    combined_log_file = Path(args.combined_log_file).resolve() if args.combined_log_file else (logs_dir / "inference.log")
    logger = build_logger(logs_dir, combined_log_file if single_log else None)

    # GPU assignment controls:
    #   ANPR_GPU=0
    #   CROWD_GPU=1
    #   CROWD_FLOW_GPU=1
    #   FRS_GPU=0
    anpr_gpu = os.getenv("ANPR_GPU")
    crowd_gpu = os.getenv("CROWD_GPU")
    crowd_flow_gpu = os.getenv("CROWD_FLOW_GPU", crowd_gpu)  # default same GPU as crowd
    frs_gpu = os.getenv("FRS_GPU")

    base_env = dict(os.environ)
    base_env["PYTHONUNBUFFERED"] = "1"
    base_env["IRIS_API_BASE_URL"] = args.api_base_url
    # Local/dev default: allow fallback to local pipeline config when API token/config is missing.
    # Override to "1" in production deployments that require API-only camera assignment.
    base_env.setdefault("INFERENCE_STRICT_API_CONFIG", "0")
    base_env.setdefault("FRS_FORCE_API", "0")
    # Keep ANPR API artifacts writable in-repo.
    base_env.setdefault(
        "DB_PATH",
        str((root / "ANPR-VCC_analytics" / "data" / "pipeline.db").resolve()),
    )
    base_env.setdefault(
        "OUTPUT_DIR",
        str((root / "ANPR-VCC_analytics" / "output").resolve()),
    )

    services: List[ServiceSpec] = []
    if not args.no_anpr_api:
        services.append(
            ServiceSpec(
                name="anpr",
                cmd=[args.python_bin, "anpr_vcc/run.py"],
                cwd=root / "ANPR-VCC_analytics",
                gpu=anpr_gpu,
            )
        )
    if not args.no_crowd:
        services.append(
            ServiceSpec(
                name="crowd",
                cmd=[args.python_bin, "run.py"],
                cwd=root / "crowd-analytics",
                gpu=crowd_gpu,
            )
        )
    if not args.no_crowd_flow:
        services.append(
            ServiceSpec(
                name="crowd-flow",
                cmd=[args.python_bin, "run.py"],
                cwd=root / "crowd-flow",
                gpu=crowd_flow_gpu,
            )
        )
    if not args.no_frs:
        frs_cmd = [args.python_bin, "run.py"]
        if args.frs_local_only:
            frs_cmd.append("--local-only")
        services.append(
            ServiceSpec(
                name="frs",
                cmd=frs_cmd,
                cwd=root / "frs-analytics",
                gpu=frs_gpu,
            )
        )

    if not services:
        logger.error("No services selected.")
        return 1

    stop_event = threading.Event()
    procs: Dict[str, subprocess.Popen] = {}
    restart_counts: Dict[str, int] = {s.name: 0 for s in services}
    specs_by_name = {s.name: s for s in services}

    def _handle_signal(signum, _frame):
        logger.info("Received signal %s, shutting down...", signum)
        stop_event.set()

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    for spec in services:
        procs[spec.name] = start_service(spec, base_env, logs_dir, logger, write_service_log=not single_log)

    try:
        while not stop_event.is_set():
            time.sleep(1)
            for name, proc in list(procs.items()):
                code = proc.poll()
                if code is None:
                    continue

                if stop_event.is_set():
                    continue

                if restart_counts[name] >= args.max_restarts:
                    logger.error("%s exited with code %s and restart limit reached — removing service (others continue).", name, code)
                    del procs[name]
                    break

                restart_counts[name] += 1
                logger.warning(
                    "%s exited with code %s. Restarting (%d/%d)...",
                    name,
                    code,
                    restart_counts[name],
                    args.max_restarts,
                )
                time.sleep(2)
                procs[name] = start_service(specs_by_name[name], base_env, logs_dir, logger, write_service_log=not single_log)
    finally:
        stop_all(procs, logger)
        logger.info("All services stopped.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
