#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${ROOT_DIR}/dist"
STAMP="$(date +%Y%m%d-%H%M%S)"
PKG_NAME="iris-edge-node-${STAMP}.tar.gz"
PKG_PATH="${DIST_DIR}/${PKG_NAME}"
MODEL_CACHE_SRC="${FRS_MODEL_CACHE_DIR:-${HOME}/.insightface/models/buffalo_l}"

mkdir -p "${DIST_DIR}"

if [[ ! -d "${MODEL_CACHE_SRC}" ]]; then
  echo "ERROR: FRS model cache not found: ${MODEL_CACHE_SRC}" >&2
  echo "Set FRS_MODEL_CACHE_DIR or ensure InsightFace buffalo_l model cache exists." >&2
  exit 1
fi

COPYFILE_DISABLE=1 tar -czf "${PKG_PATH}" \
  -C "${ROOT_DIR}" \
  --exclude "inference-backend/.venv" \
  --exclude "inference-backend/logs" \
  --exclude "**/__pycache__" \
  --exclude "*.pyc" \
  inference-backend \
  deploy/jetson \
  -C "${HOME}" \
  .insightface/models/buffalo_l

echo "Jetson package created: ${PKG_PATH}"
echo "Bundled FRS models from: ${MODEL_CACHE_SRC}"
echo "Install on Jetson:"
echo "  tar -xzf ${PKG_NAME}"
echo "  cd Iris-sringeri"
echo "  sudo bash deploy/jetson/install_edge.sh"
