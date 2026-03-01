// Package services provides business logic services
package services

import (
	"encoding/binary"
	"fmt"
	"log"
	"net"
	"os/exec"
	"strings"
	"sync"

	"github.com/irisdrone/backend/database"
	"github.com/irisdrone/backend/models"
)

const (
	// WireGuard server configuration
	WGInterface   = "wg0"
	WGServerIP    = "10.10.0.1"
	WGNetwork     = "10.10.0.0/16"
	WGListenPort  = 51820
	WGConfigPath  = "/etc/wireguard/wg0.conf"

	// IP allocation range for MagicBox devices
	// 10.10.0.2 - 10.10.255.254 (65533 addresses)
	IPRangeStart = "10.10.0.2"
	IPRangeEnd   = "10.10.255.254"
)

// WireGuardService manages WireGuard peers via CLI
type WireGuardService struct {
	mu              sync.Mutex
	serverPublicKey string
	serverEndpoint  string // e.g., "platform.example.com:51820"
}

// NewWireGuardService creates a new WireGuard service
func NewWireGuardService(endpoint string) *WireGuardService {
	svc := &WireGuardService{
		serverEndpoint: endpoint,
	}

	// Get server public key
	pubKey, err := svc.getServerPublicKey()
	if err != nil {
		log.Printf("⚠️ WireGuard server public key not found: %v", err)
		log.Println("   Run: sudo wg genkey | sudo tee /etc/wireguard/server_private.key | wg pubkey | sudo tee /etc/wireguard/server_public.key")
	} else {
		svc.serverPublicKey = pubKey
		log.Printf("🔐 WireGuard server public key: %s...", pubKey[:20])
	}

	return svc
}

// getServerPublicKey retrieves the server's public key
func (s *WireGuardService) getServerPublicKey() (string, error) {
	// Try to read from wg show first
	cmd := exec.Command("sudo", "wg", "show", WGInterface, "public-key")
	output, err := cmd.Output()
	if err == nil {
		return strings.TrimSpace(string(output)), nil
	}

	// Try reading from file
	cmd = exec.Command("sudo", "cat", "/etc/wireguard/server_public.key")
	output, err = cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to get server public key: %w", err)
	}
	return strings.TrimSpace(string(output)), nil
}

// GetServerPublicKey returns the server's public key
func (s *WireGuardService) GetServerPublicKey() string {
	return s.serverPublicKey
}

// GetServerEndpoint returns the server endpoint (host:port)
func (s *WireGuardService) GetServerEndpoint() string {
	return s.serverEndpoint
}

// AllocateIP assigns an unused IP to a worker
func (s *WireGuardService) AllocateIP(workerID string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Check if worker already has an IP
	var worker models.Worker
	if err := database.DB.First(&worker, "id = ?", workerID).Error; err != nil {
		return "", fmt.Errorf("worker not found: %w", err)
	}

	if worker.WireGuardIP != nil && *worker.WireGuardIP != "" {
		return *worker.WireGuardIP, nil
	}

	// Find next available IP
	nextIP, err := s.findNextAvailableIP()
	if err != nil {
		return "", err
	}

	// Save to worker
	worker.WireGuardIP = &nextIP
	if err := database.DB.Save(&worker).Error; err != nil {
		return "", fmt.Errorf("failed to save IP assignment: %w", err)
	}

	return nextIP, nil
}

// findNextAvailableIP finds the next unused IP in the range
func (s *WireGuardService) findNextAvailableIP() (string, error) {
	// Get all assigned IPs
	var workers []models.Worker
	database.DB.Where("wireguard_ip IS NOT NULL AND wireguard_ip != ''").Find(&workers)

	usedIPs := make(map[string]bool)
	for _, w := range workers {
		if w.WireGuardIP != nil {
			usedIPs[*w.WireGuardIP] = true
		}
	}

	// Start from 10.10.0.2 and find first available
	startIP := net.ParseIP(IPRangeStart).To4()
	endIP := net.ParseIP(IPRangeEnd).To4()

	start := binary.BigEndian.Uint32(startIP)
	end := binary.BigEndian.Uint32(endIP)

	for i := start; i <= end; i++ {
		ip := make(net.IP, 4)
		binary.BigEndian.PutUint32(ip, i)
		ipStr := ip.String()

		if !usedIPs[ipStr] {
			return ipStr, nil
		}
	}

	return "", fmt.Errorf("no available IPs in range")
}

// AddPeer adds a WireGuard peer using CLI
func (s *WireGuardService) AddPeer(publicKey, assignedIP string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Add peer to running config
	// wg set wg0 peer <pubkey> allowed-ips <ip>/32
	cmd := exec.Command("sudo", "wg", "set", WGInterface,
		"peer", publicKey,
		"allowed-ips", assignedIP+"/32",
	)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to add peer: %s - %w", output, err)
	}

	// Persist to config file
	if err := s.saveConfig(); err != nil {
		log.Printf("⚠️ Failed to persist WireGuard config: %v", err)
	}

	log.Printf("✅ Added WireGuard peer: %s -> %s", publicKey[:20]+"...", assignedIP)
	return nil
}

// RemovePeer removes a WireGuard peer
func (s *WireGuardService) RemovePeer(publicKey string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	cmd := exec.Command("sudo", "wg", "set", WGInterface,
		"peer", publicKey, "remove",
	)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to remove peer: %s - %w", output, err)
	}

	// Persist to config file
	if err := s.saveConfig(); err != nil {
		log.Printf("⚠️ Failed to persist WireGuard config: %v", err)
	}

	log.Printf("🗑️ Removed WireGuard peer: %s...", publicKey[:20])
	return nil
}

// saveConfig saves current WireGuard config to file
func (s *WireGuardService) saveConfig() error {
	// Use wg-quick strip to save current config
	cmd := exec.Command("bash", "-c", fmt.Sprintf(
		"sudo wg showconf %s | sudo tee %s > /dev/null",
		WGInterface, WGConfigPath,
	))
	return cmd.Run()
}

// GetPeerStatus gets status of a specific peer
func (s *WireGuardService) GetPeerStatus(publicKey string) (*PeerStatus, error) {
	cmd := exec.Command("sudo", "wg", "show", WGInterface, "dump")
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to get WireGuard status: %w", err)
	}

	// Parse dump output
	// Format: peer publickey presharedkey endpoint allowedips latesthandshake transferrx transfertx persistentkeepalive
	lines := strings.Split(string(output), "\n")
	for _, line := range lines[1:] { // Skip header
		fields := strings.Fields(line)
		if len(fields) < 8 {
			continue
		}

		if fields[0] == publicKey {
			return &PeerStatus{
				PublicKey:     fields[0],
				Endpoint:      fields[2],
				AllowedIPs:    fields[3],
				LastHandshake: fields[4],
				TransferRx:    fields[5],
				TransferTx:    fields[6],
			}, nil
		}
	}

	return nil, fmt.Errorf("peer not found")
}

// GetAllPeersStatus returns status of all peers
func (s *WireGuardService) GetAllPeersStatus() ([]PeerStatus, error) {
	cmd := exec.Command("sudo", "wg", "show", WGInterface, "dump")
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to get WireGuard status: %w", err)
	}

	var peers []PeerStatus
	lines := strings.Split(string(output), "\n")
	for _, line := range lines[1:] { // Skip header (interface line)
		fields := strings.Fields(line)
		if len(fields) < 8 {
			continue
		}

		peers = append(peers, PeerStatus{
			PublicKey:     fields[0],
			Endpoint:      fields[2],
			AllowedIPs:    fields[3],
			LastHandshake: fields[4],
			TransferRx:    fields[5],
			TransferTx:    fields[6],
		})
	}

	return peers, nil
}

// IsServerRunning checks if WireGuard server is running
func (s *WireGuardService) IsServerRunning() bool {
	cmd := exec.Command("sudo", "wg", "show", WGInterface)
	return cmd.Run() == nil
}

// PeerStatus represents WireGuard peer status
type PeerStatus struct {
	PublicKey     string `json:"public_key"`
	Endpoint      string `json:"endpoint"`
	AllowedIPs    string `json:"allowed_ips"`
	LastHandshake string `json:"last_handshake"`
	TransferRx    string `json:"transfer_rx"`
	TransferTx    string `json:"transfer_tx"`
}

// RegisterWorkerRequest for WireGuard setup
type WireGuardSetupRequest struct {
	WorkerID      string `json:"worker_id"`
	PublicKey     string `json:"public_key"`
}

// RegisterWorkerResponse for WireGuard setup
type WireGuardSetupResponse struct {
	AssignedIP     string `json:"assigned_ip"`
	ServerPubKey   string `json:"server_pubkey"`
	ServerEndpoint string `json:"server_endpoint"`
	ServerIP       string `json:"server_ip"`
}

// SetupWorkerWireGuard handles WireGuard setup for a worker
func (s *WireGuardService) SetupWorkerWireGuard(workerID, publicKey string) (*WireGuardSetupResponse, error) {
	// Allocate IP
	ip, err := s.AllocateIP(workerID)
	if err != nil {
		return nil, err
	}

	// Add peer to WireGuard server
	if err := s.AddPeer(publicKey, ip); err != nil {
		return nil, err
	}

	// Update worker record with public key
	var worker models.Worker
	if err := database.DB.First(&worker, "id = ?", workerID).Error; err != nil {
		return nil, err
	}
	worker.WireGuardPubKey = &publicKey
	database.DB.Save(&worker)

	return &WireGuardSetupResponse{
		AssignedIP:     ip + "/24",
		ServerPubKey:   s.serverPublicKey,
		ServerEndpoint: s.serverEndpoint,
		ServerIP:       WGServerIP,
	}, nil
}

