# IRIS — Bhubaneswar FRS Deployment

Intelligent Real-time Intelligence System — live deployment for the Bhubaneswar smart-city surveillance project.

Five NVIDIA Jetson edge devices run computer-vision pipelines across 20+ CCTV cameras. A central Go backend on a Mac aggregates streams, stores events, and serves a React dashboard over WireGuard VPN.

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [How FRS Works](#how-frs-works)
3. [Other Analytics](#other-analytics)
4. [Live Video Feed Pipeline](#live-video-feed-pipeline)
5. [Jetson Fleet](#jetson-fleet)
6. [Backend Services](#backend-services)
7. [Frontend](#frontend)
8. [Running Everything](#running-everything)
9. [Jetson Management](#jetson-management)
10. [Troubleshooting](#troubleshooting)
11. [Extra Tools](#extra-tools)

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                 Mac (Central Server) — 10.10.0.250              │
│                                                                  │
│  ┌──────────────┐  ┌────────────────┐  ┌──────────────────────┐ │
│  │  React UI    │  │  Go Backend    │  │  PostgreSQL (Docker)  │ │
│  │  (Vite :8444)│◄─│  Gin  :3002   │─►│  localhost:5433       │ │
│  └──────────────┘  └───────┬────────┘  └──────────────────────┘ │
│                            │  Embedded NATS :4233                │
│                     ┌──────┴──────┐                              │
│                     │  Feed Hub   │  binary WebSocket relay      │
│                     └──────┬──────┘                              │
└────────────────────────────┼────────────────────────────────────┘
                             │  WireGuard VPN  10.10.0.0/24
          ┌──────────────────┼──────────────────────┐
          │                  │                       │
    ┌─────┴──────┐    ┌──────┴─────┐          ┌─────┴──────┐
    │ Jetson-11  │    │ Jetson-14  │          │ Jetson-150 │  ...
    │ 10.10.0.11 │    │10.10.0.14  │          │10.10.0.150 │
    │ D3–D6 (FRS)│    │D11–D14(FRS)│          │D19–D22(FRS)│
    └─────┬──────┘    └──────┬─────┘          └─────┬──────┘
     RTSP cameras      RTSP cameras            RTSP cameras
```

### Key Design Decisions

| Concern | Approach |
|---------|----------|
| Edge AI | Each Jetson runs InsightFace (FRS) + YOLOv8 (crowd) locally on GPU |
| Video streaming | Binary WebSocket — no base64, no NATS for frames |
| Camera config | Jetsons pull their camera list from `/api/workers/{id}/config` every 5 s |
| Network | WireGuard VPN — all Jetsons tunnel into 10.10.0.0/24 |
| Auth | `X-Auth-Token` + `X-Worker-ID` on every Jetson → backend request |
| DB | Single PostgreSQL instance; FRS tables co-located (no separate FRS DB) |
| Process isolation | One OS process per camera on each Jetson |

---

## How FRS Works

### What it does

FRS (Face Recognition System, analytic code `A-6`) detects faces in camera frames, compares them against a watchlist of enrolled persons, and fires alerts when a match exceeds the similarity threshold.

### Pipeline — one process per camera

```
RTSP stream
    │
    ▼
FrameGrabber (thread)
    │  every frame ──► raw_frames_queue ──► raw_stream_sender ──► WS 0x01 JPEG (live preview, ≤25 fps)
    │  every Nth frame (skip_frames=6)
    ▼
frames_queue
    │
    ▼
inference_worker (thread) — InsightFace on GPU
    │  det_size=640×640, batched (batch_size=10)
    │  outputs: (camera_id, frame, [face objects])
    │    face object: bbox, det_score, embedding, gender, age
    ▼
results_queue
    │
    ├──► reporter_queue ──► api_reporter (thread)
    │       • deduplicates by embedding similarity over 30 s / 300 s windows
    │       • compares embedding against watchlist (cosine similarity > 0.35 → match)
    │       • only_watchlist_matches=True: only posts matched faces
    │       • POST /api/frs/events with JPEG snapshot + metadata
    │
    └──► preview_queue ──► detection_sender_worker (thread)
            • filters by confidence + face area
            • WS 0x02 JSON overlay (bounding boxes) to the browser
```

### Watchlist Manager

- Polls `/api/frs/persons` every 60 s to keep the face embedding store fresh
- Embeddings stored in memory as numpy arrays; similarity is cosine distance
- No database query per frame — matching is pure numpy on the Jetson

### Configuration knobs (set per camera in the UI)

| Parameter | Default | Effect |
|-----------|---------|--------|
| `det_thresh` | auto | Minimum face detection confidence |
| `confidence_threshold` | 0.3 | Post-filter before sending to API |
| `face_area_threshold` | 1024 px² | Skip tiny/distant faces |
| `similarity_threshold` | 0.65 | Embedding cosine similarity for dedup |
| `match_threshold` | 0.35 | Cosine distance to declare a watchlist hit |
| `skip_frames` | 6 | Inference every Nth frame (raw stream still sends all) |
| `only_watchlist_matches` | true | Suppress faces not on any watchlist |
| `duplicate_short_window` | 30 s | Don't re-report same face within this window |
| `duplicate_long_window` | 300 s | Longer dedup window for repeated appearances |

### FRS Model

- **InsightFace** `FaceAnalysis` with modules: `detection`, `recognition`, `genderage`
- Face detection: RetinaFace or YuNet (ONNX, `face_detection_yunet_2023mar.onnx`)
- Recognition: ArcFace embedding (512-dim vector)
- Runs on Jetson CUDA via `CUDAExecutionProvider`

### FRS Enrollment

Enroll persons via the dashboard (**Crowd → FRS** page). Each person gets:
1. One or more face photos uploaded → embeddings extracted server-side
2. Stored in the `frs_persons` + `frs_embeddings` tables
3. Synced to all Jetsons on next watchlist poll (≤60 s)

---

## Other Analytics

### Crowd Analytics (`crowd-analytics/`)

- **Model**: YOLOv8s (`yolov8s.pt`) for person detection + custom head-count model (`best_head.pt`)
- **What it does**: counts people per frame, classifies density (LOW/MEDIUM/HIGH/CRITICAL), detects surges
- **Posts to**: `/api/crowd/analysis`
- Analytic code: `crowd`
- One process per camera, same orchestrator pattern as FRS

### Crowd Flow (`crowd-flow/`)

- Tracks crowd **movement direction and velocity** using optical flow + YOLO
- Posts directional vectors and flow rate
- Analytic code: `crowd-flow`

### ANPR / VCC (`ANPR-VCC_analytics/`)

- **ANPR**: Automatic Number Plate Recognition using a TensorRT engine (`Vcc_best.engine`) + stage-2 OCR model (`stage_2.pth`)
- **VCC**: Vehicle Class Classification (2-wheeler, 4-wheeler, auto, truck, bus)
- Posts detected plates and vehicle classes to `/api/violations` and `/api/vcc`
- Runs as a FastAPI service internally, proxied through the Go backend at `/api/inference/*`

---

## Live Video Feed Pipeline

Frames travel from Jetson camera process to browser **without NATS** — direct binary WebSocket fan-out:

```
Jetson camera process
    │
    │  Binary WebSocket → ws://10.10.0.250:3002/ws/publish
    │
    │  Message format:
    │    [0x01][keyLen][workerID.cameraID][JPEG bytes]   ← raw frame
    │    [0x02][keyLen][workerID.cameraID][JSON bytes]   ← detection overlay
    │
    ▼
FeedHub (Go, in-memory)
    │  PublishFrame() fans out JPEG directly to every subscribed browser WS client
    │  No NATS, no base64 — raw bytes
    ▼
Browser ← ws://…/ws/feeds
    subscribed to camera key "workerID.cameraID"
    renders JPEG blob in <img> tag at ≤25 fps
```

**FeedHub stats endpoint**: `GET /api/feeds/hub/stats` — shows which cameras are publishing and how many viewers are connected.

### WebSocket URL Resolution on Jetsons

Jetsons that use the HTTP edge gateway (`127.0.0.1:3900`) for API calls cannot use that gateway for WebSocket (it only proxies HTTP). The websocket client automatically falls back to `EDGE_SERVER_URL` (set to `http://10.10.0.250:3002` in `/etc/iris-edge/edge.env`) whenever the configured server URL is any loopback address.

---

## Jetson Fleet

| Device | WireGuard IP | Worker ID | Cameras | Analytics |
|--------|-------------|-----------|---------|-----------|
| jetson-11 | 10.10.0.11 | `wk_51b031e35d101ded` | D3, D4, D5, D6 | FRS (A-6) |
| jetson-13 | 10.10.0.13 | `wk_92597e147bf7ea97` | D7, D8, D9, D10 | Crowd |
| jetson-14 | 10.10.0.14 | `wk_50c16c4103b9c13f` | D11, D12, D13, D14 | FRS (A-6) |
| jetson-22 | 10.10.0.22 | `wk_e56d0426fa6fefdd` | D15, D16, D17, D18 | Crowd + FRS |
| jetson-150 | 10.10.0.150 | `wk_be1f712f8a40b87e` | D19, D20, D21, D22 | FRS (A-6) |

SSH access: `ssh jetson@<ip>`, password `jetson`

### Paths on each Jetson

| Path | Contents |
|------|----------|
| `/opt/iris-edge/inference-backend/` | Inference code root |
| `/etc/iris-edge/edge.env` | `WORKER_ID`, `AUTH_TOKEN`, `EDGE_SERVER_URL` |
| `/var/lib/iris-edge/state.json` | Registered worker state |
| `/var/log/iris-edge/` | Edge agent logs |
| `/opt/iris-edge/inference-backend/logs/` | Per-service inference logs |

### iris-edge service

The Jetson systemd service `iris-edge.service` runs as root and manages all inference subprocesses.

```bash
# Check status
sudo systemctl status iris-edge

# Restart (picks up all env changes)
sudo systemctl restart iris-edge

# View live logs
sudo journalctl -u iris-edge -f
```

---

## Backend Services

### Go API (`backend/`)

| Port | Bind | Purpose |
|------|------|---------|
| 3002 | 0.0.0.0 | REST API + WebSocket hub |
| 4233 | 127.0.0.1 | Embedded NATS (detection events, low-frequency) |
| 1883 | 127.0.0.1 | MQTT (Jetson heartbeats, optional) |

Key environment variables (set in `backend/.env`):

```
DATABASE_URL=postgresql://bhubaneswar_frs_user:…@localhost:5433/bhubaneswar?sslmode=disable
JWT_SECRET=…
PORT=3002           # overridden at launch to 3002
BIND_ADDR=0.0.0.0   # must be 0.0.0.0 — Jetsons connect over WireGuard
MQTT_ENABLED=1
BOOTSTRAP_ADMIN_EMAIL=admin@wiredleap.com
BOOTSTRAP_ADMIN_PASSWORD=admin123
```

### PostgreSQL

Runs in Docker on port 5433. Start with:

```bash
cd backend && docker compose up -d db
```

The `bhubaneswar` database holds all tables: devices, workers, FRS persons/embeddings, crowd analyses, violations, vehicles, watchlists.

### WireGuard VPN

The Mac is the VPN server (`utun7`, `10.10.0.250`). All Jetsons tunnel through it.

```bash
# Check active peers
sudo wg show

# Fix routing if a Jetson can't reach the backend
bash scripts/fix-wireguard-routing.sh
```

---

## Frontend

React + TypeScript + Vite, served on port 8444 in dev mode.

| Page | Route | What it shows |
|------|-------|---------------|
| Home | `/` | 3D globe, system KPIs |
| Live Cameras | `/cameras` | Multi-camera WebSocket grid grouped by Jetson |
| FRS / Crowd | `/crowd` | Face recognition events, watchlist, crowd density |
| ITMS | `/itms/*` | Violations, ANPR, vehicle watchlist, analytics |
| Map | `/map` | Device markers on map |
| Workers | `/settings/workers` | Jetson fleet status, camera assignments |
| Settings | `/settings` | User, operator audit, access control |

### API proxy (Vite dev)

```
/api/*           → http://localhost:3002  (Go backend)
/api/inference/* → http://localhost:8001  (ANPR FastAPI)
/ws/*            → http://localhost:3002  (WebSockets)
```

---

## Running Everything

### Quick start (Mac)

```bash
# 1. Start PostgreSQL (Docker)
cd backend && docker compose up -d db && cd ..

# 2. Start backend + frontend
bash scripts/start_all_services.sh

# Logs land in: runtime-logs/YYYY-MM-DD/
```

### macOS auto-start (LaunchAgent)

The backend can run automatically on login and restart on crash:

```bash
# Install (one-time)
cp scripts/com.iris.backend.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.iris.backend.plist

# Check it's loaded
launchctl list | grep iris

# View logs
tail -f runtime-logs/backend.log

# Stop
launchctl unload ~/Library/LaunchAgents/com.iris.backend.plist
```

The wrapper `scripts/iris_backend.sh` automatically rebuilds the Go binary whenever any `.go` source file changes — so restarts after code edits are seamless.

### Manual backend (without LaunchAgent)

```bash
cd backend
go build -o /tmp/iris-backend .
BIND_ADDR=0.0.0.0 PORT=3002 /tmp/iris-backend
```

---

## Jetson Management

### Camera assignments — hot reload

Edit camera assignments in the UI (**Settings → Edge Workers → Configure**) and save. Jetsons poll `/api/workers/{id}/config` every **5 seconds** and automatically:

- Start a new process for newly assigned cameras
- Stop processes for removed cameras
- Restart processes when RTSP URL, FPS, or analytics change

**No Jetson restart needed** for camera changes.

### Deploying inference code changes

```bash
# Copy updated file to all Jetsons
for ip in 10.10.0.11 10.10.0.13 10.10.0.14 10.10.0.22 10.10.0.150; do
    sshpass -p jetson scp path/to/changed_file.py \
        jetson@${ip}:/tmp/changed_file.py
    sshpass -p jetson ssh jetson@${ip} \
        "sudo cp /tmp/changed_file.py \
         /opt/iris-edge/inference-backend/frs-analytics/changed_file.py"
done

# Restart iris-edge on all Jetsons
for ip in 10.10.0.11 10.10.0.13 10.10.0.14 10.10.0.22 10.10.0.150; do
    sshpass -p jetson ssh jetson@${ip} "sudo systemctl restart iris-edge"
done
```

---

## Troubleshooting

### No live streams visible in the UI

**Check backend is listening on 0.0.0.0:3002 (not 127.0.0.1)**

```bash
lsof -nP -iTCP:3002 -sTCP:LISTEN
# Must show: *:3002 or 0.0.0.0:3002
# If it shows 127.0.0.1:3002 — kill it and restart with BIND_ADDR=0.0.0.0
```

**Check how many cameras are publishing**

```bash
curl -s http://localhost:3002/api/feeds/hub/stats | python3 -m json.tool
# "publishingNow": [...], "totalPublishers": 20
```

**Check a specific Jetson's WebSocket publisher**

```bash
sshpass -p jetson ssh jetson@10.10.0.11 \
    "grep 'Feed publisher' /opt/iris-edge/inference-backend/logs/frs.log | tail -10"
```

---

### Jetsons not streaming after restart

Usually means the WebSocket client is connecting to the HTTP-only gateway instead of the backend directly.

```bash
ssh jetson@10.10.0.11
grep "ws_url\|ws://" /opt/iris-edge/inference-backend/logs/frs.log | head
# Must show: ws://10.10.0.250:3002/ws/publish
# If it shows ws://127.0.0.1:3900 → websocket_client.py fix not deployed
```

**Re-deploy the fix:**

```bash
for ip in 10.10.0.11 10.10.0.14 10.10.0.22 10.10.0.150; do
    sshpass -p jetson scp \
        inference-backend/frs-analytics/websocket_client.py \
        jetson@${ip}:/tmp/
    sshpass -p jetson ssh jetson@${ip} \
        "sudo cp /tmp/websocket_client.py \
         /opt/iris-edge/inference-backend/frs-analytics/websocket_client.py && \
         sudo systemctl restart iris-edge"
done
```

---

### Backend deadlock / streams freeze after hours

The feedhub previously had an AB-BA lock ordering deadlock between `Run()` and `Subscribe()`. This is fixed (snapshot-before-unsubscribe, sync.Map for publishers, buffered channels). If you suspect it recurring, dump goroutines:

```bash
kill -SIGQUIT <backend-pid>
# Look for goroutines stuck in [chan send, N minutes]
```

---

### Cameras assigned but inference not starting

```bash
ssh jetson@10.10.0.11
source /etc/iris-edge/edge.env
curl -s -H "X-Auth-Token: ${AUTH_TOKEN}" \
    http://10.10.0.250:3002/api/workers/${WORKER_ID}/config | python3 -m json.tool

sudo journalctl -u iris-edge -n 50 --no-pager
```

If the API returns empty cameras — open **Settings → Edge Workers**, confirm cameras are assigned to the right worker with a valid RTSP URL and `frs` analytic enabled.

---

### FRS not detecting / no events in the dashboard

**Watchlist empty** — `only_watchlist_matches` is `true` by default; without enrolled persons, nothing is reported. Enroll at **Crowd → FRS → Add Person**.

**Faces too small or distant** — lower `face_area_threshold` and `confidence_threshold` in the camera analytic config.

**Model not loading:**

```bash
ssh jetson@10.10.0.11
sudo journalctl -u iris-edge -n 100 | grep -i "insightface\|onnx\|cuda"
```

---

### Jetson offline / SSH unreachable

```bash
sudo wg show | grep -A4 "10.10.0.11"   # latest handshake < 2 min = OK
ping -c 3 10.10.0.11
bash scripts/fix-wireguard-routing.sh   # run if no response
```

---

### Database issues

```bash
docker ps | grep postgres
psql postgresql://bhubaneswar_frs_user:GsDZFXCfj9Gb24sztopUwEr8@localhost:5433/bhubaneswar
# inside psql: \dt frs_*
cd backend && docker compose restart db
```

---

### Backend won't start (port conflict)

```bash
lsof -nP -iTCP:3002 | grep LISTEN
kill $(lsof -t -iTCP:3002)
```

---

## Extra Tools

### Jetson Diagnostic Script

Full health report — push and run from Mac:

```bash
sshpass -p jetson scp scripts/jetson_status.sh jetson@10.10.0.11:/tmp/
sshpass -p jetson ssh jetson@10.10.0.11 "bash /tmp/jetson_status.sh"
```

Reports: identity, iris-edge status, backend connectivity, assigned cameras (live API), inference processes, WebSocket log lines, live feed stats, CPU temp, RAM, disk.

### FeedHub Stats

```bash
curl -s http://localhost:3002/api/feeds/hub/stats | python3 -m json.tool
```

```json
{
  "publishingNow": ["wk_51b031.D3", "wk_51b031.D4", "..."],
  "totalPublishers": 20,
  "viewers": 3
}
```

### Useful one-liners

```bash
# Restart inference on all Jetsons
for ip in 10.10.0.11 10.10.0.13 10.10.0.14 10.10.0.22 10.10.0.150; do
    echo "=== $ip ===" && sshpass -p jetson ssh jetson@$ip "sudo systemctl restart iris-edge"
done

# Tail FRS logs on Jetson-11
sshpass -p jetson ssh jetson@10.10.0.11 \
    "tail -f /opt/iris-edge/inference-backend/logs/frs.log"

# Watch publisher count every 5 s
watch -n5 'curl -s http://localhost:3002/api/feeds/hub/stats'
```

### WireGuard Management

```bash
sudo wg show                           # peer status + handshake times
bash scripts/setup-wireguard-server.sh # initial server setup
bash scripts/fix-wireguard-routing.sh  # fix routing after Mac sleep/wake
```

---

## Project Layout

```
iris-bhubaneshwar/
├── backend/                  Go API + WebSocket hub
│   ├── handlers/             REST endpoint handlers
│   ├── services/             feedhub.go, wireguard.go, geoip.go
│   ├── models/               GORM models (FRS, devices, workers, …)
│   ├── middleware/           Auth, CSRF, operator audit
│   ├── database/             DB connection + auto-migration
│   ├── docker-compose.yml    PostgreSQL container
│   └── .env                  Secrets (not committed)
│
├── frontend/                 React + TypeScript + Vite
│   └── src/
│       ├── components/       Pages: crowd, itms, anpr, cameras, workers, …
│       ├── contexts/         Auth, theme, camera grid, layer visibility
│       └── lib/api.ts        Typed API client
│
├── inference-backend/        Python inference pipelines
│   ├── frs-analytics/        Face Recognition System (run.py)
│   ├── crowd-analytics/      Crowd density + surge (run.py)
│   ├── crowd-flow/           Crowd movement flow (run.py)
│   ├── ANPR-VCC_analytics/   Plate recognition + vehicle class (run.py)
│   ├── common/               Shared: config_manager, process_orchestrator, frame_grabber
│   └── start_all_inference.py  Starts all pipelines with GPU control + log routing
│
└── scripts/
    ├── start_all_services.sh       Start backend + frontend (Mac)
    ├── iris_backend.sh             Backend wrapper (auto-build + env)
    ├── com.iris.backend.plist      macOS LaunchAgent — auto-start on login
    ├── jetson_status.sh            Jetson health diagnostic
    ├── setup-wireguard-server.sh   WireGuard VPN setup
    └── fix-wireguard-routing.sh    Fix routing after Mac sleep/wake
```
