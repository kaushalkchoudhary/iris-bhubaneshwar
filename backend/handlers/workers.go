package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/irisdrone/backend/database"
	"github.com/irisdrone/backend/models"
	"github.com/irisdrone/backend/services"
	"gopkg.in/yaml.v3"
	"gorm.io/gorm"
)

// Helper function to generate random ID
func generateID(prefix string) string {
	bytes := make([]byte, 16)
	rand.Read(bytes)
	return prefix + "_" + hex.EncodeToString(bytes)[:16]
}

// Helper function to generate auth token
func generateAuthToken() string {
	bytes := make([]byte, 32)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

func persistTopologyConfig() {
	if err := services.PersistFRSTopologyToConfig(); err != nil {
		log.Printf("WARN: failed to persist topology config.yml: %v", err)
	}
}

type WorkerPingStatus struct {
	WorkerID  string              `json:"workerId"`
	Name      string              `json:"name"`
	IP        string              `json:"ip"`
	Status    models.WorkerStatus `json:"status"`
	LastSeen  time.Time           `json:"lastSeen"`
	Reachable bool                `json:"reachable"`
	LatencyMs int64               `json:"latencyMs"`
	Error     string              `json:"error,omitempty"`
	CheckedAt time.Time           `json:"checkedAt"`
}

type topologyFleetConfig struct {
	Jetsons []topologyFleetJetson `yaml:"jetsons"`
}

type topologyFleetJetson struct {
	ID   string `yaml:"id"`
	Name string `yaml:"name"`
	IP   string `yaml:"ip"`
}

type JetsonFleetStatus struct {
	JetsonID   string              `json:"jetsonId"`
	Name       string              `json:"name"`
	IP         string              `json:"ip"`
	Connected  bool                `json:"connected"`
	Reachable  bool                `json:"reachable"`
	Registered bool                `json:"registered"`
	WorkerID   string              `json:"workerId,omitempty"`
	Status     models.WorkerStatus `json:"status,omitempty"`
	LastSeen   *time.Time          `json:"lastSeen,omitempty"`
	LatencyMs  int64               `json:"latencyMs"`
	Error      string              `json:"error,omitempty"`
	CheckedAt  time.Time           `json:"checkedAt"`
}

func resolveFleetConfigPath() string {
	if path := strings.TrimSpace(os.Getenv("FRS_TOPOLOGY_CONFIG_PATH")); path != "" {
		return path
	}
	candidates := []string{
		filepath.Join("config", "config.yml"),
		filepath.Join("backend", "config", "config.yml"),
	}
	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return candidates[0]
}

func loadConfiguredJetsons(path string) ([]topologyFleetJetson, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cfg topologyFleetConfig
	if err := yaml.Unmarshal(raw, &cfg); err != nil {
		return nil, err
	}
	return cfg.Jetsons, nil
}

func pingWorkerIP(ip string, timeout time.Duration) (bool, int64, error) {
	cleanIP := strings.TrimSpace(ip)
	if cleanIP == "" {
		return false, 0, nil
	}

	ports := []string{"22", "3900", "8080"}
	var lastErr error
	for _, port := range ports {
		addr := net.JoinHostPort(cleanIP, port)
		start := time.Now()
		conn, err := net.DialTimeout("tcp", addr, timeout)
		if err == nil {
			_ = conn.Close()
			return true, time.Since(start).Milliseconds(), nil
		}
		lastErr = err
	}
	return false, 0, lastErr
}

// analyticsStrings extracts the analytics list from a JSONB field and always
// returns a []string (never nil/null). This prevents Python inference workers
// from receiving a JSON null and incorrectly filtering out all cameras.
func analyticsStrings(j models.JSONB) []string {
	out := []string{}
	if j.Data == nil {
		return out
	}
	switch v := j.Data.(type) {
	case []string:
		return v
	case []interface{}:
		for _, item := range v {
			if s, ok := item.(string); ok && s != "" {
				out = append(out, s)
			}
		}
	}
	return out
}

// GetJetsonFleetStatus returns online/offline status for Jetsons declared in config.yml.
// GET /api/workers/fleet-status
func GetJetsonFleetStatus(c *gin.Context) {
	cfgPath := resolveFleetConfigPath()
	jetsons, err := loadConfiguredJetsons(cfgPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":  "Failed to load Jetson fleet config",
			"detail": err.Error(),
		})
		return
	}

	if len(jetsons) == 0 {
		c.JSON(http.StatusOK, gin.H{
			"jetsons": []JetsonFleetStatus{},
			"summary": gin.H{
				"total":        0,
				"connected":    0,
				"disconnected": 0,
			},
			"configPath": cfgPath,
		})
		return
	}

	var workers []models.Worker
	if err := database.DB.Where("status <> ?", models.WorkerStatusRevoked).Find(&workers).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch workers"})
		return
	}

	workerByID := make(map[string]models.Worker, len(workers))
	workerByIP := make(map[string]models.Worker, len(workers))
	for _, w := range workers {
		if strings.TrimSpace(w.ID) != "" {
			workerByID[w.ID] = w
		}
		if strings.TrimSpace(w.IP) != "" {
			workerByIP[strings.TrimSpace(w.IP)] = w
		}
	}

	timeout := 1200 * time.Millisecond
	checkedAt := time.Now().UTC()
	out := make([]JetsonFleetStatus, len(jetsons))

	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)
	for i := range jetsons {
		i := i
		js := jetsons[i]
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			id := strings.TrimSpace(js.ID)
			name := strings.TrimSpace(js.Name)
			ip := strings.TrimSpace(js.IP)
			if name == "" {
				name = id
			}

			row := JetsonFleetStatus{
				JetsonID:  id,
				Name:      name,
				IP:        ip,
				CheckedAt: checkedAt,
			}

			worker, found := workerByID[id]
			if !found && ip != "" {
				worker, found = workerByIP[ip]
			}
			if found {
				row.Registered = true
				row.WorkerID = worker.ID
				row.Status = worker.Status
				row.LastSeen = &worker.LastSeen
			}

			reachable, latencyMs, pingErr := pingWorkerIP(ip, timeout)
			row.Reachable = reachable
			row.LatencyMs = latencyMs
			row.Connected = reachable
			if pingErr != nil {
				row.Error = pingErr.Error()
			}
			out[i] = row
		}()
	}
	wg.Wait()

	connected := 0
	for _, j := range out {
		if j.Connected {
			connected++
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"jetsons": out,
		"summary": gin.H{
			"total":        len(out),
			"connected":    connected,
			"disconnected": len(out) - connected,
		},
		"configPath": cfgPath,
	})
}

// GetWorkersPingStatus returns realtime Jetson reachability by probing known worker IPs.
// GET /api/workers/ping-status
func GetWorkersPingStatus(c *gin.Context) {
	var workers []models.Worker
	if err := database.DB.
		Where("status <> ?", models.WorkerStatusRevoked).
		Order("created_at DESC").
		Find(&workers).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch workers"})
		return
	}

	timeout := 1200 * time.Millisecond
	checkedAt := time.Now().UTC()
	out := make([]WorkerPingStatus, len(workers))

	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)
	for i := range workers {
		i := i
		worker := workers[i]
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			reachable, latencyMs, pingErr := pingWorkerIP(worker.IP, timeout)
			row := WorkerPingStatus{
				WorkerID:  worker.ID,
				Name:      worker.Name,
				IP:        worker.IP,
				Status:    worker.Status,
				LastSeen:  worker.LastSeen,
				Reachable: reachable,
				LatencyMs: latencyMs,
				CheckedAt: checkedAt,
			}
			if pingErr != nil {
				row.Error = pingErr.Error()
			}
			out[i] = row
		}()
	}
	wg.Wait()

	online := 0
	for _, w := range out {
		if w.Reachable {
			online++
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"workers": out,
		"summary": gin.H{
			"total":   len(out),
			"online":  online,
			"offline": len(out) - online,
		},
	})
}

// ==================== Worker Registration ====================

// RegisterWorkerRequest - Token-based registration
type RegisterWorkerRequest struct {
	Token      string `json:"token" binding:"required"`
	DeviceName string `json:"device_name" binding:"required"`
	IP         string `json:"ip" binding:"required"`
	MAC        string `json:"mac" binding:"required"`
	Model      string `json:"model" binding:"required"`
	Version    string `json:"version,omitempty"`
}

// RegisterWorker handles token-based worker registration
// POST /api/workers/register
func RegisterWorker(c *gin.Context) {
	var req RegisterWorkerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Find and validate token
	var token models.WorkerToken
	result := database.DB.Where("token = ? AND is_revoked = false", req.Token).First(&token)
	if result.Error != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired token"})
		return
	}

	// Check if token is already used
	if token.UsedBy != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Token has already been used"})
		return
	}

	// Check if token is expired
	if token.ExpiresAt != nil && token.ExpiresAt.Before(time.Now()) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Token has expired"})
		return
	}

	// Check if device with this MAC already exists
	var existingWorker models.Worker
	if err := database.DB.Where("mac = ?", req.MAC).First(&existingWorker).Error; err == nil {
		// Device exists - update and return
		existingWorker.Name = req.DeviceName
		existingWorker.IP = req.IP
		existingWorker.Status = models.WorkerStatusActive
		existingWorker.LastSeen = time.Now()
		if req.Version != "" {
			existingWorker.Version = &req.Version
		}
		database.DB.Save(&existingWorker)
		persistTopologyConfig()

		c.JSON(http.StatusOK, gin.H{
			"status":     "reconnected",
			"worker_id":  existingWorker.ID,
			"auth_token": existingWorker.AuthToken,
			"message":    "Worker reconnected successfully",
		})
		return
	}

	// Create new worker
	authToken := generateAuthToken()
	now := time.Now()
	worker := models.Worker{
		ID:         generateID("wk"),
		Name:       req.DeviceName,
		Status:     models.WorkerStatusApproved, // Token-based = auto-approved
		IP:         req.IP,
		MAC:        req.MAC,
		Model:      req.Model,
		AuthToken:  authToken,
		ApprovedAt: &now,
		ApprovedBy: &token.CreatedBy,
		LastSeen:   now,
		LastIP:     &req.IP,
	}
	if req.Version != "" {
		worker.Version = &req.Version
	}

	if err := database.DB.Create(&worker).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create worker"})
		return
	}

	// Mark token as used
	token.UsedBy = &worker.ID
	token.UsedAt = &now
	database.DB.Save(&token)
	persistTopologyConfig()

	c.JSON(http.StatusCreated, gin.H{
		"status":     "registered",
		"worker_id":  worker.ID,
		"auth_token": authToken,
		"message":    "Worker registered successfully",
	})
}

// RequestApprovalRequest - Tokenless registration request
type RequestApprovalRequest struct {
	DeviceName string `json:"device_name" binding:"required"`
	IP         string `json:"ip" binding:"required"`
	MAC        string `json:"mac" binding:"required"`
	Model      string `json:"model" binding:"required"`
}

// RequestApproval handles tokenless registration requests (needs admin approval)
// POST /api/workers/request-approval
func RequestApproval(c *gin.Context) {
	var req RequestApprovalRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Check if there's already a pending request for this MAC
	var existingRequest models.WorkerApprovalRequest
	if err := database.DB.Where("mac = ? AND status = 'pending'", req.MAC).First(&existingRequest).Error; err == nil {
		c.JSON(http.StatusOK, gin.H{
			"status":     "pending",
			"request_id": existingRequest.ID,
			"message":    "Approval request already pending",
		})
		return
	}

	// Check if device is already registered
	var existingWorker models.Worker
	if err := database.DB.Where("mac = ?", req.MAC).First(&existingWorker).Error; err == nil {
		if existingWorker.Status == models.WorkerStatusRevoked {
			c.JSON(http.StatusForbidden, gin.H{"error": "This device has been revoked. Contact administrator."})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"status":     "already_registered",
			"worker_id":  existingWorker.ID,
			"auth_token": existingWorker.AuthToken,
		})
		return
	}

	// Create approval request
	request := models.WorkerApprovalRequest{
		ID:         generateID("req"),
		DeviceName: req.DeviceName,
		IP:         req.IP,
		MAC:        req.MAC,
		Model:      req.Model,
		Status:     "pending",
	}

	if err := database.DB.Create(&request).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create approval request"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"status":     "pending",
		"request_id": request.ID,
		"message":    "Approval request submitted. Waiting for admin approval.",
	})
}

// CheckApprovalStatus checks the status of an approval request
// GET /api/workers/approval-status/:requestId
func CheckApprovalStatus(c *gin.Context) {
	requestID := c.Param("requestId")

	var request models.WorkerApprovalRequest
	if err := database.DB.First(&request, "id = ?", requestID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Request not found"})
		return
	}

	response := gin.H{
		"status":     request.Status,
		"request_id": request.ID,
	}

	if request.Status == "approved" && request.WorkerID != nil {
		// Fetch the worker to return auth token
		var worker models.Worker
		if err := database.DB.First(&worker, "id = ?", *request.WorkerID).Error; err == nil {
			response["worker_id"] = worker.ID
			response["auth_token"] = worker.AuthToken
		}
	} else if request.Status == "rejected" {
		response["reject_reason"] = request.RejectReason
	}

	c.JSON(http.StatusOK, response)
}

// ==================== Worker Heartbeat & Config ====================

// HeartbeatRequest - Worker heartbeat data
type HeartbeatRequest struct {
	Resources map[string]interface{} `json:"resources,omitempty"` // CPU, GPU, memory, temp
	Cameras   int                    `json:"cameras_active"`
	Analytics []string               `json:"analytics_running"`
	Events    map[string]int         `json:"events_stats,omitempty"` // Events sent stats
}

// WorkerHeartbeat handles worker heartbeat/status updates
// POST /api/workers/:id/heartbeat
func WorkerHeartbeat(c *gin.Context) {
	workerID := c.Param("id")
	authToken := c.GetHeader("X-Auth-Token")

	// Validate worker
	var worker models.Worker
	if err := database.DB.First(&worker, "id = ?", workerID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Worker not found"})
		return
	}

	// Validate auth token.
	// If the token doesn't match but the request comes from the worker's own registered IP,
	// accept the heartbeat and re-sync the token (handles token drift after DB resets or
	// Jetson re-configuration on a controlled private network).
	clientIP := c.ClientIP()
	tokenValid := worker.AuthToken == authToken
	ipMatch := strings.TrimSpace(worker.IP) != "" && strings.TrimSpace(worker.IP) == strings.TrimSpace(clientIP)

	if !tokenValid && !ipMatch {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid auth token"})
		return
	}
	if !tokenValid && ipMatch && authToken != "" {
		// Auto-sync token from trusted IP
		log.Printf("INFO: auto-syncing auth token for worker %s from IP %s", worker.ID, clientIP)
		database.DB.Model(&worker).Update("auth_token", authToken)
		worker.AuthToken = authToken
	}

	// Check if worker is revoked
	if worker.Status == models.WorkerStatusRevoked {
		c.JSON(http.StatusForbidden, gin.H{"error": "Worker has been revoked"})
		return
	}

	var req HeartbeatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Update worker status
	ip := clientIP
	worker.LastSeen = time.Now()
	worker.LastIP = &ip
	worker.Status = models.WorkerStatusActive

	if req.Resources != nil {
		worker.Resources = models.NewJSONB(req.Resources)
	}

	database.DB.Save(&worker)

	// Return current config version (for config sync)
	c.JSON(http.StatusOK, gin.H{
		"status":         "ok",
		"config_version": worker.ConfigVersion,
	})
}

// GetWorkerConfig returns the worker's configuration
// GET /api/workers/:id/config
func GetWorkerConfig(c *gin.Context) {
	workerID := c.Param("id")
	authToken := c.GetHeader("X-Auth-Token")

	// Validate worker
	var worker models.Worker
	if err := database.DB.First(&worker, "id = ?", workerID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Worker not found"})
		return
	}

	// Validate auth token (with IP-based auto-sync for trusted private-network Jetsons)
	clientIP := c.ClientIP()
	tokenValid := worker.AuthToken == authToken
	ipMatch := strings.TrimSpace(worker.IP) != "" && strings.TrimSpace(worker.IP) == strings.TrimSpace(clientIP)

	if !tokenValid && !ipMatch {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid auth token"})
		return
	}
	if !tokenValid && ipMatch && authToken != "" {
		log.Printf("INFO: auto-syncing auth token for worker %s from IP %s (config fetch)", worker.ID, clientIP)
		database.DB.Model(&worker).Update("auth_token", authToken)
		worker.AuthToken = authToken
	}

	// Get camera assignments with device details
	var assignments []models.WorkerCameraAssignment
	database.DB.Preload("Device").Where("worker_id = ? AND is_active = true", workerID).Find(&assignments)

	// Build camera config
	cameras := make([]gin.H, 0)
	for _, a := range assignments {
		if a.Device == nil {
			continue
		}
		camera := gin.H{
			"device_id":  a.DeviceID,
			"name":       a.Device.Name,
			"rtsp_url":   a.Device.RTSPUrl,
			"analytics":  analyticsStrings(a.Analytics),
			"fps":        a.FPS,
			"resolution": a.Resolution,
		}
		cameras = append(cameras, camera)
	}

	c.JSON(http.StatusOK, gin.H{
		"worker_id":      worker.ID,
		"worker_name":    worker.Name,
		"config_version": worker.ConfigVersion,
		"cameras":        cameras,
		"updated_at":     worker.UpdatedAt,
	})
}

// ==================== Worker Camera Discovery ====================

// ReportCameraRequest - Camera discovered/added by worker
type ReportCameraRequest struct {
	DeviceID string `json:"device_id"` // UUID from MagicBox - use this if provided
	Name     string `json:"name" binding:"required"`
	RTSPUrl  string `json:"rtsp_url" binding:"required"`
}

// ReportCameras handles worker reporting discovered cameras
// POST /api/workers/:id/cameras
func ReportCameras(c *gin.Context) {
	workerID := c.Param("id")
	authToken := c.GetHeader("X-Auth-Token")

	// Validate worker
	var worker models.Worker
	if err := database.DB.First(&worker, "id = ?", workerID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Worker not found"})
		return
	}

	// Validate auth token
	if worker.AuthToken != authToken {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid auth token"})
		return
	}

	var cameras []ReportCameraRequest
	if err := c.ShouldBindJSON(&cameras); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	created := 0
	updated := 0
	deviceIDs := []string{}

	for _, cam := range cameras {
		// Check if camera already exists by ID (preferred) or RTSP URL
		var existingDevice models.Device
		var err error

		if cam.DeviceID != "" {
			// Check by provided device ID first
			err = database.DB.Where("id = ?", cam.DeviceID).First(&existingDevice).Error
		}
		if err != nil || cam.DeviceID == "" {
			// Fallback: check by RTSP URL for this worker
			err = database.DB.Where("rtsp_url = ? AND worker_id = ?", cam.RTSPUrl, workerID).First(&existingDevice).Error
		}

		if err == nil {
			// Update existing
			existingDevice.Name = &cam.Name
			existingDevice.RTSPUrl = &cam.RTSPUrl
			existingDevice.WorkerID = &workerID
			database.DB.Save(&existingDevice)
			updated++
			deviceIDs = append(deviceIDs, existingDevice.ID)
		} else {
			// Create new device - use provided ID or generate one
			deviceID := cam.DeviceID
			if deviceID == "" {
				deviceID = generateID("cam") // Changed prefix from "dev" to "cam"
			}
			device := models.Device{
				ID:       deviceID,
				Type:     models.DeviceTypeCamera,
				Name:     &cam.Name,
				RTSPUrl:  &cam.RTSPUrl,
				WorkerID: &workerID,
				Status:   "discovered", // Mark as discovered, needs admin approval for analytics
				Lat:      0,
				Lng:      0,
			}
			database.DB.Create(&device)
			created++
			deviceIDs = append(deviceIDs, deviceID)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success":    true,
		"created":    created,
		"updated":    updated,
		"device_ids": deviceIDs,
	})
	persistTopologyConfig()
}

// GetWorkerDiscoveredCameras returns cameras reported by a worker
// GET /api/workers/:id/cameras
func GetWorkerDiscoveredCameras(c *gin.Context) {
	workerID := c.Param("id")
	authToken := c.GetHeader("X-Auth-Token")

	// Validate worker
	var worker models.Worker
	if err := database.DB.First(&worker, "id = ?", workerID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Worker not found"})
		return
	}

	// Validate auth token
	if worker.AuthToken != authToken {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid auth token"})
		return
	}

	// Get all devices reported by this worker
	var devices []models.Device
	database.DB.Where("worker_id = ?", workerID).Find(&devices)

	// Get assignments to know which analytics are enabled
	var assignments []models.WorkerCameraAssignment
	database.DB.Where("worker_id = ? AND is_active = true", workerID).Find(&assignments)

	// Build assignment map
	assignmentMap := make(map[string]*models.WorkerCameraAssignment)
	for i := range assignments {
		assignmentMap[assignments[i].DeviceID] = &assignments[i]
	}

	// Build response
	result := make([]gin.H, 0)
	for _, d := range devices {
		cam := gin.H{
			"device_id": d.ID,
			"name":      d.Name,
			"rtsp_url":  d.RTSPUrl,
			"status":    d.Status,
		}

		// Add analytics if assigned
		if a, ok := assignmentMap[d.ID]; ok {
			cam["analytics"] = analyticsStrings(a.Analytics)
			cam["fps"] = a.FPS
			cam["resolution"] = a.Resolution
			cam["is_active"] = a.IsActive
		}

		result = append(result, cam)
	}

	c.JSON(http.StatusOK, gin.H{
		"cameras": result,
	})
}

// DeleteWorkerCamera allows worker to remove a discovered camera
// DELETE /api/workers/:id/cameras/:deviceId
func DeleteWorkerCamera(c *gin.Context) {
	workerID := c.Param("id")
	deviceID := c.Param("deviceId")
	authToken := c.GetHeader("X-Auth-Token")

	// Validate worker
	var worker models.Worker
	if err := database.DB.First(&worker, "id = ?", workerID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Worker not found"})
		return
	}

	// Validate auth token
	if worker.AuthToken != authToken {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid auth token"})
		return
	}

	// Find and delete the device (only if it belongs to this worker)
	result := database.DB.Where("id = ? AND worker_id = ?", deviceID, workerID).Delete(&models.Device{})
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Camera not found"})
		return
	}

	// Also remove any assignments
	database.DB.Where("device_id = ? AND worker_id = ?", deviceID, workerID).Delete(&models.WorkerCameraAssignment{})
	persistTopologyConfig()

	c.JSON(http.StatusOK, gin.H{
		"success": true,
	})
}

// ==================== Admin: Worker Management ====================

// GetWorkers returns list of all workers (admin)
// GET /api/admin/workers
func GetWorkers(c *gin.Context) {
	status := c.Query("status")

	query := database.DB.Model(&models.Worker{})
	if status != "" {
		query = query.Where("status = ?", status)
	}

	var workers []models.Worker
	query.Order("created_at DESC").Find(&workers)

	// Get camera counts for each worker
	type WorkerWithCounts struct {
		models.Worker
		CameraCount int `json:"cameraCount"`
	}

	result := make([]WorkerWithCounts, len(workers))
	for i, w := range workers {
		var count int64
		database.DB.Model(&models.WorkerCameraAssignment{}).Where("worker_id = ? AND is_active = true", w.ID).Count(&count)
		result[i] = WorkerWithCounts{
			Worker:      w,
			CameraCount: int(count),
		}
	}

	c.JSON(http.StatusOK, result)
}

// GetWorker returns a single worker details (admin)
// GET /api/admin/workers/:id
func GetWorker(c *gin.Context) {
	workerID := c.Param("id")

	var worker models.Worker
	if err := database.DB.Preload("CameraAssignments").Preload("CameraAssignments.Device").First(&worker, "id = ?", workerID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Worker not found"})
		return
	}

	c.JSON(http.StatusOK, worker)
}

// UpdateWorker updates worker details (admin)
// PUT /api/admin/workers/:id
func UpdateWorker(c *gin.Context) {
	workerID := c.Param("id")

	var worker models.Worker
	if err := database.DB.First(&worker, "id = ?", workerID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Worker not found"})
		return
	}

	var req struct {
		Name   string   `json:"name"`
		IP     string   `json:"ip"`
		MAC    string   `json:"mac"`
		Model  string   `json:"model"`
		Status string   `json:"status"`
		Tags   []string `json:"tags"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Name != "" {
		worker.Name = req.Name
	}
	if req.IP != "" {
		worker.IP = req.IP
	}
	if req.MAC != "" {
		worker.MAC = req.MAC
	}
	if req.Model != "" {
		worker.Model = req.Model
	}
	if req.Status != "" {
		switch models.WorkerStatus(req.Status) {
		case models.WorkerStatusPending, models.WorkerStatusApproved, models.WorkerStatusActive, models.WorkerStatusOffline, models.WorkerStatusRevoked:
			worker.Status = models.WorkerStatus(req.Status)
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid worker status"})
			return
		}
	}
	if req.Tags != nil {
		worker.Tags = models.NewJSONB(req.Tags)
	}

	database.DB.Save(&worker)
	persistTopologyConfig()
	c.JSON(http.StatusOK, worker)
}

// RevokeWorker revokes a worker's access (admin)
// POST /api/admin/workers/:id/revoke
func RevokeWorker(c *gin.Context) {
	workerID := c.Param("id")

	var worker models.Worker
	if err := database.DB.First(&worker, "id = ?", workerID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Worker not found"})
		return
	}

	worker.Status = models.WorkerStatusRevoked
	database.DB.Save(&worker)
	persistTopologyConfig()

	c.JSON(http.StatusOK, gin.H{"message": "Worker revoked successfully"})
}

// DeleteWorker deletes a worker (admin)
// DELETE /api/admin/workers/:id
func DeleteWorker(c *gin.Context) {
	workerID := c.Param("id")

	// Delete camera assignments first
	database.DB.Where("worker_id = ?", workerID).Delete(&models.WorkerCameraAssignment{})

	// Delete worker
	result := database.DB.Delete(&models.Worker{}, "id = ?", workerID)
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Worker not found"})
		return
	}

	persistTopologyConfig()
	c.JSON(http.StatusOK, gin.H{"message": "Worker deleted successfully"})
}

// ==================== Admin: Approval Requests ====================

// GetApprovalRequests returns pending approval requests (admin)
// GET /api/admin/workers/approval-requests
func GetApprovalRequests(c *gin.Context) {
	status := c.DefaultQuery("status", "pending")

	var requests []models.WorkerApprovalRequest
	database.DB.Where("status = ?", status).Order("created_at DESC").Find(&requests)

	c.JSON(http.StatusOK, requests)
}

// ApproveWorkerRequest approves a worker request (admin)
// POST /api/admin/workers/approval-requests/:id/approve
func ApproveWorkerRequest(c *gin.Context) {
	requestID := c.Param("id")
	adminUser := c.DefaultQuery("admin_user", "admin") // TODO: Get from auth

	var request models.WorkerApprovalRequest
	if err := database.DB.First(&request, "id = ?", requestID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Request not found"})
		return
	}

	if request.Status != "pending" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Request is not pending"})
		return
	}

	// Create worker
	authToken := generateAuthToken()
	now := time.Now()
	worker := models.Worker{
		ID:         generateID("wk"),
		Name:       request.DeviceName,
		Status:     models.WorkerStatusApproved,
		IP:         request.IP,
		MAC:        request.MAC,
		Model:      request.Model,
		AuthToken:  authToken,
		ApprovedAt: &now,
		ApprovedBy: &adminUser,
		LastSeen:   now,
		LastIP:     &request.IP,
	}

	if err := database.DB.Create(&worker).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create worker"})
		return
	}

	// Update request
	request.Status = "approved"
	request.WorkerID = &worker.ID
	database.DB.Save(&request)
	persistTopologyConfig()

	c.JSON(http.StatusOK, gin.H{
		"message":   "Worker approved successfully",
		"worker_id": worker.ID,
	})
}

// RejectWorkerRequest rejects a worker request (admin)
// POST /api/admin/workers/approval-requests/:id/reject
func RejectWorkerRequest(c *gin.Context) {
	requestID := c.Param("id")
	adminUser := c.DefaultQuery("admin_user", "admin")

	var req struct {
		Reason string `json:"reason"`
	}
	c.ShouldBindJSON(&req)

	var request models.WorkerApprovalRequest
	if err := database.DB.First(&request, "id = ?", requestID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Request not found"})
		return
	}

	if request.Status != "pending" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Request is not pending"})
		return
	}

	now := time.Now()
	request.Status = "rejected"
	request.RejectedBy = &adminUser
	request.RejectedAt = &now
	request.RejectReason = &req.Reason
	database.DB.Save(&request)

	c.JSON(http.StatusOK, gin.H{"message": "Request rejected"})
}

// ==================== Admin: Camera Assignment ====================

// AssignCamerasRequest - Request body for camera assignment
type AssignCamerasRequest struct {
	Assignments []struct {
		DeviceID   string   `json:"device_id" binding:"required"`
		Analytics  []string `json:"analytics" binding:"required"`
		FPS        int      `json:"fps"`
		Resolution string   `json:"resolution"`
	} `json:"assignments" binding:"required"`
}

// AssignCameras assigns cameras to a worker (admin)
// POST /api/admin/workers/:id/cameras
func AssignCameras(c *gin.Context) {
	workerID := c.Param("id")

	var worker models.Worker
	if err := database.DB.First(&worker, "id = ?", workerID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Worker not found"})
		return
	}

	var req AssignCamerasRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Start transaction
	tx := database.DB.Begin()

	// Deactivate existing assignments
	tx.Model(&models.WorkerCameraAssignment{}).Where("worker_id = ?", workerID).Update("is_active", false)

	// Create/update assignments
	for _, a := range req.Assignments {
		// Verify device exists
		var device models.Device
		if err := tx.First(&device, "id = ?", a.DeviceID).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusBadRequest, gin.H{"error": "Device not found: " + a.DeviceID})
			return
		}

		fps := a.FPS
		if fps == 0 {
			fps = 15
		}
		resolution := a.Resolution
		if resolution == "" {
			resolution = "720p"
		}

		// Check if assignment exists
		var existing models.WorkerCameraAssignment
		err := tx.Where("worker_id = ? AND device_id = ?", workerID, a.DeviceID).First(&existing).Error

		if err == gorm.ErrRecordNotFound {
			// Create new
			assignment := models.WorkerCameraAssignment{
				WorkerID:   workerID,
				DeviceID:   a.DeviceID,
				Analytics:  models.NewJSONB(a.Analytics),
				FPS:        fps,
				Resolution: resolution,
				IsActive:   true,
			}
			tx.Create(&assignment)
		} else {
			// Update existing
			existing.Analytics = models.NewJSONB(a.Analytics)
			existing.FPS = fps
			existing.Resolution = resolution
			existing.IsActive = true
			tx.Save(&existing)
		}

		// Update device's worker_id
		tx.Model(&device).Update("worker_id", workerID)
	}

	// Increment config version
	tx.Model(&worker).Update("config_version", gorm.Expr("config_version + 1"))

	tx.Commit()
	persistTopologyConfig()

	// Return updated worker with assignments
	database.DB.Preload("CameraAssignments").Preload("CameraAssignments.Device").First(&worker, "id = ?", workerID)
	c.JSON(http.StatusOK, worker)
}

// GetWorkerCameras returns cameras assigned to a worker
// GET /api/admin/workers/:id/cameras
func GetWorkerCameras(c *gin.Context) {
	workerID := c.Param("id")

	var assignments []models.WorkerCameraAssignment
	database.DB.Preload("Device").Where("worker_id = ? AND is_active = true", workerID).Find(&assignments)

	c.JSON(http.StatusOK, assignments)
}

// UnassignCamera removes a camera from a worker
// DELETE /api/admin/workers/:id/cameras/:deviceId
func UnassignCamera(c *gin.Context) {
	workerID := c.Param("id")
	deviceID := c.Param("deviceId")

	result := database.DB.Model(&models.WorkerCameraAssignment{}).
		Where("worker_id = ? AND device_id = ?", workerID, deviceID).
		Update("is_active", false)

	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Assignment not found"})
		return
	}

	// Clear device's worker_id
	database.DB.Model(&models.Device{}).Where("id = ?", deviceID).Update("worker_id", nil)

	// Increment config version
	database.DB.Model(&models.Worker{}).Where("id = ?", workerID).Update("config_version", gorm.Expr("config_version + 1"))
	persistTopologyConfig()

	c.JSON(http.StatusOK, gin.H{"message": "Camera unassigned"})
}

// ==================== Admin: Create Worker ====================

// CreateWorker creates a new worker record directly (admin shortcut, no registration token needed).
// POST /api/admin/workers
func CreateWorker(c *gin.Context) {
	var req struct {
		Name  string `json:"name" binding:"required"`
		IP    string `json:"ip"`
		MAC   string `json:"mac"`
		Model string `json:"model"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	mac := strings.ToLower(strings.TrimSpace(req.MAC))
	if mac == "" {
		// Generate a unique placeholder MAC so the uniqueIndex constraint is satisfied.
		b := make([]byte, 6)
		rand.Read(b)
		mac = fmt.Sprintf("fe:ed:%02x:%02x:%02x:%02x", b[2], b[3], b[4], b[5])
	}

	now := time.Now()
	approvedBy := "admin"
	ip := strings.TrimSpace(req.IP)
	worker := models.Worker{
		ID:         generateID("wk"),
		Name:       strings.TrimSpace(req.Name),
		Status:     models.WorkerStatusApproved,
		IP:         ip,
		MAC:        mac,
		Model:      strings.TrimSpace(req.Model),
		AuthToken:  generateAuthToken(),
		ApprovedAt: &now,
		ApprovedBy: &approvedBy,
		LastSeen:   now,
		LastIP:     &ip,
	}

	if err := database.DB.Create(&worker).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create worker: " + err.Error()})
		return
	}

	persistTopologyConfig()
	c.JSON(http.StatusCreated, worker)
}

// ==================== Admin: Live Stats ====================

// workerLiveStat is the combined per-worker live stat returned by GetWorkerLiveStats.
type workerLiveStat struct {
	WorkerID      string              `json:"workerId"`
	Name          string              `json:"name"`
	IP            string              `json:"ip"`
	Model         string              `json:"model"`
	Status        models.WorkerStatus `json:"status"`
	LastSeen      time.Time           `json:"lastSeen"`
	LastSeenAgo   int64               `json:"lastSeenAgo"` // seconds
	Reachable     bool                `json:"reachable"`
	LatencyMs     int64               `json:"latencyMs"`
	PingError     string              `json:"pingError,omitempty"`
	CameraCount   int                 `json:"cameraCount"`
	Resources     interface{}         `json:"resources"` // from last Jetson heartbeat
	ConfigVersion int                 `json:"configVersion"`
	CheckedAt     time.Time           `json:"checkedAt"`
}

// GetWorkerLiveStats pings all workers and returns combined live status + DB resources in one call.
// GET /api/admin/workers/live-stats
func GetWorkerLiveStats(c *gin.Context) {
	var workers []models.Worker
	if err := database.DB.
		Where("status <> ?", models.WorkerStatusRevoked).
		Order("created_at ASC").
		Find(&workers).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch workers"})
		return
	}

	// Camera counts in a single query.
	type camRow struct {
		WorkerID string
		Count    int
	}
	var camRows []camRow
	database.DB.Model(&models.WorkerCameraAssignment{}).
		Select("worker_id, count(*) as count").
		Where("is_active = true").
		Group("worker_id").
		Scan(&camRows)
	camCounts := make(map[string]int, len(camRows))
	for _, r := range camRows {
		camCounts[r.WorkerID] = r.Count
	}

	timeout := 1200 * time.Millisecond
	checkedAt := time.Now().UTC()
	out := make([]workerLiveStat, len(workers))

	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)
	for i := range workers {
		i := i
		w := workers[i]
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			reachable, latencyMs, pingErr := pingWorkerIP(w.IP, timeout)
			now := time.Now().UTC()
			errStr := ""
			if pingErr != nil {
				errStr = pingErr.Error()
			}
			out[i] = workerLiveStat{
				WorkerID:      w.ID,
				Name:          w.Name,
				IP:            w.IP,
				Model:         w.Model,
				Status:        w.Status,
				LastSeen:      w.LastSeen,
				LastSeenAgo:   int64(now.Sub(w.LastSeen).Seconds()),
				Reachable:     reachable,
				LatencyMs:     latencyMs,
				PingError:     errStr,
				CameraCount:   camCounts[w.ID],
				Resources:     w.Resources.Data,
				ConfigVersion: w.ConfigVersion,
				CheckedAt:     checkedAt,
			}
		}()
	}
	wg.Wait()

	online := 0
	for _, s := range out {
		if s.Reachable {
			online++
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"workers": out,
		"summary": gin.H{
			"total":   len(out),
			"online":  online,
			"offline": len(out) - online,
		},
		"checkedAt": checkedAt,
	})
}
