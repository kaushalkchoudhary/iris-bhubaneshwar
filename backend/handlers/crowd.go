package handlers

import (
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/irisdrone/backend/database"
	"github.com/irisdrone/backend/models"
	"gorm.io/gorm"
)

var crowdLiveFrames sync.Map

// PostCrowdAnalysis handles POST /api/crowd/analysis
func PostCrowdAnalysis(c *gin.Context) {
	var req struct {
		DeviceID        string                   `json:"deviceId" binding:"required"`
		PeopleCount     *int                     `json:"peopleCount"`
		CumulativeCount *int                     `json:"cumulativeCount"`
		DensityValue    *float64                 `json:"densityValue"`
		DensityLevel    models.CrowdDensityLevel `json:"densityLevel"`
		MovementType    models.MovementType      `json:"movementType"`
		FlowRate        *float64                 `json:"flowRate"`
		Velocity        *float64                 `json:"velocity"`
		FreeSpace       *float64                 `json:"freeSpace"`
		CongestionLevel *int                     `json:"congestionLevel"`
		OccupancyRate   *float64                 `json:"occupancyRate"`
		HotspotSeverity models.HotspotSeverity   `json:"hotspotSeverity"`
		HotspotZones    models.JSONB             `json:"hotspotZones"`
		MaxDensityPoint models.JSONB             `json:"maxDensityPoint"`
		Demographics    models.JSONB             `json:"demographics"`
		Behavior        *string                  `json:"behavior"`
		Anomalies       models.JSONB             `json:"anomalies"`
		HeatmapData     models.JSONB             `json:"heatmapData"`
		HeatmapImageURL *string                  `json:"heatmapImageUrl"`
		FrameID         *string                  `json:"frameId"`
		FrameURL        *string                  `json:"frameUrl"`
		ModelType       *string                  `json:"modelType"`
		Confidence      *float64                 `json:"confidence"`
		Timestamp       *string                  `json:"timestamp"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	// Ensure device exists (auto-create for inference pipelines)
	var device models.Device
	if err := database.DB.First(&device, "id = ?", req.DeviceID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			name := "Camera " + req.DeviceID
			device = models.Device{
				ID:     req.DeviceID,
				Type:   models.DeviceTypeCamera,
				Name:   &name,
				Status: "active",
			}
			if createErr := database.DB.Create(&device).Error; createErr != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create device"})
				return
			}
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to check device"})
			return
		}
	}

	// Set defaults
	densityLevel := req.DensityLevel
	if densityLevel == "" {
		densityLevel = models.DensityLow
	}

	movementType := req.MovementType
	if movementType == "" {
		movementType = models.MovementStatic
	}

	hotspotSeverity := req.HotspotSeverity
	if hotspotSeverity == "" {
		hotspotSeverity = models.SeverityGreen
	}

	modelType := req.ModelType
	if modelType == nil {
		defaultType := "hybrid"
		modelType = &defaultType
	}

	timestamp := time.Now()
	if req.Timestamp != nil {
		if parsed, err := time.Parse(time.RFC3339, *req.Timestamp); err == nil {
			timestamp = parsed
		}
	}

	analysis := models.CrowdAnalysis{
		DeviceID:        req.DeviceID,
		PeopleCount:     req.PeopleCount,
		CumulativeCount: req.CumulativeCount,
		DensityValue:    req.DensityValue,
		DensityLevel:    densityLevel,
		MovementType:    movementType,
		FlowRate:        req.FlowRate,
		Velocity:        req.Velocity,
		FreeSpace:       req.FreeSpace,
		CongestionLevel: req.CongestionLevel,
		OccupancyRate:   req.OccupancyRate,
		HotspotSeverity: hotspotSeverity,
		HotspotZones:    req.HotspotZones,
		MaxDensityPoint: req.MaxDensityPoint,
		Demographics:    req.Demographics,
		Behavior:        req.Behavior,
		Anomalies:       req.Anomalies,
		HeatmapData:     req.HeatmapData,
		HeatmapImageURL: req.HeatmapImageURL,
		FrameID:         req.FrameID,
		FrameURL:        req.FrameURL,
		ModelType:       modelType,
		Confidence:      req.Confidence,
		Timestamp:       timestamp,
	}

	if err := database.DB.Create(&analysis).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to ingest crowd analysis"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"success": true, "id": strconv.FormatInt(analysis.ID, 10)})
}

// PostCrowdAnalysisIngest handles internal inference ingest endpoint.
func PostCrowdAnalysisIngest(c *gin.Context) {
	PostCrowdAnalysis(c)
}

// PostCrowdLiveFrame stores latest base64 frame per device for lightweight live preview.
func PostCrowdLiveFrame(c *gin.Context) {
	var req struct {
		DeviceID string `json:"deviceId" binding:"required"`
		Frame    string `json:"frame" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}
	crowdLiveFrames.Store(req.DeviceID, req.Frame)
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// GetCrowdLiveFrames returns latest live frame map keyed by device id.
func GetCrowdLiveFrames(c *gin.Context) {
	out := make(map[string]string)
	crowdLiveFrames.Range(func(key, value interface{}) bool {
		k, okK := key.(string)
		v, okV := value.(string)
		if okK && okV {
			out[k] = v
		}
		return true
	})
	c.JSON(http.StatusOK, out)
}

// GetCrowdAnalysis handles GET /api/crowd/analysis
func GetCrowdAnalysis(c *gin.Context) {
	query := database.DB.Model(&models.CrowdAnalysis{})

	if deviceID := c.Query("deviceId"); deviceID != "" {
		query = query.Where("device_id = ?", deviceID)
	}

	if startTime := c.Query("startTime"); startTime != "" {
		if parsed, err := time.Parse(time.RFC3339, startTime); err == nil {
			query = query.Where("timestamp >= ?", parsed)
		}
	}

	if endTime := c.Query("endTime"); endTime != "" {
		if parsed, err := time.Parse(time.RFC3339, endTime); err == nil {
			query = query.Where("timestamp <= ?", parsed)
		}
	}

	if severity := c.Query("severity"); severity != "" {
		query = query.Where("hotspot_severity = ?", severity)
	}

	limit := 100
	if limitStr := c.Query("limit"); limitStr != "" {
		if parsed, err := strconv.Atoi(limitStr); err == nil && parsed > 0 {
			limit = parsed
		}
	}

	var analyses []models.CrowdAnalysis
	if err := query.Preload("Device", func(db *gorm.DB) *gorm.DB {
		return db.Select("id, name, lat, lng, type")
	}).Order("timestamp DESC").Limit(limit).Find(&analyses).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch crowd analysis"})
		return
	}

	c.JSON(http.StatusOK, analyses)
}

// GetLatestCrowdAnalysis handles GET /api/crowd/analysis/latest
func GetLatestCrowdAnalysis(c *gin.Context) {
	var deviceIDs []string

	if deviceIdsParam := c.Query("deviceIds"); deviceIdsParam != "" {
		deviceIDs = strings.Split(deviceIdsParam, ",")
		for i := range deviceIDs {
			deviceIDs[i] = strings.TrimSpace(deviceIDs[i])
		}
	} else {
		// Get all device IDs
		var devices []models.Device
		if err := database.DB.Select("id").Find(&devices).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch devices"})
			return
		}
		deviceIDs = make([]string, len(devices))
		for i, d := range devices {
			deviceIDs[i] = d.ID
		}
	}

	type AnalysisWithDevice struct {
		models.CrowdAnalysis
		Device struct {
			ID   string            `json:"id"`
			Name *string           `json:"name"`
			Lat  float64           `json:"lat"`
			Lng  float64           `json:"lng"`
			Type models.DeviceType `json:"type"`
		} `json:"device"`
		CrowdLevel int `json:"crowdLevel"`
	}

	var latestAnalyses []AnalysisWithDevice
	for _, deviceID := range deviceIDs {
		var analysis models.CrowdAnalysis
		if err := database.DB.Where("device_id = ?", deviceID).
			Preload("Device", func(db *gorm.DB) *gorm.DB {
				return db.Select("id, name, lat, lng, type")
			}).
			Order("timestamp DESC").
			First(&analysis).Error; err == nil {
			analysisWithDevice := AnalysisWithDevice{
				CrowdAnalysis: analysis,
			}
			analysisWithDevice.Device.ID = analysis.Device.ID
			analysisWithDevice.Device.Name = analysis.Device.Name
			analysisWithDevice.Device.Lat = analysis.Device.Lat
			analysisWithDevice.Device.Lng = analysis.Device.Lng
			analysisWithDevice.Device.Type = analysis.Device.Type
			latestAnalyses = append(latestAnalyses, analysisWithDevice)
		}
	}

	// Sort by peopleCount (highest first)
	for i := 0; i < len(latestAnalyses)-1; i++ {
		for j := i + 1; j < len(latestAnalyses); j++ {
			aCount := 0
			bCount := 0
			if latestAnalyses[i].PeopleCount != nil {
				aCount = *latestAnalyses[i].PeopleCount
			}
			if latestAnalyses[j].PeopleCount != nil {
				bCount = *latestAnalyses[j].PeopleCount
			}

			if aCount < bCount {
				latestAnalyses[i], latestAnalyses[j] = latestAnalyses[j], latestAnalyses[i]
			} else if aCount == bCount {
				// Secondary sort by timestamp
				if latestAnalyses[i].Timestamp.Before(latestAnalyses[j].Timestamp) {
					latestAnalyses[i], latestAnalyses[j] = latestAnalyses[j], latestAnalyses[i]
				}
			}
		}
	}

	// Calculate crowd level (0-100)
	peopleCounts := make([]int, 0)
	for _, a := range latestAnalyses {
		if a.PeopleCount != nil {
			peopleCounts = append(peopleCounts, *a.PeopleCount)
		}
	}

	minCount := 0
	maxCount := 0
	if len(peopleCounts) > 0 {
		minCount = peopleCounts[0]
		maxCount = peopleCounts[0]
		for _, count := range peopleCounts {
			if count < minCount {
				minCount = count
			}
			if count > maxCount {
				maxCount = count
			}
		}
	}

	rangeVal := maxCount - minCount
	for i := range latestAnalyses {
		count := 0
		if latestAnalyses[i].PeopleCount != nil {
			count = *latestAnalyses[i].PeopleCount
		}

		if rangeVal > 0 {
			latestAnalyses[i].CrowdLevel = int(float64(count-minCount) / float64(rangeVal) * 100)
		} else if count > 0 {
			latestAnalyses[i].CrowdLevel = 100
		}
	}

	c.JSON(http.StatusOK, latestAnalyses)
}

// PostCrowdAlert handles POST /api/crowd/alerts
func PostCrowdAlert(c *gin.Context) {
	var req struct {
		DeviceID        string                   `json:"deviceId" binding:"required"`
		AlertType       string                   `json:"alertType" binding:"required"`
		Severity        models.HotspotSeverity   `json:"severity"`
		Priority        *int                     `json:"priority"`
		TriggerRule     models.JSONB             `json:"triggerRule"`
		ThresholdValue  *float64                 `json:"thresholdValue"`
		ActualValue     float64                  `json:"actualValue"`
		PeopleCount     *int                     `json:"peopleCount"`
		DensityLevel    models.CrowdDensityLevel `json:"densityLevel"`
		CongestionLevel *int                     `json:"congestionLevel"`
		MovementType    *models.MovementType     `json:"movementType"`
		Title           string                   `json:"title" binding:"required"`
		Description     *string                  `json:"description"`
		Recommendations models.JSONB             `json:"recommendations"`
		AnalysisID      *int64                   `json:"analysisId"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	// Check if device exists
	var device models.Device
	if err := database.DB.First(&device, "id = ?", req.DeviceID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Device not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to check device"})
		return
	}

	severity := req.Severity
	if severity == "" {
		severity = models.SeverityYellow
	}

	priority := 5
	if req.Priority != nil {
		priority = *req.Priority
	}

	densityLevel := req.DensityLevel
	if densityLevel == "" {
		densityLevel = models.DensityLow
	}

	alert := models.CrowdAlert{
		DeviceID:        req.DeviceID,
		AlertType:       req.AlertType,
		Severity:        severity,
		Priority:        priority,
		TriggerRule:     req.TriggerRule,
		ThresholdValue:  req.ThresholdValue,
		ActualValue:     req.ActualValue,
		PeopleCount:     req.PeopleCount,
		DensityLevel:    densityLevel,
		CongestionLevel: req.CongestionLevel,
		MovementType:    req.MovementType,
		Title:           req.Title,
		Description:     req.Description,
		Recommendations: req.Recommendations,
		AnalysisID:      req.AnalysisID,
	}

	if err := database.DB.Create(&alert).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create crowd alert"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"success": true, "id": strconv.FormatInt(alert.ID, 10)})
}

// GetCrowdAlerts handles GET /api/crowd/alerts
func GetCrowdAlerts(c *gin.Context) {
	query := database.DB.Model(&models.CrowdAlert{})

	if deviceID := c.Query("deviceId"); deviceID != "" {
		query = query.Where("device_id = ?", deviceID)
	}

	if isResolved := c.Query("isResolved"); isResolved != "" {
		if isResolved == "true" {
			query = query.Where("is_resolved = ?", true)
		} else {
			query = query.Where("is_resolved = ?", false)
		}
	}

	if severity := c.Query("severity"); severity != "" {
		query = query.Where("severity = ?", severity)
	}

	if alertType := c.Query("alertType"); alertType != "" {
		query = query.Where("alert_type = ?", alertType)
	}

	limit := 50
	if limitStr := c.Query("limit"); limitStr != "" {
		if parsed, err := strconv.Atoi(limitStr); err == nil && parsed > 0 {
			limit = parsed
		}
	}

	var alerts []models.CrowdAlert
	if err := query.Preload("Device", func(db *gorm.DB) *gorm.DB {
		return db.Select("id, name, lat, lng, type")
	}).Preload("RelatedAnalysis", func(db *gorm.DB) *gorm.DB {
		return db.Select("id, timestamp, people_count, density_level, hotspot_severity")
	}).Order("timestamp DESC").Limit(limit).Find(&alerts).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch crowd alerts"})
		return
	}

	c.JSON(http.StatusOK, alerts)
}

// ResolveCrowdAlert handles PATCH /api/crowd/alerts/:id/resolve
func ResolveCrowdAlert(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid alert ID"})
		return
	}

	var req struct {
		ResolvedBy     *string `json:"resolvedBy"`
		ResolutionNote *string `json:"resolutionNote"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	now := time.Now()
	alert := models.CrowdAlert{
		ID:             id,
		IsResolved:     true,
		ResolvedAt:     &now,
		ResolvedBy:     req.ResolvedBy,
		ResolutionNote: req.ResolutionNote,
	}

	if err := database.DB.Model(&models.CrowdAlert{}).Where("id = ?", id).Updates(&alert).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Alert not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to resolve alert"})
		return
	}

	// Fetch updated alert
	var updatedAlert models.CrowdAlert
	database.DB.First(&updatedAlert, id)
	c.JSON(http.StatusOK, updatedAlert)
}

// GetHotspots handles GET /api/crowd/hotspots
func GetHotspots(c *gin.Context) {
	var devices []models.Device
	if err := database.DB.Where("lat != ? AND lng != ?", 0, 0).
		Select("id, name, lat, lng, type, status, zone_id").
		Find(&devices).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch devices"})
		return
	}

	type Hotspot struct {
		DeviceID        string                   `json:"deviceId"`
		Name            *string                  `json:"name"`
		Lat             float64                  `json:"lat"`
		Lng             float64                  `json:"lng"`
		Type            models.DeviceType        `json:"type"`
		Status          string                   `json:"status"`
		ZoneID          *string                  `json:"zoneId"`
		HotspotSeverity models.HotspotSeverity   `json:"hotspotSeverity"`
		PeopleCount     *int                     `json:"peopleCount"`
		DensityLevel    models.CrowdDensityLevel `json:"densityLevel"`
		CongestionLevel *int                     `json:"congestionLevel"`
		LastUpdated     *time.Time               `json:"lastUpdated"`
	}

	hotspots := make([]Hotspot, 0, len(devices))
	for _, device := range devices {
		var latestAnalysis models.CrowdAnalysis
		database.DB.Where("device_id = ?", device.ID).
			Select("hotspot_severity, people_count, density_level, congestion_level, timestamp").
			Order("timestamp DESC").
			First(&latestAnalysis)

		hotspot := Hotspot{
			DeviceID:        device.ID,
			Name:            device.Name,
			Lat:             device.Lat,
			Lng:             device.Lng,
			Type:            device.Type,
			Status:          device.Status,
			ZoneID:          device.ZoneID,
			HotspotSeverity: models.SeverityGreen,
			DensityLevel:    models.DensityLow,
		}

		if latestAnalysis.ID != 0 {
			hotspot.HotspotSeverity = latestAnalysis.HotspotSeverity
			hotspot.PeopleCount = latestAnalysis.PeopleCount
			hotspot.DensityLevel = latestAnalysis.DensityLevel
			hotspot.CongestionLevel = latestAnalysis.CongestionLevel
			hotspot.LastUpdated = &latestAnalysis.Timestamp
		}

		hotspots = append(hotspots, hotspot)
	}

	c.JSON(http.StatusOK, hotspots)
}
