#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATE_DIR="${ROOT_DIR}/runtime-logs/$(date +%F)"
PID_FILE="${DATE_DIR}/pids.env"

FRONTEND_PORT="${FRONTEND_PORT:-8444}"
BACKEND_PORT="${BACKEND_PORT:-3002}"
ANPR_PORT="${ANPR_PORT:-8001}"
LOCAL_INFERENCE_ENABLED="${LOCAL_INFERENCE_ENABLED:-0}"

mkdir -p "${DATE_DIR}"

# Load backend/.env so DATABASE_URL and other vars are available
if [[ -f "${ROOT_DIR}/backend/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ROOT_DIR}/backend/.env"
  set +a
fi

is_port_listening() {
  local port="$1"
  lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1
}

ensure_databases() {
  local compose_file="${ROOT_DIR}/backend/docker-compose.yml"
  if [[ ! -f "${compose_file}" ]]; then
    return 0
  fi

  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    (
      cd "${ROOT_DIR}/backend"
      docker compose up -d db frs_db mqtt
    )
    return 0
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    (
      cd "${ROOT_DIR}/backend"
      docker-compose up -d db frs_db mqtt
    )
    return 0
  fi

  echo "WARN: docker/docker-compose not found; cannot auto-start db/frs_db/mqtt containers." >&2
  echo "      Install Docker Desktop or run PostgreSQL manually." >&2
}

resolve_db_urls() {
  if [[ -n "${DATABASE_URL:-}" ]]; then
    RESOLVED_DATABASE_URL="${DATABASE_URL}"
  elif is_port_listening 5433; then
    RESOLVED_DATABASE_URL="postgresql://iris:iris_dev_password@127.0.0.1:5433/irisdrone?sslmode=disable"
  elif is_port_listening 5432; then
    RESOLVED_DATABASE_URL="postgresql://127.0.0.1:5432/postgres?sslmode=disable"
  else
    RESOLVED_DATABASE_URL=""
  fi

  if [[ -n "${FRS_DATABASE_URL:-}" ]]; then
    RESOLVED_FRS_DATABASE_URL="${FRS_DATABASE_URL}"
  elif is_port_listening 5434; then
    RESOLVED_FRS_DATABASE_URL="postgresql://iris:iris_dev_password@127.0.0.1:5434/irisfrs?sslmode=disable"
  else
    RESOLVED_FRS_DATABASE_URL="${RESOLVED_DATABASE_URL}"
  fi
}

# Stop any old processes for these services (best-effort).
kill_by_pattern() {
  local pattern="$1"
  local pids
  pids="$(ps -ef | grep -F "$pattern" | grep -v "grep\|start_all_services.sh" | awk '{print $2}')" || true
  if [[ -n "${pids:-}" ]]; then
    kill ${pids} || true
  fi
}

kill_by_pattern "vite --port ${FRONTEND_PORT}"
kill_by_pattern "go run main.go"
kill_by_pattern "start_all_inference.py"
kill_by_pattern "uvicorn anpr_vcc.api_server:app"

sleep 1
ensure_databases
resolve_db_urls

if [[ -z "${RESOLVED_DATABASE_URL}" ]]; then
  echo "ERROR: no PostgreSQL detected on 5433 or 5432 and DATABASE_URL is unset." >&2
  echo "Set DATABASE_URL in backend/.env or install/start Docker Desktop, then retry." >&2
  exit 1
fi

echo "DATE_DIR=${DATE_DIR}" > "${PID_FILE}"
echo "FRONTEND_PORT=${FRONTEND_PORT}" >> "${PID_FILE}"
echo "BACKEND_PORT=${BACKEND_PORT}" >> "${PID_FILE}"
echo "ANPR_PORT=${ANPR_PORT}" >> "${PID_FILE}"
echo "LOCAL_INFERENCE_ENABLED=${LOCAL_INFERENCE_ENABLED}" >> "${PID_FILE}"

(
  cd "${ROOT_DIR}/frontend"
  nohup env VITE_BACKEND_URL="http://localhost:${BACKEND_PORT}" npm run dev -- --port "${FRONTEND_PORT}" > "${DATE_DIR}/frontend.log" 2>&1 &
  echo "FRONTEND_PID=$!" >> "${PID_FILE}"
)

(
  cd "${ROOT_DIR}/backend"
  nohup env \
    DATABASE_URL="${RESOLVED_DATABASE_URL}" \
    FRS_DATABASE_URL="${RESOLVED_FRS_DATABASE_URL}" \
    GIN_MODE=release \
    GIN_DISABLE_CONSOLE_COLOR=1 \
    GORM_LOG_LEVEL=warn \
    FRS_TOPOLOGY_SYNC_ON_START=1 \
    FRS_TOPOLOGY_CONFIG_PATH="${ROOT_DIR}/backend/config/config.yml" \
    PORT="${BACKEND_PORT}" \
    BIND_ADDR=0.0.0.0 \
    GOCACHE=/tmp/go-build-cache \
    go run main.go > "${DATE_DIR}/go-backend.log" 2>&1 &
  echo "BACKEND_PID=$!" >> "${PID_FILE}"
)

if [[ "${LOCAL_INFERENCE_ENABLED}" == "1" ]]; then
  (
    cd "${ROOT_DIR}/inference-backend"
    nohup env \
      INFERENCE_SINGLE_LOG=1 \
      INFERENCE_COMBINED_LOG="${DATE_DIR}/inference.log" \
      ANPR_API_PORT="${ANPR_PORT}" \
      WORKER_ID="inference-local" \
      AUTH_TOKEN="iris-inference-secret-token" \
      CENTRAL_SERVER_URL="http://localhost:${BACKEND_PORT}" \
      ./ANPR-VCC_analytics/.venv/bin/python start_all_inference.py \
        --single-log \
        --combined-log-file "${DATE_DIR}/inference.log" \
        > "${DATE_DIR}/inference-launcher.log" 2>&1 &
    echo "INFERENCE_PID=$!" >> "${PID_FILE}"
  )
fi

cat <<MSG
Started all services.

Logs:
- ${DATE_DIR}/frontend.log
- ${DATE_DIR}/go-backend.log
$(if [[ "${LOCAL_INFERENCE_ENABLED}" == "1" ]]; then echo "- ${DATE_DIR}/inference.log"; fi)
$(if [[ "${LOCAL_INFERENCE_ENABLED}" == "1" ]]; then echo "- ${DATE_DIR}/inference-launcher.log"; fi)

PIDs file:
- ${PID_FILE}

Architecture:
- Central server inference: $(if [[ "${LOCAL_INFERENCE_ENABLED}" == "1" ]]; then echo "ENABLED (local dev override)"; else echo "DISABLED (edge-only mode)"; fi)
MSG
