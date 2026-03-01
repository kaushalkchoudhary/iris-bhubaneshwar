#!/usr/bin/env bash
set -euo pipefail

umask 027

log() {
  printf '[deploy] %s\n' "$*"
}

DEPLOY_PATH="${DEPLOY_PATH:-/root/iris2}"
GIT_BRANCH="${GIT_BRANCH:-main}"
BACKEND_SERVICE="${BACKEND_SERVICE:-iris-backend}"
NGINX_SITE_CONF="${NGINX_SITE_CONF:-/etc/nginx/sites-enabled/default}"
FRONTEND_WEB_ROOT="${FRONTEND_WEB_ROOT:-}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-}"
RUNTIME_PREFIX="${RUNTIME_PREFIX:-/opt/iris2}"
DEPLOY_FROM_GIT="${DEPLOY_FROM_GIT:-0}"
SKIP_SERVICE_RESTART="${SKIP_SERVICE_RESTART:-0}"
SKIP_BUILD="${SKIP_BUILD:-0}"

# Cleaning knobs (safe defaults).
# - CLEAN=1: remove dist outputs and use a temporary Go build cache.
# - FULL_CLEAN=1: also delete node_modules and run aggressive npm cache clean.
CLEAN="${CLEAN:-1}"
FULL_CLEAN="${FULL_CLEAN:-0}"

infer_web_root() {
  if [[ -f "$NGINX_SITE_CONF" ]]; then
    awk '/^[[:space:]]*root[[:space:]]+/ {gsub(";", "", $2); print $2; exit}' "$NGINX_SITE_CONF"
  fi
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    log "Missing required command: $1"
    exit 1
  }
}

require_cmd git
require_cmd npm
require_cmd go
require_cmd rsync
require_cmd nginx
require_cmd systemctl
require_cmd journalctl
require_cmd mktemp
require_cmd flock

if [[ ! -d "$DEPLOY_PATH/.git" ]]; then
  log "Deploy path is not a git repository: $DEPLOY_PATH"
  exit 1
fi

# Prevent concurrent deploys from stepping on each other.
LOCK_FILE="/var/lock/iris2-deploy.lock"
mkdir -p "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "Another deploy appears to be running (lock: $LOCK_FILE)"
  exit 1
fi

if [[ -z "$FRONTEND_WEB_ROOT" ]]; then
  INFERRED_ROOT="$(infer_web_root || true)"
  if [[ -n "${INFERRED_ROOT:-}" ]]; then
    FRONTEND_WEB_ROOT="$INFERRED_ROOT"
    log "Using nginx root from $NGINX_SITE_CONF: $FRONTEND_WEB_ROOT"
  else
    FRONTEND_WEB_ROOT="$RUNTIME_PREFIX/frontend/dist"
    log "Using runtime frontend web root: $FRONTEND_WEB_ROOT"
  fi
fi

BACKEND_BINARY_PATH="$DEPLOY_PATH/backend/iris-backend"
RUNTIME_BACKEND_BIN="$RUNTIME_PREFIX/backend/iris-backend"
RUNTIME_CLIENT_DIST="$RUNTIME_PREFIX/frontend/dist"

log "Deploy path: $DEPLOY_PATH"
log "Branch: $GIT_BRANCH"
log "Frontend web root: $FRONTEND_WEB_ROOT"
log "Backend service: $BACKEND_SERVICE"
log "Runtime prefix: $RUNTIME_PREFIX"
log "Deploy from git: $DEPLOY_FROM_GIT"
log "Skip build: $SKIP_BUILD"
log "Clean: $CLEAN (full: $FULL_CLEAN)"

cd "$DEPLOY_PATH"

if [[ "$DEPLOY_FROM_GIT" == "1" ]]; then
  log "Fetching latest git refs"
  git fetch --prune origin
  git checkout "$GIT_BRANCH"
  git pull --ff-only origin "$GIT_BRANCH"
else
  log "Skipping git sync; deploying current local workspace state"
fi

STAGING_DIR="$(mktemp -d /tmp/iris2-deploy.XXXXXX)"
cleanup() { rm -rf "$STAGING_DIR"; }
trap cleanup EXIT

if [[ "$SKIP_BUILD" == "1" ]]; then
  log "Skipping frontend/backend build + frontend sync (SKIP_BUILD=1)"
else
  log "Building frontend"
  cd "$DEPLOY_PATH/frontend"
  if [[ "$CLEAN" == "1" ]]; then
    rm -rf dist
  fi
  if [[ "$FULL_CLEAN" == "1" ]]; then
    rm -rf node_modules
    npm cache clean --force || true
  else
    npm cache verify >/dev/null 2>&1 || true
  fi

  npm ci
  npm run build

  log "Staging frontend"
  mkdir -p "$STAGING_DIR/frontend-dist"
  rsync -a --delete "$DEPLOY_PATH/frontend/dist/" "$STAGING_DIR/frontend-dist/"

  log "Building backend"
  cd "$DEPLOY_PATH/backend"
  export GOCACHE="$STAGING_DIR/go-build-cache"
  mkdir -p "$GOCACHE"
  if [[ "$CLEAN" == "1" ]]; then
    go clean -cache >/dev/null 2>&1 || true
  fi
  go mod download
  go build -o "$STAGING_DIR/iris-backend" main.go

  log "Installing runtime artifacts under $RUNTIME_PREFIX"
  mkdir -p "$(dirname "$RUNTIME_BACKEND_BIN")" "$RUNTIME_CLIENT_DIST" "$FRONTEND_WEB_ROOT"

  # Backup previous binary for quick rollback.
  if [[ -f "$RUNTIME_BACKEND_BIN" ]]; then
    cp -a "$RUNTIME_BACKEND_BIN" "$RUNTIME_BACKEND_BIN.bak.$(date +%Y%m%d%H%M%S)"
  fi

  install -m 0755 "$STAGING_DIR/iris-backend" "$RUNTIME_BACKEND_BIN"
  rsync -a --delete "$STAGING_DIR/frontend-dist/" "$RUNTIME_CLIENT_DIST/"
  rsync -a --delete "$STAGING_DIR/frontend-dist/" "$FRONTEND_WEB_ROOT/"

  # Keep static artifacts world-readable even with restrictive umask.
  # Backend serves /opt/iris2/frontend/dist and some setups let nginx serve FRONTEND_WEB_ROOT directly.
  chmod -R a+rX "$RUNTIME_CLIENT_DIST" "$FRONTEND_WEB_ROOT"
fi

if [[ "$SKIP_SERVICE_RESTART" == "1" ]]; then
  log "Skipping backend/nginx reload (SKIP_SERVICE_RESTART=1)"
else
  log "Restarting backend service"
  systemctl restart "$BACKEND_SERVICE"
  systemctl is-active --quiet "$BACKEND_SERVICE" || {
    log "Backend service failed to start: $BACKEND_SERVICE"
    log "Last 30 lines:"
    journalctl -u "$BACKEND_SERVICE" --no-pager -n 30 || true
    exit 1
  }

  log "Reloading nginx"
  nginx -t
  systemctl reload nginx
fi

if [[ -n "$HEALTHCHECK_URL" ]]; then
  require_cmd curl
  log "Running health check: $HEALTHCHECK_URL"
  curl --fail --silent --show-error --max-time 15 "$HEALTHCHECK_URL" >/dev/null
fi

log "Deployment complete"
