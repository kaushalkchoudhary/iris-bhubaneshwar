package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/irisdrone/backend/database"
	"github.com/irisdrone/backend/models"
	"github.com/irisdrone/backend/services"
	"gorm.io/gorm"
)

const onlineThreshold = 5 * time.Minute

func setDeviceIsOnline(d *models.Device) {
	d.IsOnline = d.LastSeen != nil && d.LastSeen.After(time.Now().UTC().Add(-onlineThreshold))
}

const rolling24hMinutes = 24 * 60 // 1440

// setDeviceUptimePercent sets UptimePercent from device_heartbeats in the last 24h.
// Rolling 24h: every minute in that window must have at least one heartbeat to count as "up".
// Minutes with no event count as downtime. Formula: (minutes with ≥1 heartbeat) / 1440 * 100.
func setDeviceUptimePercent(d *models.Device) {
	since := time.Now().UTC().Add(-24 * time.Hour)
	var upMinutes int64
	database.DB.Raw(
		"SELECT COUNT(DISTINCT date_trunc('minute', timestamp)) FROM device_heartbeats WHERE device_id = ? AND timestamp >= ?",
		d.ID, since,
	).Scan(&upMinutes)
	p := 100 * float64(upMinutes) / float64(rolling24hMinutes)
	d.UptimePercent = &p
}

// GetDevices handles GET /api/devices
func GetDevices(c *gin.Context) {
	var devices []models.Device
	query := database.DB

	// Filter by type
	if deviceType := c.Query("type"); deviceType != "" {
		query = query.Where("type = ?", deviceType)
	}

	// Filter by zone
	if zoneID := c.Query("zone"); zoneID != "" {
		query = query.Where("zone_id = ?", zoneID)
	}

	// Minimal mode - return only essential fields
	if minimal := c.Query("minimal"); minimal == "true" {
		var minimalDevices []struct {
			ID           string     `json:"id"`
			Name         *string    `json:"name"`
			Type         string     `json:"type"`
			Lat          float64    `json:"lat"`
			Lng          float64    `json:"lng"`
			Status       string     `json:"status"`
			LastSeen     *time.Time `json:"lastSeen,omitempty"`
			CameraStatus *string    `json:"cameraStatus,omitempty"`
			IsOnline     bool       `json:"isOnline,omitempty"`
		}

		sql := `SELECT id, name, type, lat, lng, status, last_seen, camera_status FROM devices`
		var whereClauses []string
		var args []interface{}

		if deviceType := c.Query("type"); deviceType != "" {
			whereClauses = append(whereClauses, `type = $1`)
			args = append(args, deviceType)
		}
		if zoneID := c.Query("zone"); zoneID != "" {
			if len(args) > 0 {
				whereClauses = append(whereClauses, `zone_id = $2`)
			} else {
				whereClauses = append(whereClauses, `zone_id = $1`)
			}
			args = append(args, zoneID)
		}

		if len(whereClauses) > 0 {
			sql += ` WHERE ` + strings.Join(whereClauses, ` AND `)
		}
		sql += ` ORDER BY id ASC`

		if err := database.DB.Raw(sql, args...).Scan(&minimalDevices).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch devices: " + err.Error()})
			return
		}
		now := time.Now().UTC().Add(-onlineThreshold)
		for i := range minimalDevices {
			minimalDevices[i].IsOnline = minimalDevices[i].LastSeen != nil && minimalDevices[i].LastSeen.After(now)
		}
		c.JSON(http.StatusOK, minimalDevices)
		return
	}

	// Full mode - include latest event
	if err := query.Preload("Events", func(db *gorm.DB) *gorm.DB {
		return db.Order("timestamp DESC").Limit(1)
	}).Order("id ASC").Find(&devices).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch devices"})
		return
	}
	for i := range devices {
		setDeviceIsOnline(&devices[i])
		setDeviceUptimePercent(&devices[i])
	}
	c.JSON(http.StatusOK, devices)
}

// GetDeviceLatest handles GET /api/devices/:id/latest
func GetDeviceLatest(c *gin.Context) {
	deviceID := c.Param("id")

	var event models.Event
	if err := database.DB.Where("device_id = ?", deviceID).
		Order("timestamp DESC").
		First(&event).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "No events found for device"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch latest event"})
		return
	}

	c.JSON(http.StatusOK, event)
}

// GetDeviceSurges handles GET /api/devices/analytics/surges
func GetDeviceSurges(c *gin.Context) {
	type SurgeEvent struct {
		ID        int64   `json:"id"`
		DeviceID  string  `json:"device_id"`
		Timestamp string  `json:"timestamp"`
		Type      string  `json:"type"`
		Data      string  `json:"data"`
		RiskLevel *string `json:"risk_level"`
		Name      *string `json:"name"`
		Lat       float64 `json:"lat"`
		Lng       float64 `json:"lng"`
		ZoneID    *string `json:"zone_id"`
	}

	var results []SurgeEvent
	query := `
		SELECT DISTINCT ON (e.device_id) 
			e.id, e.device_id, e.timestamp, e.type, e.data::text, e.risk_level,
			d.name, d.lat, d.lng, d.zone_id
		FROM events e
		JOIN devices d ON e.device_id = d.id
		WHERE e.risk_level IN ('high', 'critical')
		AND e.timestamp > NOW() - INTERVAL '5 minutes'
		ORDER BY e.device_id, e.timestamp DESC
	`

	if err := database.DB.Raw(query).Scan(&results).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch surge data"})
		return
	}

	c.JSON(http.StatusOK, results)
}

// GetDeviceStats handles GET /api/devices/stats
func GetDeviceStats(c *gin.Context) {
	var stats struct {
		Total       int64 `json:"total"`
		Active      int64 `json:"active"`
		Inactive    int64 `json:"inactive"`
		Maintenance int64 `json:"maintenance"`
	}

	database.DB.Model(&models.Device{}).Count(&stats.Total)
	database.DB.Model(&models.Device{}).Where("status = ? OR status = ?", "active", "ACTIVE").Count(&stats.Active)
	database.DB.Model(&models.Device{}).Where("status = ? OR status = ?", "inactive", "INACTIVE").Count(&stats.Inactive)
	database.DB.Model(&models.Device{}).Where("status = ? OR status = ?", "maintenance", "MAINTENANCE").Count(&stats.Maintenance)

	c.JSON(http.StatusOK, stats)
}

// CreateDevice handles POST /api/devices
func CreateDevice(c *gin.Context) {
	var req struct {
		Name     *string           `json:"name"`
		Type     models.DeviceType `json:"type"`
		Status   *string           `json:"status"`
		Lat      *float64          `json:"lat"`
		Lng      *float64          `json:"lng"`
		ZoneID   *string           `json:"zoneId"`
		RTSPUrl  *string           `json:"rtspUrl"`
		Config   *json.RawMessage  `json:"config"`
		Metadata *json.RawMessage  `json:"metadata"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Type == "" {
		req.Type = models.DeviceTypeCamera
	}
	status := "ACTIVE"
	if req.Status != nil {
		status = *req.Status
	}

	device := models.Device{
		ID:     generateID("cam"),
		Type:   req.Type,
		Status: status,
		Lat:    0,
		Lng:    0,
	}
	if req.Name != nil {
		device.Name = req.Name
	}
	if req.ZoneID != nil && *req.ZoneID != "" {
		device.ZoneID = req.ZoneID
	}
	if req.RTSPUrl != nil {
		device.RTSPUrl = req.RTSPUrl
	}
	if req.Lat != nil {
		device.Lat = *req.Lat
	}
	if req.Lng != nil {
		device.Lng = *req.Lng
	}
	if req.Config != nil {
		device.Config = models.NewJSONB(req.Config)
	}
	if req.Metadata != nil {
		device.Metadata = models.NewJSONB(req.Metadata)
	}

	if err := database.DB.Create(&device).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create device"})
		return
	}
	persistTopologyConfigFromDevices()

	setDeviceIsOnline(&device)
	c.JSON(http.StatusCreated, device)
}

// UpdateDevice handles PUT /api/devices/:id
func UpdateDevice(c *gin.Context) {
	deviceID := c.Param("id")

	var device models.Device
	if err := database.DB.Where("id = ?", deviceID).First(&device).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Device not found"})
		return
	}

	var req struct {
		Name     *string          `json:"name"`
		Status   *string          `json:"status"`
		Lat      *float64         `json:"lat"`
		Lng      *float64         `json:"lng"`
		ZoneID   *string          `json:"zoneId"`
		RTSPUrl  *string          `json:"rtspUrl"`
		Config   *json.RawMessage `json:"config"`
		Metadata *json.RawMessage `json:"metadata"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updates := map[string]interface{}{}
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.Status != nil {
		updates["status"] = *req.Status
	}
	if req.Lat != nil {
		updates["lat"] = *req.Lat
	}
	if req.Lng != nil {
		updates["lng"] = *req.Lng
	}
	if req.ZoneID != nil {
		updates["zone_id"] = *req.ZoneID
	}
	if req.RTSPUrl != nil {
		updates["rtsp_url"] = *req.RTSPUrl
	}
	if req.Config != nil {
		updates["config"] = models.NewJSONB(req.Config)
	}
	if req.Metadata != nil {
		updates["metadata"] = models.NewJSONB(req.Metadata)
	}

	if len(updates) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No fields to update"})
		return
	}

	if err := database.DB.Model(&device).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update device"})
		return
	}
	persistTopologyConfigFromDevices()

	database.DB.Where("id = ?", deviceID).First(&device)
	c.JSON(http.StatusOK, device)
}

// UpdateDeviceStatus handles PATCH /api/devices/:id/status
func UpdateDeviceStatus(c *gin.Context) {
	deviceID := c.Param("id")
	var req struct {
		Status string `json:"status" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	if err := database.DB.Model(&models.Device{}).
		Where("id = ?", deviceID).
		Update("status", req.Status).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update device status"})
		return
	}
	persistTopologyConfigFromDevices()

	c.JSON(http.StatusOK, gin.H{"success": true})
}

func persistTopologyConfigFromDevices() {
	if err := services.PersistFRSTopologyToConfig(); err != nil {
		// Device status/config should still proceed even if file sync fails.
		fmt.Printf("WARN: failed to persist topology config.yml: %v\n", err)
	}
}

// GetDeviceHealth handles GET /api/devices/:id/health
func GetDeviceHealth(c *gin.Context) {
	deviceID := c.Param("id")

	var device models.Device
	if err := database.DB.Where("id = ?", deviceID).First(&device).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Device not found"})
		return
	}

	// Calculate uptime (simplified - based on status)
	uptimePercent := 99.5
	if device.Status == "inactive" || device.Status == "INACTIVE" {
		uptimePercent = 0.0
	} else if device.Status == "maintenance" || device.Status == "MAINTENANCE" {
		uptimePercent = 50.0
	}

	// Get recent event count (last 24 hours)
	var recentEventCount int64
	twentyFourHoursAgo := time.Now().Add(-24 * time.Hour)
	database.DB.Model(&models.Event{}).
		Where("device_id = ? AND timestamp >= ?", deviceID, twentyFourHoursAgo).
		Count(&recentEventCount)

	resp := gin.H{
		"deviceId":         deviceID,
		"status":           device.Status,
		"uptimePercent":    uptimePercent,
		"recentEventCount": recentEventCount,
		"lastEvent":        device.UpdatedAt,
	}
	if device.LastSeen != nil {
		resp["lastSeen"] = device.LastSeen
	}
	if device.CameraStatus != nil {
		resp["cameraStatus"] = *device.CameraStatus
	}
	c.JSON(http.StatusOK, resp)
}

// GetDevice handles GET /api/devices/:id
func GetDevice(c *gin.Context) {
	deviceID := c.Param("id")
	getDeviceByID(c, deviceID)
}

// GetDeviceByQuery handles GET /api/devices/by-id?deviceId=xxx (supports ids with / or = in path)
func GetDeviceByQuery(c *gin.Context) {
	deviceID := c.Query("deviceId")
	if deviceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "deviceId is required"})
		return
	}
	getDeviceByID(c, deviceID)
}

func getDeviceByID(c *gin.Context, deviceID string) {
	var device models.Device
	if err := database.DB.Where("id = ?", deviceID).First(&device).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Device not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch device"})
		return
	}
	setDeviceIsOnline(&device)
	c.JSON(http.StatusOK, device)
}

// GetDeviceCameras handles GET /api/devices/:id/cameras - child cameras (parent_device_id = :id)
func GetDeviceCameras(c *gin.Context) {
	parentID := c.Param("id")
	getDeviceCamerasByParentID(c, parentID)
}

// GetDeviceCamerasByQuery handles GET /api/devices/cameras?deviceId=xxx (supports ids with / or = in path)
func GetDeviceCamerasByQuery(c *gin.Context) {
	deviceID := c.Query("deviceId")
	if deviceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "deviceId is required"})
		return
	}
	getDeviceCamerasByParentID(c, deviceID)
}

func getDeviceCamerasByParentID(c *gin.Context, parentID string) {
	var cameras []models.Device
	if err := database.DB.Where("parent_device_id = ?", parentID).Order("id ASC").Find(&cameras).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch cameras"})
		return
	}
	for i := range cameras {
		setDeviceIsOnline(&cameras[i])
		setDeviceUptimePercent(&cameras[i])
	}
	c.JSON(http.StatusOK, cameras)
}

// GetDeviceHeartbeats handles GET /api/devices/:id/heartbeats?last=24h|7d or ?from=ISO&to=ISO
func GetDeviceHeartbeats(c *gin.Context) {
	deviceID := c.Param("id")
	getDeviceHeartbeatsByID(c, deviceID)
}

// GetDeviceHeartbeatsByQuery handles GET /api/devices/heartbeats?deviceId=xxx&last=24h (supports ids with / or = in path)
func GetDeviceHeartbeatsByQuery(c *gin.Context) {
	deviceID := c.Query("deviceId")
	if deviceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "deviceId is required"})
		return
	}
	getDeviceHeartbeatsByID(c, deviceID)
}

func getDeviceHeartbeatsByID(c *gin.Context, deviceID string) {
	now := time.Now().UTC()
	var from, to time.Time
	if f, t := c.Query("from"), c.Query("to"); f != "" && t != "" {
		var err1, err2 error
		from, err1 = time.Parse(time.RFC3339, f)
		to, err2 = time.Parse(time.RFC3339, t)
		if err1 != nil || err2 != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid from/to; use RFC3339"})
			return
		}
	} else {
		last := strings.ToLower(c.DefaultQuery("last", "24h"))
		switch last {
		case "7d":
			to = now
			from = now.Add(-7 * 24 * time.Hour)
		default:
			to = now
			from = now.Add(-24 * time.Hour)
		}
	}

	var heartbeats []models.DeviceHeartbeat
	if err := database.DB.Where("device_id = ? AND timestamp >= ? AND timestamp <= ?", deviceID, from, to).
		Order("timestamp ASC").
		Find(&heartbeats).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch heartbeats"})
		return
	}

	out := make([]gin.H, 0, len(heartbeats))
	for _, h := range heartbeats {
		entry := gin.H{"timestamp": h.Timestamp.Format(time.RFC3339), "cameraStatus": h.CameraStatus}
		if h.Metadata.Data != nil {
			entry["metadata"] = h.Metadata.Data
		}
		out = append(out, entry)
	}
	c.JSON(http.StatusOK, out)
}

// DeleteDevice handles DELETE /api/devices/:id
func DeleteDevice(c *gin.Context) {
	deleteDeviceByID(c, c.Param("id"))
}

// DeleteDeviceByQuery handles DELETE /api/devices/by-id?deviceId=xxx (supports ids with / or = in path)
func DeleteDeviceByQuery(c *gin.Context) {
	deviceID := c.Query("deviceId")
	if deviceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "deviceId is required"})
		return
	}
	deleteDeviceByID(c, deviceID)
}

func deleteDeviceByID(c *gin.Context, deviceID string) {
	// 1. Delete child cameras and their heartbeats (when deleting a MagicBox)
	var children []models.Device
	database.DB.Where("parent_device_id = ?", deviceID).Find(&children)
	for _, ch := range children {
		database.DB.Where("device_id = ?", ch.ID).Delete(&models.DeviceHeartbeat{})
		database.DB.Exec("DELETE FROM crowd_analyses WHERE device_id = ?", ch.ID)
		database.DB.Where("id = ?", ch.ID).Delete(&models.Device{})
	}
	// 2. Delete heartbeats and crowd analyses for this device
	database.DB.Where("device_id = ?", deviceID).Delete(&models.DeviceHeartbeat{})
	database.DB.Exec("DELETE FROM crowd_analyses WHERE device_id = ?", deviceID)
	// 3. Delete the device
	res := database.DB.Where("id = ?", deviceID).Delete(&models.Device{})
	if res.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Device not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// DeviceHeartbeatRequest - Payload for device heartbeat
type DeviceHeartbeatRequest struct {
	CameraStatus string                 `json:"camera_status"`      // streaming, online, offline, error
	Metadata     map[string]interface{} `json:"metadata,omitempty"` // fps, resolution, version, etc.
}

// UpsertDeviceHeartbeatFromSystem stores a heartbeat for non-HTTP ingestion paths (e.g. MQTT).
func UpsertDeviceHeartbeatFromSystem(deviceID string, cameraStatus string, metadata map[string]interface{}, at time.Time) error {
	deviceID = strings.TrimSpace(deviceID)
	if deviceID == "" {
		return fmt.Errorf("deviceID is required")
	}
	if cameraStatus == "" {
		cameraStatus = "online"
	}
	if at.IsZero() {
		at = time.Now().UTC()
	}

	var device models.Device
	err := database.DB.Where("id = ?", deviceID).First(&device).Error
	if err != nil {
		if err != gorm.ErrRecordNotFound {
			return err
		}
		name := deviceID
		device = models.Device{
			ID:       deviceID,
			Type:     models.DeviceTypeCamera,
			Name:     &name,
			Status:   "ACTIVE",
			LastSeen: &at,
		}
		if err := database.DB.Create(&device).Error; err != nil {
			return err
		}
	}

	hb := models.DeviceHeartbeat{
		DeviceID:     deviceID,
		Timestamp:    at,
		CameraStatus: cameraStatus,
	}
	if metadata != nil {
		hb.Metadata = models.NewJSONB(metadata)
	}
	if err := database.DB.Create(&hb).Error; err != nil {
		return err
	}

	updates := map[string]interface{}{
		"last_seen":     at,
		"camera_status": cameraStatus,
	}
	if err := database.DB.Model(&models.Device{}).Where("id = ?", deviceID).Updates(updates).Error; err != nil {
		return err
	}

	return nil
}

// DeviceHeartbeat handles POST /api/devices/:id/heartbeat
// Devices (e.g. MagicBox, cameras) can register their heartbeat and camera status.
func DeviceHeartbeat(c *gin.Context) {
	deviceID := c.Param("id")

	var device models.Device
	if err := database.DB.Where("id = ?", deviceID).First(&device).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Device not found"})
		return
	}

	var req DeviceHeartbeatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		// Allow empty body - default to "online"
		req.CameraStatus = "online"
	}

	if req.CameraStatus == "" {
		req.CameraStatus = "online"
	}

	now := time.Now()

	// Append to heartbeat history
	hb := models.DeviceHeartbeat{
		DeviceID:     deviceID,
		Timestamp:    now,
		CameraStatus: req.CameraStatus,
	}
	if req.Metadata != nil {
		hb.Metadata = models.NewJSONB(req.Metadata)
	}
	if err := database.DB.Create(&hb).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to store heartbeat"})
		return
	}

	// Update device's last seen and camera status
	updates := map[string]interface{}{
		"last_seen":     now,
		"camera_status": req.CameraStatus,
	}
	if err := database.DB.Model(&models.Device{}).Where("id = ?", deviceID).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update device"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":   "ok",
		"deviceId": deviceID,
		"lastSeen": now,
	})
}

// DeviceBeatRequest - Payload for POST /api/devices/beat (MagicBox + cameras)
type DeviceBeatRequest struct {
	MagicboxID *string                `json:"magicbox_id"`
	Cameras    []BeatCamera           `json:"cameras"`
	Metadata   map[string]interface{} `json:"metadata,omitempty"` // e.g. wg_interface_ip
}

// BeatCamera - Camera item in devices/beat payload
type BeatCamera struct {
	ID                 int         `json:"id"`
	Name               string      `json:"name"`
	RtspUrl            string      `json:"rtsp_url"`
	IsActive           bool        `json:"is_active"`
	EnabledViolations  string      `json:"enabled_violations"`
	SpeedLimit         float64     `json:"speed_limit"`
	Mpp                float64     `json:"mpp"`
	WrongSideZone      interface{} `json:"wrong_side_zone"` // JSON string "[[50,200],...]" or null
	WrongSideDirection string      `json:"wrong_side_direction"`
	CameraAngle        float64     `json:"camera_angle"`
	CameraHeightMeters float64     `json:"camera_height_meters"`
	CreatedAt          interface{} `json:"created_at"`
	Status             string      `json:"status"`
	LastOnline         interface{} `json:"last_online"`
	LastChecked        interface{} `json:"last_checked"`
}

// buildBeatConfig builds Device.Config JSONB from BeatCamera (camera-only fields; rtsp_url goes to RTSPUrl column)
func buildBeatConfig(cam BeatCamera) models.JSONB {
	cfg := make(map[string]interface{})

	// enabled_violations: parse JSON string to array
	if cam.EnabledViolations != "" {
		var arr []interface{}
		if err := json.Unmarshal([]byte(cam.EnabledViolations), &arr); err == nil {
			cfg["enabled_violations"] = arr
		} else {
			cfg["enabled_violations"] = []interface{}{}
		}
	}

	cfg["speed_limit"] = cam.SpeedLimit
	cfg["mpp"] = cam.Mpp

	// wrong_side_zone: already an object if decoded from JSON; if it was a string we need to parse
	switch v := cam.WrongSideZone.(type) {
	case string:
		if v != "" {
			var arr []interface{}
			if err := json.Unmarshal([]byte(v), &arr); err == nil {
				cfg["wrong_side_zone"] = arr
			}
		}
	case nil:
		// leave unset or set null
	default:
		cfg["wrong_side_zone"] = v
	}

	if cam.WrongSideDirection != "" {
		cfg["wrong_side_direction"] = cam.WrongSideDirection
	}
	cfg["camera_angle"] = cam.CameraAngle
	cfg["camera_height_meters"] = cam.CameraHeightMeters
	cfg["is_active"] = cam.IsActive
	if cam.LastOnline != nil {
		cfg["last_online"] = cam.LastOnline
	}
	if cam.LastChecked != nil {
		cfg["last_checked"] = cam.LastChecked
	}

	return models.NewJSONB(cfg)
}

// parseTimeFromBeat parses last_online/last_checked (string RFC3339 or float64 Unix) to time.Time; returns zero value if unparseable.
func parseTimeFromBeat(v interface{}) time.Time {
	switch x := v.(type) {
	case string:
		if t, err := time.Parse(time.RFC3339, x); err == nil {
			return t
		}
		if t, err := time.Parse("2006-01-02T15:04:05Z07:00", x); err == nil {
			return t
		}
	case float64:
		return time.Unix(int64(x), 0)
	}
	return time.Time{}
}

// DeviceBeat handles POST /api/devices/beat
// MagicBox sends magicbox_id and cameras[] every 30s; creates/updates MagicBox and Camera devices and stores heartbeats.
func DeviceBeat(c *gin.Context) {
	var req DeviceBeatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Cameras == nil {
		req.Cameras = []BeatCamera{}
	}

	magicboxID := ""
	if req.MagicboxID != nil {
		magicboxID = *req.MagicboxID
	}
	now := time.Now()

	// 1. MagicBox (only if magicbox_id != "")
	if magicboxID != "" {
		var mb models.Device
		err := database.DB.Where("id = ?", magicboxID).First(&mb).Error
		if err != nil {
			if err == gorm.ErrRecordNotFound {
				mb = models.Device{
					ID:   magicboxID,
					Type: models.DeviceTypeMagicBox,
					Name: &magicboxID,
					Lat:  0, Lng: 0,
					Status: "active",
				}
				if req.Metadata != nil {
					mb.Metadata = models.NewJSONB(req.Metadata)
				}
				if dbErr := database.DB.Create(&mb).Error; dbErr != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create MagicBox device"})
					return
				}
			} else {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch MagicBox"})
				return
			}
		}
		// Update LastSeen, CameraStatus, Metadata
		statusVal := "online"
		up := map[string]interface{}{"last_seen": now, "camera_status": statusVal}
		if req.Metadata != nil {
			up["metadata"] = models.NewJSONB(req.Metadata)
		}
		database.DB.Model(&models.Device{}).Where("id = ?", magicboxID).Updates(up)
		// Heartbeat
		hb := models.DeviceHeartbeat{DeviceID: magicboxID, Timestamp: now, CameraStatus: statusVal}
		if req.Metadata != nil {
			hb.Metadata = models.NewJSONB(req.Metadata)
		}
		database.DB.Create(&hb)
	}

	// 2. Cameras
	processed := 0
	for _, cam := range req.Cameras {
		deviceID := fmt.Sprint(cam.ID)
		if magicboxID != "" {
			deviceID = magicboxID + "_" + deviceID
		}

		config := buildBeatConfig(cam)
		var rtspUrl *string
		if cam.RtspUrl != "" {
			rtspUrl = &cam.RtspUrl
		}
		var name *string
		if cam.Name != "" {
			name = &cam.Name
		}
		var parentID *string
		if magicboxID != "" {
			parentID = &magicboxID
		}

		lastSeen := now
		if t := parseTimeFromBeat(cam.LastOnline); !t.IsZero() {
			lastSeen = t
		}
		camStatus := cam.Status
		if camStatus == "" {
			camStatus = "online"
		}

		var dev models.Device
		err := database.DB.Where("id = ?", deviceID).First(&dev).Error
		if err != nil {
			if err == gorm.ErrRecordNotFound {
				dev = models.Device{
					ID:             deviceID,
					Type:           models.DeviceTypeCamera,
					Name:           name,
					RTSPUrl:        rtspUrl,
					ParentDeviceID: parentID,
					Config:         config,
					Lat:            0, Lng: 0,
					Status:       "active",
					LastSeen:     &lastSeen,
					CameraStatus: &camStatus,
				}
				if dbErr := database.DB.Create(&dev).Error; dbErr != nil {
					continue
				}
			} else {
				continue
			}
		} else {
			up := map[string]interface{}{
				"name":             name,
				"rtsp_url":         rtspUrl,
				"config":           config,
				"parent_device_id": parentID,
				"last_seen":        lastSeen,
				"camera_status":    camStatus,
			}
			database.DB.Model(&models.Device{}).Where("id = ?", deviceID).Updates(up)
		}

		database.DB.Create(&models.DeviceHeartbeat{
			DeviceID:     deviceID,
			Timestamp:    now,
			CameraStatus: camStatus,
		})
		processed++
	}

	c.JSON(http.StatusOK, gin.H{
		"status":            "ok",
		"magicbox_id":       magicboxID,
		"cameras_processed": processed,
	})
}
