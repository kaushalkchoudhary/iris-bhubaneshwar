# Distributed FRS Services

This directory provides a distributed FRS execution model for Jetson clusters.

## Components

- `worker_service.py`
  - Runs on inference Jetsons.
  - Exposes `POST /infer` to process frames and return face detections + embeddings.
- `distributor_service.py`
  - Runs on the single camera-connected ingress Jetson.
  - Pulls distributed plan from control-plane (`/api/frs/distributed/plan`).
  - Reads all RTSP streams, dispatches frames to worker services, and publishes events.

## Worker Jetson

```bash
cd inference-backend/frs-distributed
python3 worker_service.py
```

Env:
- `FRS_WORKER_HOST` (default `0.0.0.0`)
- `FRS_WORKER_PORT` (default `8008`)
- `FRS_MODEL_NAME` (default `buffalo_l`)
- `FRS_CTX_ID` (default `0`)
- `FRS_DET_SIZE` (default `640,640`)

## Ingress Jetson

```bash
cd inference-backend/frs-distributed
python3 distributor_service.py
```

Required env:
- `EDGE_GATEWAY_URL=http://127.0.0.1:3900`
- `FRS_WORKER_ENDPOINTS=jetson_11=http://10.10.0.11:8008/infer,jetson_14=http://10.10.0.14:8008/infer,...`

Optional env:
- `FRS_DISTRIBUTED_PLAN_URL`
- `FRS_DISTRIBUTED_HEARTBEAT_URL`
- `FRS_EVENTS_INGEST_URL`
- `FRS_DISTRIBUTED_FPS` (default 4)
- `FRS_DISTRIBUTED_JPEG_QUALITY` (default 75)

## Control-plane endpoints (Go backend)

- `GET /api/frs/distributed/plan`
- `POST /api/frs/distributed/heartbeat`
- `GET /api/frs/distributed/nodes`

