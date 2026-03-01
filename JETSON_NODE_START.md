# Jetson Node Start Commands

Use this after package installation is complete on each Jetson.

## 1) Start node services on one Jetson

Run directly on that Jetson:

```bash
sudo systemctl daemon-reload
sudo systemctl enable iris-edge-gateway.service iris-edge.service
sudo systemctl restart iris-edge-gateway.service iris-edge.service
```

## 2) Check service status on one Jetson

```bash
systemctl --no-pager --full status iris-edge-gateway.service | head -n 20
systemctl --no-pager --full status iris-edge.service | head -n 20
```

## 3) View logs on one Jetson

```bash
sudo journalctl -u iris-edge-gateway.service -n 100 --no-pager
sudo journalctl -u iris-edge.service -n 100 --no-pager
```

Live tail:

```bash
sudo journalctl -u iris-edge.service -f
```

## 4) Restart all 5 Jetsons from Mac

Run on your Mac:

```bash
for ip in 10.10.0.11 10.10.0.13 10.10.0.14 10.10.0.22 10.10.0.150; do
  echo "==== $ip ===="
  ssh jetson@"$ip" '
    sudo systemctl daemon-reload
    sudo systemctl enable iris-edge-gateway.service iris-edge.service
    sudo systemctl restart iris-edge-gateway.service iris-edge.service
    systemctl --no-pager --full status iris-edge-gateway.service | head -n 8
    systemctl --no-pager --full status iris-edge.service | head -n 8
  '
done
```

## 5) Stop services (if needed)

```bash
sudo systemctl stop iris-edge.service iris-edge-gateway.service
```

## 6) Required config file check

Each Jetson must have:

```bash
sudo cat /etc/iris-edge/edge.env
```

Minimum required keys:

- `EDGE_SERVER_URL=http://<MAC_IP>:3002`
- `EDGE_REGISTRATION_TOKEN=<token>`
- `EDGE_DEVICE_NAME=<unique-name>`
- `EDGE_DEVICE_IP=<jetson-ip>`
- `INSIGHTFACE_HOME=/opt/iris-edge/.insightface`

