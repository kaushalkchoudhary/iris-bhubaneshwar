# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

IRIS Bhubaneswar — a surveillance analytics platform. A **central Mac** (10.10.0.250, port 3002) runs the Go backend and serves the React frontend. Five **Jetson edge devices** run face recognition inference and stream camera frames to the Mac over a WireGuard LAN (10.10.0.x).

---

## Build & Run

### Backend (Go 1.24, `backend/`)

```bash
cd backend
go build -o ../runtime-backend/iris-backend .   # build
bash ../scripts/iris_backend.sh                  # build + run (sources .env, sets PORT=3002)
go test ./...                                    # test
go fmt ./...                                     # format
```

`scripts/iris_backend.sh` is the canonical way to run — it sources `backend/.env`, overrides `PORT=3002` and `BIND_ADDR=0.0.0.0`, then runs the binary from the **project root** (not from `backend/`). The binary's CWD being the project root matters for script path resolution (e.g. `backend/scripts/get_face_embedding.py`).

**Required env** (in `backend/.env`):
- `DATABASE_URL` — primary DB (PostgreSQL at localhost:5433, db: `bhubaneswar`)
- `JWT_SECRET`
- `FRS_DATABASE_URL` — if unset, FRS tables land on the primary DB (current setup: unset)

### Frontend (React 19 + Vite 7, `frontend/`)

```bash
cd frontend
npm install
npm run dev      # dev server at http://localhost:8444
npm run build    # tsc + vite build
npm run lint     # ESLint
```

Vite proxies `/api/*` → `localhost:3002`, `/ws/*` → `localhost:3002`, `/media/*` → mediamtx:8888.

### Inference (Python, `inference-backend/`)

```bash
cd inference-backend
.venv/bin/python start_frs.py          # FRS-only (Jetson mode)
.venv/bin/python start_all_inference.py  # All analytics
```

### Docker (databases + MQTT)

```bash
cd backend
docker compose up -d      # postgres:5433, frs_db:5434, mqtt:1883, mediamtx
```

---

## Repository Structure

```
backend/            Go REST API (Gin, GORM, NATS embedded, Gorilla WS)
  handlers/         HTTP handlers — one file per domain (frs.go, workers.go, feeds.go, …)
  models/           GORM models (models.go = devices/workers/vehicles; frs.go = FRS)
  services/         FeedHub (WebSocket fanout), NATS pub/sub
  database/         DB init, auto-migrate, pgvector schema

frontend/           React 19 + TypeScript + Tailwind CSS 4
  src/
    components/     UI components by domain (crowd/, cameras/, analytics/, …)
    pages/          Route-level pages
    hooks/          Custom React hooks (useWebSocket, useFeedHub, …)
    api/            API client wrappers

inference-backend/  Python analytics services (deployed to Jetsons)
  frs-analytics/    Face recognition: run.py, api_reporter.py, watchlist_manager.py,
                    embedding_server.py (GPU HTTP server, port 5555)
  crowd-analytics/  Crowd density
  ANPR-VCC_analytics/ License plate recognition
  common/           config_manager.py, process_orchestrator.py, frame_grabber.py
  start_frs.py      FRS-only launcher (starts frs workers + embedding_server.py)

deploy/jetson/      Edge device management
  edge_agent.py     Runs on each Jetson — registers, polls config, starts inference
  install_edge.sh   One-shot installer (copies to /opt/iris-edge/, installs systemd)

scripts/
  iris_backend.sh   Backend wrapper (sources .env, sets PORT=3002, starts binary)
  start_all_services.sh  Starts frontend + backend locally with log rotation
  jetson_status.sh  Health check across all 5 Jetsons
```

---

## Key Architecture Patterns

### Active Database
The backend uses a **single PostgreSQL DB**: `bhubaneswar` at `localhost:5433` (docker container `iris2new-postgres`). `FRS_DATABASE_URL` is intentionally unset in `.env`, so `database.FRS()` falls back to `database.DB`. The `irisfrs` DB at port 5434 exists but is unused by the backend.

### Watchlist Version (in-memory)
`watchlistVersion` in `frs.go` is an in-memory counter that resets on every backend restart. Jetsons poll `GET /api/inference/frs/watchlist-version` every 5 s; any change triggers a full persons re-fetch. After a backend restart, version=0 causes all Jetsons to re-sync automatically.

### WebSocket Feed Protocol
Jetsons publish to `ws://10.10.0.250:3002/ws/publish`:
- Binary frame: `[0x01][1-byte keyLen][workerID.cameraID bytes][JPEG bytes]`
- Detection JSON: `[0x02][1-byte keyLen][workerID.cameraID bytes][JSON bytes]`

Browser clients subscribe via `ws://backend:3002/ws/feeds`, send `{"type":"subscribe","camera":"workerID.cameraID"}`. NATS subject: `detections.{workerID}.{cameraID}`.

**Camera key format**: `{workerID}.{cameraID}` — e.g. `wk_51b031e35d101ded.cam_d03`. The `cameraID` must be the device's `device_id` string (e.g. `cam_d03`), **not** the numeric DB `id`.

### GPU Face Embedding
When a face is enrolled (POST `/api/frs/persons`), the backend reads the uploaded JPEG bytes and POSTs them to `http://{worker.IP}:5555/embed` (the Jetson GPU embedding server). It tries each active worker in order until one succeeds. No local Python fallback exists — if no Jetsons are reachable, the person is saved without an embedding (non-fatal; the embedding can be added later).

The embedding server (`frs-analytics/embedding_server.py`) runs on each Jetson inside `start_frs.py`, loads InsightFace buffalo_l at startup, and returns a 512-dim float array.

### FRS Inference Flow
1. Jetsons run `frs-analytics/run.py` per camera (managed by `process_orchestrator.py`)
2. `watchlist_manager.py` polls watchlist version every 5 s, fetches persons on change
3. On face detection: `api_reporter.py` POSTs `face_crop.jpg` + `frame.jpg` to `/api/frs/detections`
4. Backend stores to `frs_detections`, bumps watchlist version (so frontend UI updates)

---

## Jetson Fleet

| IP | Notes |
|----|-------|
| 10.10.0.11 | Also runs `frs-distributed/distributor_service.py` |
| 10.10.0.13 | 0 FRS cameras assigned |
| 10.10.0.14 | Standard |
| 10.10.0.22 | Also runs the Go backend |
| 10.10.0.150 | USSStreamcontroller takes ~970 MB extra RAM |

**SSH**: `ssh jetson@<IP>` (password: `jetson`)
**Sudo**: `echo jetson | sudo -S <cmd>`
**SCP to root-owned paths**: SCP to `/tmp/` then `sudo mv`
**Service**: `sudo systemctl restart iris-edge.service`
**Logs**: `sudo journalctl -u iris-edge.service -f`
**Inference root**: `/opt/iris-edge/inference-backend/`
**Python/venv**: `/opt/iris-edge/.venv/bin/python`
**Env file**: `/etc/iris-edge/edge.env` (requires sudo; `EDGE_FRS_ONLY=1` on all Jetsons)
**Embedding server**: `GET http://<jetson-ip>:5555/health` — should return `{"ok": true}`

### Deploying to Jetsons

```bash
# SCP a file (example: updated run.py)
scp inference-backend/frs-analytics/run.py jetson@10.10.0.11:/tmp/
ssh jetson@10.10.0.11 "echo jetson | sudo -S mv /tmp/run.py /opt/iris-edge/inference-backend/frs-analytics/run.py"

# Restart and verify
ssh jetson@10.10.0.11 "echo jetson | sudo -S systemctl restart iris-edge.service && sleep 3 && echo jetson | sudo -S systemctl is-active iris-edge.service"

# Loop over all 5
for IP in 10.10.0.11 10.10.0.13 10.10.0.14 10.10.0.22 10.10.0.150; do
  echo "=== $IP ===" && ssh jetson@$IP "..."
done
```

---

## Backend API Conventions

- **Auth**: JWT Bearer token required for most endpoints; `/api/inference/*` endpoints are unauthenticated (for Jetsons)
- **FRS public endpoints**: `GET /api/inference/frs/watchlist-version`, `GET /api/inference/frs/persons`, `POST /api/frs/detections`
- **Worker self-config**: `GET /api/inference/worker/own-config` (Jetson polls this with its auth token)
- **Feed stats**: `GET /api/feeds/stats` → shows `publishingNow` cameras

## Frontend Routes

- `/` → redirects to `/vms`
- `/vms` → Live camera feeds (WebSocketVideoFrame)
- `/frs` → CrowdFRSPage: Alerts / Unknown / Live panels
- `/analytics` → AnalyticsPage: FRS Analytics + Alerts Summary
- `/analytics/alerts` → AlertsPage: alert list + detail
- `/settings` → SettingsPage
