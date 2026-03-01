#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo $0"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INSTALL_ROOT="/opt/iris-edge"
ENV_DIR="/etc/iris-edge"
SERVICE_DST="/etc/systemd/system/iris-edge.service"
GATEWAY_SERVICE_DST="/etc/systemd/system/iris-edge-gateway.service"
FRS_WORKER_SERVICE_DST="/etc/systemd/system/iris-frs-worker.service"
FRS_DISTRIBUTOR_SERVICE_DST="/etc/systemd/system/iris-frs-distributor.service"

echo "[1/6] Creating directories"
mkdir -p "${INSTALL_ROOT}" "${ENV_DIR}" /var/lib/iris-edge /var/log/iris-edge

echo "[2/8] Copying agent files"
install -m 755 "${ROOT_DIR}/deploy/jetson/edge_agent.py" "${INSTALL_ROOT}/edge_agent.py"
rm -rf "${INSTALL_ROOT}/inference-backend"
mkdir -p "${INSTALL_ROOT}/inference-backend"
tar -C "${ROOT_DIR}/inference-backend" \
  --exclude ".venv" \
  --exclude "__pycache__" \
  --exclude "logs" \
  --exclude "*.pyc" \
  -cf - . | tar -C "${INSTALL_ROOT}/inference-backend" -xf -

echo "[3/8] Installing bundled FRS model cache"
if [[ -d "${ROOT_DIR}/.insightface/models/buffalo_l" ]]; then
  mkdir -p "${INSTALL_ROOT}/.insightface/models"
  rm -rf "${INSTALL_ROOT}/.insightface/models/buffalo_l"
  tar -C "${ROOT_DIR}/.insightface/models" -cf - buffalo_l | tar -C "${INSTALL_ROOT}/.insightface/models" -xf -
  ln -sfn "${INSTALL_ROOT}/.insightface" /root/.insightface
  echo "Installed FRS models to ${INSTALL_ROOT}/.insightface/models/buffalo_l"
else
  echo "WARN: Bundled FRS model cache missing at ${ROOT_DIR}/.insightface/models/buffalo_l"
fi

echo "[4/8] Installing edge gateway source"
rm -rf "${INSTALL_ROOT}/edge-gateway"
mkdir -p "${INSTALL_ROOT}/edge-gateway" "${INSTALL_ROOT}/bin"
tar -C "${ROOT_DIR}/deploy/jetson/edge-gateway" -cf - . | tar -C "${INSTALL_ROOT}/edge-gateway" -xf -

echo "[5/8] Building edge gateway binary"
if ! command -v go >/dev/null 2>&1; then
  echo "Go toolchain not found. Install Go 1.24+ on Jetson and rerun."
  exit 1
fi
(
  cd "${INSTALL_ROOT}/edge-gateway"
  go build -o "${INSTALL_ROOT}/bin/iris-edge-gateway" .
)
chmod 755 "${INSTALL_ROOT}/bin/iris-edge-gateway"

echo "[6/8] Preparing Python environment"
if [[ ! -x "${INSTALL_ROOT}/.venv/bin/python" ]]; then
  python3 -m venv "${INSTALL_ROOT}/.venv"
fi
"${INSTALL_ROOT}/.venv/bin/python" -m pip install --upgrade pip setuptools wheel
"${INSTALL_ROOT}/.venv/bin/pip" install -r "${INSTALL_ROOT}/inference-backend/requirements.txt"

echo "[7/8] Installing service files"
install -m 644 "${ROOT_DIR}/deploy/jetson/iris-edge.service" "${SERVICE_DST}"
install -m 644 "${ROOT_DIR}/deploy/jetson/iris-edge-gateway.service" "${GATEWAY_SERVICE_DST}"
install -m 644 "${ROOT_DIR}/deploy/jetson/iris-frs-worker.service" "${FRS_WORKER_SERVICE_DST}"
install -m 644 "${ROOT_DIR}/deploy/jetson/iris-frs-distributor.service" "${FRS_DISTRIBUTOR_SERVICE_DST}"

echo "[8/8] Installing env template (if missing)"
if [[ ! -f "${ENV_DIR}/edge.env" ]]; then
  install -m 640 "${ROOT_DIR}/deploy/jetson/edge.env.example" "${ENV_DIR}/edge.env"
  echo "Created ${ENV_DIR}/edge.env. Edit it before starting service."
fi

echo "Enabling services"
systemctl daemon-reload
systemctl enable iris-edge-gateway.service
systemctl enable iris-edge.service

if [[ "${1:-}" == "--start" ]]; then
  systemctl restart iris-edge-gateway.service
  systemctl restart iris-edge.service
  systemctl --no-pager --full status iris-edge-gateway.service || true
  systemctl --no-pager --full status iris-edge.service || true
else
  echo "Services enabled but not started. Start with:"
  echo "  sudo systemctl restart iris-edge-gateway.service"
  echo "  sudo systemctl restart iris-edge.service"
fi

echo
echo "Optional distributed FRS services:"
echo "  Worker node:     sudo systemctl enable --now iris-frs-worker.service"
echo "  Ingress node:    sudo systemctl enable --now iris-frs-distributor.service"
