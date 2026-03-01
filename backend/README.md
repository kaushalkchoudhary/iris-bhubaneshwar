# IrisDrone Backend (Go)

This is the Go backend for the IrisDrone project, converted from the Node.js/TypeScript server.

## Features

- RESTful API endpoints for devices, crowd analysis, alerts, and workers
- PostgreSQL database using GORM
- CORS enabled
- Static file serving for heatmaps
- Health check endpoint

## Prerequisites

- Go 1.21 or higher
- PostgreSQL database (same as Node.js server)
- Environment variables configured

## Setup

1. Install dependencies:
```bash
go mod download
```

2. Create a `.env` file (copy from `.env.example`):
```bash
cp .env.example .env
```

3. Update `.env` with your database connection string:
```
DATABASE_URL=postgresql://<db_user>:<strong_db_password>@localhost:5432/irisdrone?sslmode=disable
PORT=3001
ENV=development
JWT_SECRET=<strong_random_secret>
WASENDER_API_TOKEN=<wasender_token>
```

4. Run the server:
```bash
go run main.go
```

Or build and run:
```bash
go build -o backend
./backend
```

## API Endpoints

All endpoints match the Node.js server:

### Devices
- `GET /api/devices` - List all devices
- `GET /api/devices/:id/latest` - Get latest event for a device
- `GET /api/devices/analytics/surges` - Get devices with high risk level

### Ingest
- `POST /api/ingest` - Receive raw event data

### Workers
- `GET /api/workers/config` - Get active devices and their analytics config
- `POST /api/workers/heartbeat` - Worker check-in

### Crowd
- `POST /api/crowd/analysis` - Ingest real-time crowd analysis data
- `GET /api/crowd/analysis` - Get crowd analysis data
- `GET /api/crowd/analysis/latest` - Get latest analysis for devices
- `POST /api/crowd/alerts` - Create a crowd alert
- `GET /api/crowd/alerts` - Get crowd alerts
- `PATCH /api/crowd/alerts/:id/resolve` - Resolve an alert
- `GET /api/crowd/hotspots` - Get current hotspots for map visualization

### Health
- `GET /health` - Health check endpoint

## Database

The backend uses GORM for database operations. The models are automatically migrated on startup. The database schema matches the Prisma schema from the Node.js server.

## Differences from Node.js Server

- Uses GORM instead of Prisma (Prisma Go is less mature)
- Uses Gin framework instead of Express/Fastify
- JSONB fields are handled using a custom JSONB type
- BigInt IDs are handled as int64 (GORM limitation)
- Static file serving for heatmaps is implemented using Gin's static file handler

## Development

The server will automatically connect to the database and run migrations on startup. Make sure your PostgreSQL database is running and accessible.

## FRS Topology Config (5 Jetsons / 20 Cameras)

You can auto-sync Jetsons and camera RTSP devices into the backend DB on startup:

1. Copy the template:
```bash
cp backend/config/frs_topology.example.yaml backend/config/frs_topology.yaml
```

2. Replace `rtsp_url`, IP, MAC, and zone/location values.

3. Start backend with:
```bash
export FRS_TOPOLOGY_CONFIG_PATH=backend/config/frs_topology.yaml
```

On startup, the backend will upsert workers/devices from that YAML, so:
- `/api/analytics/worker-configs` exposes FRS cameras for inference
- `/api/devices` shows the same cameras in UI

For per-Jetson inference filtering, set this on each Jetson before starting `frs-analytics`:
```bash
export IRIS_JETSON_ID=jetson_1
```
Use `jetson_2`, `jetson_3`, etc on the other nodes. Each node will then consume only its assigned cameras from backend config.

## Jetson Edge Package (Recommended)

Use the edge package to run inference only on Jetsons while this server stays control-plane only (UI + API + DB):

1. Build package on control-plane host:
```bash
./scripts/build_jetson_package.sh
```

2. On each Jetson:
```bash
tar -xzf iris-edge-node-<timestamp>.tar.gz
cd Iris-sringeri
sudo bash deploy/jetson/install_edge.sh
sudo nano /etc/iris-edge/edge.env
sudo systemctl restart iris-edge.service
```

3. In `/etc/iris-edge/edge.env`, set:
- `EDGE_SERVER_URL=http://<control-plane-ip>:3002`
- `EDGE_REGISTRATION_TOKEN=<token from UI Settings -> Workers -> Tokens>`
- `EDGE_DEVICE_NAME=<unique jetson name>`

The edge agent will auto-register, send heartbeats, pull camera assignments, and run inference locally on the Jetson.

## MQTT FRS Ingest

Set these env vars on backend to ingest FRS events/heartbeats from MQTT:

```bash
export MQTT_ENABLED=true
export MQTT_BROKER_URL=tcp://127.0.0.1:1883
export MQTT_EVENTS_TOPIC=iris/events/+
export MQTT_HEARTBEAT_TOPIC=iris/heartbeat/+
```

Optional auth:

```bash
export MQTT_USERNAME=<user>
export MQTT_PASSWORD=<pass>
```

FRS events are stored in `frs_detections` and embeddings are written to pgvector table `embeddings`.
