#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# IRIS Jetson Diagnostic Script
# Run this directly on a Jetson:  bash /opt/iris-edge/inference-backend/../jetson_status.sh
# Or copy it to the Jetson and run it.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

RESET='\033[0m'; BOLD='\033[1m'; RED='\033[31m'; GREEN='\033[32m'
YELLOW='\033[33m'; CYAN='\033[36m'; DIM='\033[2m'

ok()   { echo -e "${GREEN}✓${RESET} $*"; }
fail() { echo -e "${RED}✗${RESET} $*"; }
warn() { echo -e "${YELLOW}!${RESET} $*"; }
info() { echo -e "${CYAN}→${RESET} $*"; }
hdr()  { echo -e "\n${BOLD}${CYAN}$*${RESET}"; echo -e "${DIM}$(printf '─%.0s' {1..50})${RESET}"; }

# ─── 1. Identity ─────────────────────────────────────────────────────────────
hdr "IRIS JETSON STATUS"

# Try to read env from iris-edge service environment
EDGE_ENV_FILE="/etc/iris-edge/edge.env"
if [[ -f "${EDGE_ENV_FILE}" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "${EDGE_ENV_FILE}"
    set +a
fi

WORKER_ID="${WORKER_ID:-}"
AUTH_TOKEN="${AUTH_TOKEN:-}"
EDGE_SERVER_URL="${EDGE_SERVER_URL:-http://10.10.0.250:3002}"
BACKEND="${EDGE_SERVER_URL%/api*}"         # strip /api if present
BACKEND="${BACKEND%/}"                     # strip trailing slash
API="${BACKEND}/api"

# Also check the iris-edge state file
STATE_FILE="/var/lib/iris-edge/state.json"
if [[ -z "${WORKER_ID}" && -f "${STATE_FILE}" ]]; then
    WORKER_ID="$(python3 -c "import json,sys; d=json.load(open('${STATE_FILE}')); print(d.get('worker_id',''))" 2>/dev/null || true)"
    AUTH_TOKEN="$(python3 -c "import json,sys; d=json.load(open('${STATE_FILE}')); print(d.get('auth_token',''))" 2>/dev/null || true)"
fi

HOSTNAME_VAL="$(hostname -s 2>/dev/null || cat /etc/hostname 2>/dev/null || echo 'unknown')"
IP_ADDR="$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'unknown')"

info "Hostname   : ${HOSTNAME_VAL}"
info "IP Address : ${IP_ADDR}"
info "Backend    : ${BACKEND}"

if [[ -n "${WORKER_ID}" ]]; then
    ok "WORKER_ID  : ${WORKER_ID}"
else
    fail "WORKER_ID  : NOT SET"
fi

if [[ -n "${AUTH_TOKEN}" ]]; then
    masked="${AUTH_TOKEN:0:8}…${AUTH_TOKEN: -4}"
    ok "AUTH_TOKEN : ${masked} (set)"
else
    fail "AUTH_TOKEN : NOT SET"
fi

# ─── 2. iris-edge Service ─────────────────────────────────────────────────────
hdr "iris-edge Service"

if command -v systemctl &>/dev/null; then
    STATUS="$(systemctl is-active iris-edge 2>/dev/null || echo 'unknown')"
    case "${STATUS}" in
        active)  ok "iris-edge.service: ${STATUS}" ;;
        *)       fail "iris-edge.service: ${STATUS}" ;;
    esac
    echo -e "${DIM}$(systemctl status iris-edge --no-pager -l --lines=5 2>&1 | tail -8)${RESET}"
else
    warn "systemctl not found — cannot check service status"
fi

# ─── 3. Backend Connectivity ─────────────────────────────────────────────────
hdr "Backend Connectivity (${BACKEND})"

# HTTP health check
HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "${BACKEND}/api/health" 2>/dev/null || echo '000')"
case "${HTTP_CODE}" in
    200|204) ok "HTTP health: ${HTTP_CODE} — backend reachable" ;;
    000)     fail "HTTP health: timeout or refused (is backend running on ${BACKEND}?)" ;;
    *)       warn "HTTP health: ${HTTP_CODE} (unexpected response)" ;;
esac

# Backend port check (TCP)
WS_HOST="${BACKEND#http*://}"; WS_HOST="${WS_HOST%%/*}"
WS_PORT="${WS_HOST##*:}"; WS_HOST="${WS_HOST%%:*}"
[[ "${WS_PORT}" == "${WS_HOST}" ]] && WS_PORT=80
if timeout 3 bash -c "echo >/dev/tcp/${WS_HOST}/${WS_PORT}" 2>/dev/null; then
    ok "TCP port ${WS_PORT}: open"
else
    fail "TCP port ${WS_PORT}: cannot connect to ${WS_HOST}:${WS_PORT}"
fi

# ─── 4. Assigned Cameras ─────────────────────────────────────────────────────
hdr "Assigned Cameras (from backend API)"

if [[ -z "${WORKER_ID}" || -z "${AUTH_TOKEN}" ]]; then
    warn "WORKER_ID or AUTH_TOKEN not set — skipping camera fetch"
else
    CAMS_JSON="$(curl -s --max-time 10 \
        -H "X-Auth-Token: ${AUTH_TOKEN}" \
        "${API}/workers/${WORKER_ID}/config" 2>/dev/null || echo '{}')"

    CAM_COUNT="$(echo "${CAMS_JSON}" | python3 -c "
import sys, json
d = json.load(sys.stdin)
cams = d.get('cameras', [])
print(len(cams))
for c in cams:
    analytics = ','.join(c.get('analytics', []))
    rtsp = c.get('rtsp_url', c.get('rtspUrl', 'n/a'))
    print(f\"  {c.get('device_id','?'):12s}  {c.get('name','?'):20s}  [{analytics}]  {rtsp}\")
" 2>/dev/null || echo '0')"

    FIRST_LINE="${CAM_COUNT%%$'\n'*}"
    if [[ "${FIRST_LINE}" == "0" ]]; then
        warn "0 cameras assigned to this worker in the backend"
    else
        ok "${FIRST_LINE} camera(s) assigned:"
        echo "${CAM_COUNT#*$'\n'}"
    fi
fi

# ─── 5. Inference Processes ───────────────────────────────────────────────────
hdr "Inference Processes"

INFER_DIR="/opt/iris-edge/inference-backend"

check_process() {
    local name="$1" pattern="$2"
    local pids
    pids="$(pgrep -f "${pattern}" 2>/dev/null | tr '\n' ' ' || true)"
    if [[ -n "${pids}" ]]; then
        ok "${name}: running (pid ${pids})"
    else
        fail "${name}: not running"
    fi
}

check_process "start_all_inference.py" "start_all_inference.py"
check_process "FRS worker (run.py)"    "frs-analytics/run.py"
check_process "crowd worker (run.py)"  "crowd-analytics/run.py"

# ─── 6. FRS Event Reporter Status ─────────────────────────────────────────────
hdr "FRS Event Reporter (last 30 log lines)"

FRS_LOG="${INFER_DIR}/logs/frs.log"
EDGE_LOG_DIR="/var/log/iris-edge"

if [[ -f "${FRS_LOG}" ]]; then
    echo -e "${DIM}Source: ${FRS_LOG}${RESET}"
    grep -E "api/events/ingest|reporter|heartbeat|face_detected|person_match|ERROR|error" \
        "${FRS_LOG}" 2>/dev/null | tail -15 || true
elif [[ -d "${EDGE_LOG_DIR}" ]]; then
    LATEST_LOG="$(ls -t "${EDGE_LOG_DIR}"/*.log 2>/dev/null | head -1 || true)"
    if [[ -n "${LATEST_LOG}" ]]; then
        echo -e "${DIM}Source: ${LATEST_LOG}${RESET}"
        grep -E "api/events/ingest|reporter|heartbeat|face_detected|person_match|ERROR|error" \
            "${LATEST_LOG}" 2>/dev/null | tail -15 || true
    else
        warn "No log files found in ${EDGE_LOG_DIR}"
    fi
else
    warn "FRS log not found at ${FRS_LOG}"
fi

# ─── 7. Event Ingest Endpoint Probe ──────────────────────────────────────────
hdr "Event Ingest Endpoint (backend)"

INGEST_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "${API}/events/ingest" 2>/dev/null || echo '000')"
case "${INGEST_CODE}" in
    404|405) ok "Endpoint reachable: ${API}/events/ingest (HTTP ${INGEST_CODE})" ;;
    000)     fail "Endpoint probe failed: backend unreachable" ;;
    *)       warn "Endpoint probe returned HTTP ${INGEST_CODE}" ;;
esac

# ─── 8. System Resources ──────────────────────────────────────────────────────
hdr "System Resources"

# CPU temp (Jetson-specific)
TEMP_FILE="/sys/class/thermal/thermal_zone0/temp"
if [[ -f "${TEMP_FILE}" ]]; then
    TEMP_C=$(( $(cat "${TEMP_FILE}") / 1000 ))
    if (( TEMP_C > 80 )); then
        fail "CPU temp: ${TEMP_C}°C (HOT)"
    elif (( TEMP_C > 65 )); then
        warn "CPU temp: ${TEMP_C}°C (warm)"
    else
        ok "CPU temp: ${TEMP_C}°C"
    fi
fi

# Memory
if command -v free &>/dev/null; then
    free -h | awk 'NR==2{printf "  RAM: %s used / %s total\n", $3, $2}'
fi

# Disk
df -h / 2>/dev/null | awk 'NR==2{printf "  Disk: %s used / %s total (%s)\n", $3, $2, $5}'

echo ""
echo -e "${BOLD}Done.${RESET}"
