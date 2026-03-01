#!/bin/bash
# ========================================
# WireGuard Server Setup for IRIS Platform
# ========================================
# Run this script with sudo on the platform server

set -e

echo "🔐 Setting up WireGuard server..."

# 1. Install WireGuard
echo "📦 Installing WireGuard..."
apt update
apt install -y wireguard wireguard-tools

# 2. Create directories
mkdir -p /etc/wireguard/keys
chmod 700 /etc/wireguard

# 3. Generate server keys (if not exist)
if [ ! -f /etc/wireguard/keys/server_private.key ]; then
    echo "🔑 Generating server keys..."
    wg genkey | tee /etc/wireguard/keys/server_private.key | wg pubkey > /etc/wireguard/keys/server_public.key
    chmod 600 /etc/wireguard/keys/server_private.key
else
    echo "✅ Server keys already exist"
fi

SERVER_PRIVATE_KEY=$(cat /etc/wireguard/keys/server_private.key)
SERVER_PUBLIC_KEY=$(cat /etc/wireguard/keys/server_public.key)

# 4. Create server config (if not exist)
if [ ! -f /etc/wireguard/wg0.conf ]; then
    echo "📝 Creating WireGuard config..."
    cat > /etc/wireguard/wg0.conf << EOF
[Interface]
PrivateKey = ${SERVER_PRIVATE_KEY}
Address = 10.10.0.1/24
ListenPort = 51820
SaveConfig = true

# Peers will be added dynamically by the IRIS backend
EOF
    chmod 600 /etc/wireguard/wg0.conf
else
    echo "✅ WireGuard config already exists"
fi

# 5. Enable IP forwarding (for routing between clients)
echo "🌐 Enabling IP forwarding..."
echo "net.ipv4.ip_forward = 1" > /etc/sysctl.d/99-wireguard.conf
sysctl -p /etc/sysctl.d/99-wireguard.conf

# 6. Start WireGuard
echo "⚡ Starting WireGuard..."
if ip link show wg0 &>/dev/null; then
    echo "✅ WireGuard interface already up"
else
    wg-quick up wg0
fi

# 7. Enable on boot
systemctl enable wg-quick@wg0

# 8. Display status
echo ""
echo "========================================="
echo "✅ WireGuard Server Setup Complete!"
echo "========================================="
echo ""
echo "Server Public Key: ${SERVER_PUBLIC_KEY}"
echo "Server IP: 10.10.0.1"
echo "Listen Port: 51820"
echo ""
echo "Interface status:"
wg show wg0
echo ""
echo "⚠️  Make sure port 51820/UDP is open in your firewall!"
echo ""
echo "Set this environment variable in your backend:"
echo "  export WIREGUARD_ENDPOINT=\"your-server-ip:51820\""

