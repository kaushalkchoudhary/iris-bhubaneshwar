#!/bin/bash
# Fix WireGuard routing issues on MagicNetwork server

set -e

echo "🔧 Fixing WireGuard routing on MagicNetwork server..."

# 1. Enable IP forwarding
echo "1. Enabling IP forwarding..."
echo "net.ipv4.ip_forward = 1" | sudo tee /etc/sysctl.d/99-wireguard.conf
sudo sysctl -w net.ipv4.ip_forward=1
sudo sysctl -p /etc/sysctl.d/99-wireguard.conf

# 2. Check if WireGuard interface is up
echo ""
echo "2. Checking WireGuard interface..."
if ip link show wg0 > /dev/null 2>&1; then
    echo "✅ WireGuard interface wg0 is up"
    
    # Show current peers
    echo ""
    echo "Current WireGuard peers:"
    sudo wg show wg0
    
    # Check if peers are in config file
    echo ""
    echo "Peers in config file:"
    if [ -f /etc/wireguard/wg0.conf ]; then
        grep -A 3 "\[Peer\]" /etc/wireguard/wg0.conf || echo "⚠️ No peers found in config file"
    else
        echo "⚠️ Config file not found"
    fi
else
    echo "❌ WireGuard interface wg0 is not up"
    echo "   Start it with: sudo wg-quick up wg0"
fi

# 3. Check firewall rules (if ufw is installed)
echo ""
echo "3. Checking firewall..."
if command -v ufw > /dev/null 2>&1; then
    echo "UFW status:"
    sudo ufw status | grep -E "(51820|Status)" || echo "UFW not active"
    echo ""
    echo "To allow WireGuard traffic:"
    echo "  sudo ufw allow 51820/udp"
    echo "  sudo ufw allow from 10.10.0.0/24"
fi

# 4. Check iptables rules
echo ""
echo "4. Checking iptables NAT rules..."
if sudo iptables -t nat -L -n | grep -q "10.10.0"; then
    echo "✅ NAT rules found"
    sudo iptables -t nat -L -n | grep "10.10.0"
else
    echo "⚠️ No NAT rules found for 10.10.0.0/24"
    echo ""
    echo "To add NAT rules (if needed for internet access):"
    echo "  sudo iptables -t nat -A POSTROUTING -s 10.10.0.0/24 -o eth0 -j MASQUERADE"
    echo "  sudo iptables -A FORWARD -i wg0 -j ACCEPT"
    echo "  sudo iptables -A FORWARD -o wg0 -j ACCEPT"
fi

# 5. Test connectivity
echo ""
echo "5. Testing connectivity..."
if ip link show wg0 > /dev/null 2>&1; then
    SERVER_IP=$(ip -4 addr show wg0 | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -1)
    echo "Server WireGuard IP: $SERVER_IP"
    
    # Try to ping a peer if configured
    PEER_IP=$(sudo wg show wg0 allowed-ips | grep -oP '10\.10\.0\.\d+' | head -1)
    if [ -n "$PEER_IP" ] && [ "$PEER_IP" != "$SERVER_IP" ]; then
        echo "Testing ping to peer: $PEER_IP"
        if ping -c 2 -W 2 "$PEER_IP" > /dev/null 2>&1; then
            echo "✅ Can ping $PEER_IP"
        else
            echo "❌ Cannot ping $PEER_IP"
            echo ""
            echo "Troubleshooting steps:"
            echo "1. Check if peer is actually connected: sudo wg show wg0"
            echo "2. Check if IP forwarding is enabled: sysctl net.ipv4.ip_forward"
            echo "3. Check firewall rules"
            echo "4. Verify peer config on MagicBox node"
        fi
    else
        echo "⚠️ No peer IP found to test"
    fi
fi

echo ""
echo "✅ Done! If issues persist, check:"
echo "  - sudo wg show wg0 (verify peers are connected)"
echo "  - sysctl net.ipv4.ip_forward (should be 1)"
echo "  - sudo iptables -L -n (check firewall rules)"
echo "  - /etc/wireguard/wg0.conf (verify peer config)"

