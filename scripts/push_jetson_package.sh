#!/usr/bin/env bash
set -euo pipefail

# Robust package push for older macOS rsync/openrsync.
# - Retries each host
# - Resumes partial transfers (--append --partial --inplace)
# - Verifies remote file size

PKG_PATH="${1:-}"
if [[ -z "${PKG_PATH}" ]]; then
  PKG_PATH="$(ls -1t "$(cd "$(dirname "$0")/.." && pwd)/dist"/iris-edge-node-*.tar.gz 2>/dev/null | head -n 1 || true)"
fi

if [[ -z "${PKG_PATH}" || ! -f "${PKG_PATH}" ]]; then
  echo "ERROR: package not found. Pass path as first arg or build one in dist/." >&2
  exit 1
fi

JETSON_USER="${JETSON_USER:-jetson}"
REMOTE_DIR="${REMOTE_DIR:-/home/jetson}"
MAX_RETRIES="${MAX_RETRIES:-5}"
SLEEP_SECS="${SLEEP_SECS:-5}"
IPS=(
  "10.10.0.11"
  "10.10.0.13"
  "10.10.0.14"
  "10.10.0.22"
  "10.10.0.150"
)

PKG_BASENAME="$(basename "${PKG_PATH}")"
LOCAL_SIZE="$(stat -f%z "${PKG_PATH}")"

echo "Package: ${PKG_PATH}"
echo "Size: ${LOCAL_SIZE} bytes"

for ip in "${IPS[@]}"; do
  echo
  echo "==== ${ip} ===="
  ssh -o ConnectTimeout=8 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 "${JETSON_USER}@${ip}" "mkdir -p '${REMOTE_DIR}'" >/dev/null

  attempt=1
  while (( attempt <= MAX_RETRIES )); do
    echo "Attempt ${attempt}/${MAX_RETRIES}: sending ${PKG_BASENAME} to ${ip}"
    if rsync -avP --partial --append --inplace --timeout=60 \
      -e "ssh -c aes128-ctr -o Compression=no -o ServerAliveInterval=15 -o ServerAliveCountMax=10 -o ConnectTimeout=8" \
      "${PKG_PATH}" "${JETSON_USER}@${ip}:${REMOTE_DIR}/"; then

      REMOTE_SIZE="$(ssh -o ConnectTimeout=8 "${JETSON_USER}@${ip}" "stat -c%s '${REMOTE_DIR}/${PKG_BASENAME}' 2>/dev/null || echo 0")"
      if [[ "${REMOTE_SIZE}" == "${LOCAL_SIZE}" ]]; then
        echo "OK ${ip}: transfer complete (${REMOTE_SIZE} bytes)"
        break
      fi

      echo "WARN ${ip}: size mismatch local=${LOCAL_SIZE} remote=${REMOTE_SIZE}"
    else
      echo "WARN ${ip}: rsync failed"
    fi

    if (( attempt == MAX_RETRIES )); then
      echo "ERROR ${ip}: failed after ${MAX_RETRIES} attempts" >&2
      exit 1
    fi
    attempt=$((attempt + 1))
    sleep "${SLEEP_SECS}"
  done
done

echo
echo "All Jetsons received ${PKG_BASENAME}"
