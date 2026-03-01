#!/usr/bin/env bash
# IRIS Backend Wrapper Script
# Sources backend/.env, builds the binary if needed, and runs the backend.
# Used by the macOS LaunchAgent (com.iris.backend.plist) for auto-start.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BINARY="${ROOT_DIR}/runtime-backend/iris-backend"
LOG_DIR="${ROOT_DIR}/runtime-logs"

mkdir -p "${LOG_DIR}"
mkdir -p "$(dirname "${BINARY}")"

# ── Load .env ──────────────────────────────────────────────────────────────────
if [[ -f "${ROOT_DIR}/backend/.env" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "${ROOT_DIR}/backend/.env"
    set +a
fi

# ── Override for live operation ────────────────────────────────────────────────
export PORT=3002
export BIND_ADDR=0.0.0.0
export GIN_MODE=release
export GIN_DISABLE_CONSOLE_COLOR=1
export GORM_LOG_LEVEL=warn
export FRS_TOPOLOGY_SYNC_ON_START=1
export GOCACHE=/tmp/go-build-cache

# FRS topology config (optional — skip if file doesn't exist)
FRS_CFG="${ROOT_DIR}/backend/config/config.yml"
if [[ -f "${FRS_CFG}" ]]; then
    export FRS_TOPOLOGY_CONFIG_PATH="${FRS_CFG}"
fi

# ── Rebuild if source is newer than binary ─────────────────────────────────────
needs_build=0
if [[ ! -x "${BINARY}" ]]; then
    needs_build=1
else
    # Rebuild when any Go source file is newer than the binary
    while IFS= read -r -d '' src; do
        if [[ "${src}" -nt "${BINARY}" ]]; then
            needs_build=1
            break
        fi
    done < <(find "${ROOT_DIR}/backend" -name '*.go' -print0 2>/dev/null)
fi

if [[ "${needs_build}" == "1" ]]; then
    echo "[iris-backend] Building binary → ${BINARY} ..." >&2
    cd "${ROOT_DIR}/backend"
    go build -o "${BINARY}" . 2>&1
    echo "[iris-backend] Build complete." >&2
fi

echo "[iris-backend] Starting on 0.0.0.0:${PORT} ..." >&2
exec "${BINARY}"
