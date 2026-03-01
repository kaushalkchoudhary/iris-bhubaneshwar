# IRIS Jetson Edge Package

This package makes each Jetson a managed inference node.

## What it does

- Registers Jetson to central backend (`/api/workers/register`)
- Sends worker heartbeats every 5s
- Pulls worker camera config from central backend
- Runs inference stack locally on Jetson
- Restarts inference when config version changes
- Uses worker auth headers for event publishing (`X-Worker-ID`, `X-Auth-Token`)
- Runs local Go edge gateway (`127.0.0.1:3900`) to proxy send/receive traffic

## Install on Jetson

1. Copy repo (or package tarball) to Jetson.
2. Generate a worker token from UI: `Settings -> Workers -> Tokens`.
3. Install:

```bash
cd /path/to/Iris-sringeri
sudo bash deploy/jetson/install_edge.sh
```

4. Edit env:

```bash
sudo nano /etc/iris-edge/edge.env
```

Required:
- `EDGE_SERVER_URL=http://<central-server-ip>:3002`
- `EDGE_REGISTRATION_TOKEN=<token-from-ui>`
- `EDGE_DEVICE_NAME=jetson-01`
- `EDGE_GATEWAY_URL=http://127.0.0.1:3900`

5. Start:

```bash
sudo systemctl restart iris-edge-gateway.service
sudo systemctl restart iris-edge.service
sudo journalctl -u iris-edge-gateway.service -f
sudo journalctl -u iris-edge.service -f

FRS model note:
- Jetson package now bundles InsightFace `buffalo_l` cache.
- Installer places it at `/opt/iris-edge/.insightface/models/buffalo_l`.
- `INSIGHTFACE_HOME=/opt/iris-edge/.insightface` is set in `edge.env`.
```

## Rollout for multiple Jetsons

- Repeat same install on each Jetson.
- Set unique `EDGE_DEVICE_NAME` on each node.
- Use a unique registration token per node.
- After registration, assign cameras/analytics from central UI worker modal.

## Distributed FRS mode (1 ingress + N workers)

On worker Jetsons (no camera NIC access):
```bash
sudo systemctl enable --now iris-frs-worker.service
```

On ingress Jetson (camera-connected):
```bash
sudo systemctl enable --now iris-frs-distributor.service
```

Set worker endpoints in ingress env (`/etc/iris-edge/edge.env`):
```bash
FRS_WORKER_ENDPOINTS=jetson_11=http://10.10.0.11:8008/infer,jetson_14=http://10.10.0.14:8008/infer,jetson_22=http://10.10.0.22:8008/infer,jetson_150=http://10.10.0.150:8008/infer
```
