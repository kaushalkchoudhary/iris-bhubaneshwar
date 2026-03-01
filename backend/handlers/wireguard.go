package handlers

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/irisdrone/backend/services"
)

var wgService *services.WireGuardService

// InitWireGuard initializes the WireGuard service
func InitWireGuard(endpoint string) {
	wgService = services.NewWireGuardService(endpoint)
}

// WireGuardSetupRequest from MagicBox
type WireGuardSetupRequest struct {
	WorkerID  string `json:"worker_id" binding:"required"`
	PublicKey string `json:"public_key" binding:"required"`
}

// SetupWireGuard handles WireGuard setup for a worker
// POST /api/workers/:id/wireguard/setup
func SetupWireGuard(c *gin.Context) {
	workerID := c.Param("id")

	var req WireGuardSetupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Verify worker ID matches
	if req.WorkerID != workerID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Worker ID mismatch"})
		return
	}

	// Setup WireGuard for worker
	resp, err := wgService.SetupWorkerWireGuard(workerID, req.PublicKey)
	if err != nil {
		log.Printf("❌ [WIREGUARD] setup failed (worker_id=%s): %v", workerID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":    "ok",
		"wireguard": resp,
	})
}

// GetWireGuardStatus returns WireGuard server status
// GET /api/admin/wireguard/status
func GetWireGuardStatus(c *gin.Context) {
	if wgService == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "WireGuard service not initialized"})
		return
	}

	running := wgService.IsServerRunning()
	pubKey := wgService.GetServerPublicKey()
	endpoint := wgService.GetServerEndpoint()

	peers, _ := wgService.GetAllPeersStatus()

	c.JSON(http.StatusOK, gin.H{
		"running":    running,
		"public_key": pubKey,
		"endpoint":   endpoint,
		"server_ip":  services.WGServerIP,
		"network":    services.WGNetwork,
		"peers":      peers,
		"peer_count": len(peers),
	})
}

// RemoveWireGuardPeer removes a WireGuard peer
// DELETE /api/admin/wireguard/peers/:pubkey
func RemoveWireGuardPeer(c *gin.Context) {
	pubKey := c.Param("pubkey")

	if err := wgService.RemovePeer(pubKey); err != nil {
		log.Printf("❌ [WIREGUARD] remove peer failed (pubkey=%s): %v", pubKey, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}
