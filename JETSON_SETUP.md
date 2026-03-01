# Jetson Setup Commands (IRIS Distributed Inference)

This runbook sets up all Jetsons for inference with your Mac as control-plane only.

- Mac runs: UI + Go backend + DB
- Jetsons run: edge gateway + edge agent + inference

---

## 0) Prereqs

- Jetson IPs:
  - `10.10.0.11`
  - `10.10.0.13`
  - `10.10.0.14`
  - `10.10.0.22`
  - `10.10.0.150`
- SSH user/password: `jetson` / `jetson`
- On Mac, repo path: `~/Desktop/Iris-sringeri`

---

## 1) Start control-plane on Mac

```bash
cd ~/Desktop/Iris-sringeri
./scripts/start_all_services.sh
```

Confirm backend is up:

```bash
tail -n 80 runtime-logs/$(date +%F)/go-backend.log
```

---

## 2) Build edge package on Mac

```bash
cd ~/Desktop/Iris-sringeri
./scripts/build_jetson_package.sh
ls -1t dist/iris-edge-node-*.tar.gz | head -n 1
```

Save the latest package path:

```bash
PKG="$(ls -1t ~/Desktop/Iris-sringeri/dist/iris-edge-node-*.tar.gz | head -n 1)"
echo "$PKG"
```

---

## 3) Copy package to all Jetsons (resumable, macOS-safe)

Use the retry/resume helper (recommended for unstable Wi-Fi):

```bash
cd ~/Desktop/Iris-sringeri
./scripts/push_jetson_package.sh "$PKG"
```

Manual fallback (for old macOS rsync/openrsync):

```bash
for ip in 10.10.0.11 10.10.0.13 10.10.0.14 10.10.0.22 10.10.0.150; do
  rsync -avP --partial --append --inplace \
    -e "ssh -c aes128-ctr -o Compression=no -o ServerAliveInterval=15 -o ServerAliveCountMax=10" \
    "$PKG" "jetson@$ip:/home/jetson/"
done
```

If a node disconnects, rerun the same loop; transfer resumes.

---

## 4) Install on each Jetson

```bash
for ip in 10.10.0.11 10.10.0.13 10.10.0.14 10.10.0.22 10.10.0.150; do
  ssh jetson@"$ip" '
    set -e
    cd /home/jetson
    rm -rf Iris-sringeri
    mkdir -p Iris-sringeri
    tar -xzf iris-edge-node-*.tar.gz -C Iris-sringeri
    cd Iris-sringeri
    sudo bash deploy/jetson/install_edge.sh
  '
done
```

---

## 5) Create worker tokens in UI

On Mac UI:
- `Settings -> Workers -> Tokens`
- Create 5 tokens (recommended one per Jetson)

Keep them ready:
- `TOKEN_11`
- `TOKEN_13`
- `TOKEN_14`
- `TOKEN_22`
- `TOKEN_150`

---

## 6) Configure `/etc/iris-edge/edge.env` on each Jetson

Find your Mac LAN IP:

```bash
ipconfig getifaddr en0
```

Assume Mac IP is `<MAC_IP>` and set env files:

```bash
ssh jetson@10.10.0.11 "sudo tee /etc/iris-edge/edge.env >/dev/null <<'EOF'
EDGE_SERVER_URL=http://<MAC_IP>:3002
EDGE_GATEWAY_BIND=127.0.0.1:3900
EDGE_GATEWAY_URL=http://127.0.0.1:3900
EDGE_REGISTRATION_TOKEN=<TOKEN_11>
EDGE_DEVICE_NAME=jetson-11
EDGE_DEVICE_IP=10.10.0.11
EDGE_DEVICE_MODEL=Jetson Orin Nano
INFERENCE_STRICT_API_CONFIG=1
FRS_FORCE_API=1
EDGE_ENABLE_ANPR=1
EDGE_ENABLE_CROWD=1
EDGE_ENABLE_CROWD_FLOW=1
EDGE_ENABLE_FRS=1
EOF"
```

```bash
ssh jetson@10.10.0.13 "sudo tee /etc/iris-edge/edge.env >/dev/null <<'EOF'
EDGE_SERVER_URL=http://<MAC_IP>:3002
EDGE_GATEWAY_BIND=127.0.0.1:3900
EDGE_GATEWAY_URL=http://127.0.0.1:3900
EDGE_REGISTRATION_TOKEN=<TOKEN_13>
EDGE_DEVICE_NAME=jetson-13
EDGE_DEVICE_IP=10.10.0.13
EDGE_DEVICE_MODEL=Jetson Orin Nano
INFERENCE_STRICT_API_CONFIG=1
FRS_FORCE_API=1
EDGE_ENABLE_ANPR=1
EDGE_ENABLE_CROWD=1
EDGE_ENABLE_CROWD_FLOW=1
EDGE_ENABLE_FRS=1
EOF"
```

```bash
ssh jetson@10.10.0.14 "sudo tee /etc/iris-edge/edge.env >/dev/null <<'EOF'
EDGE_SERVER_URL=http://<MAC_IP>:3002
EDGE_GATEWAY_BIND=127.0.0.1:3900
EDGE_GATEWAY_URL=http://127.0.0.1:3900
EDGE_REGISTRATION_TOKEN=<TOKEN_14>
EDGE_DEVICE_NAME=jetson-14
EDGE_DEVICE_IP=10.10.0.14
EDGE_DEVICE_MODEL=Jetson Orin Nano
INFERENCE_STRICT_API_CONFIG=1
FRS_FORCE_API=1
EDGE_ENABLE_ANPR=1
EDGE_ENABLE_CROWD=1
EDGE_ENABLE_CROWD_FLOW=1
EDGE_ENABLE_FRS=1
EOF"
```

```bash
ssh jetson@10.10.0.22 "sudo tee /etc/iris-edge/edge.env >/dev/null <<'EOF'
EDGE_SERVER_URL=http://<MAC_IP>:3002
EDGE_GATEWAY_BIND=127.0.0.1:3900
EDGE_GATEWAY_URL=http://127.0.0.1:3900
EDGE_REGISTRATION_TOKEN=<TOKEN_22>
EDGE_DEVICE_NAME=jetson-22
EDGE_DEVICE_IP=10.10.0.22
EDGE_DEVICE_MODEL=Jetson Orin Nano
INFERENCE_STRICT_API_CONFIG=1
FRS_FORCE_API=1
EDGE_ENABLE_ANPR=1
EDGE_ENABLE_CROWD=1
EDGE_ENABLE_CROWD_FLOW=1
EDGE_ENABLE_FRS=1
EOF"
```

```bash
ssh jetson@10.10.0.150 "sudo tee /etc/iris-edge/edge.env >/dev/null <<'EOF'
EDGE_SERVER_URL=http://<MAC_IP>:3002
EDGE_GATEWAY_BIND=127.0.0.1:3900
EDGE_GATEWAY_URL=http://127.0.0.1:3900
EDGE_REGISTRATION_TOKEN=<TOKEN_150>
EDGE_DEVICE_NAME=jetson-150
EDGE_DEVICE_IP=10.10.0.150
EDGE_DEVICE_MODEL=Jetson Orin Nano
INFERENCE_STRICT_API_CONFIG=1
FRS_FORCE_API=1
EDGE_ENABLE_ANPR=1
EDGE_ENABLE_CROWD=1
EDGE_ENABLE_CROWD_FLOW=1
EDGE_ENABLE_FRS=1
EOF"
```

---

## 7) Start services on all Jetsons

```bash
for ip in 10.10.0.11 10.10.0.13 10.10.0.14 10.10.0.22 10.10.0.150; do
  ssh jetson@"$ip" '
    sudo systemctl daemon-reload
    sudo systemctl enable iris-edge-gateway.service iris-edge.service
    sudo systemctl restart iris-edge-gateway.service iris-edge.service
  '
done
```

---

## 8) Verify Jetson services

```bash
for ip in 10.10.0.11 10.10.0.13 10.10.0.14 10.10.0.22 10.10.0.150; do
  echo "===== $ip ====="
  ssh jetson@"$ip" '
    systemctl --no-pager --full status iris-edge-gateway.service | sed -n "1,8p"
    systemctl --no-pager --full status iris-edge.service | sed -n "1,8p"
  '
done
```

Live logs for one node:

```bash
ssh jetson@10.10.0.11 'sudo journalctl -u iris-edge.service -f'
```

---

## 9) Assign cameras from Mac UI

- Open: `Settings -> Workers`
- For each Jetson, click `Configure`
- Assign cameras and analytics (`frs`, `anpr_vcc`, `crowd`, `crowd-flow`)
- Save

Jetsons will auto-pull config and restart inference when `config_version` changes.

---

## 10) Troubleshooting

- If worker not visible in UI:
  - check backend log: `runtime-logs/<date>/go-backend.log`
  - check Jetson agent log: `journalctl -u iris-edge.service -n 100`
- If API calls fail from Jetson:
  - ping Mac IP from Jetson
  - verify `EDGE_SERVER_URL` in `/etc/iris-edge/edge.env`
- If services fail after env changes:
  - `sudo systemctl daemon-reload && sudo systemctl restart iris-edge-gateway.service iris-edge.service`
