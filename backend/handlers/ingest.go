package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/irisdrone/backend/database"
	"github.com/irisdrone/backend/models"
)

// PostIngest handles POST /api/ingest
func PostIngest(c *gin.Context) {
	var req struct {
		DeviceID  string                 `json:"deviceId" binding:"required"`
		Type      string                 `json:"type" binding:"required"`
		Data      models.JSONB           `json:"data" binding:"required"`
		Timestamp *string                `json:"timestamp"`
		RiskLevel *string                `json:"riskLevel"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing required fields"})
		return
	}

	// Upsert device
	device := models.Device{
		ID:     req.DeviceID,
		Type:   models.DeviceTypeCamera, // Default to camera
		Status: "active",
	}

	// Extract lat/lng from data if available
	if dataMap, ok := req.Data.Data.(map[string]interface{}); ok {
		if lat, ok := dataMap["lat"].(float64); ok {
			device.Lat = lat
		}
		if lng, ok := dataMap["lng"].(float64); ok {
			device.Lng = lng
		}
		// Extract metadata if available
		if metadata, ok := dataMap["metadata"].(map[string]interface{}); ok {
			device.Metadata = models.JSONB{Data: metadata}
		}
	}

	name := "Camera " + req.DeviceID
	device.Name = &name

	if err := database.DB.Where("id = ?", req.DeviceID).
		Assign(models.Device{
			UpdatedAt: time.Now(),
		}).
		FirstOrCreate(&device).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to upsert device"})
		return
	}

	// Update metadata if provided
	if device.Metadata.Data != nil {
		database.DB.Model(&device).Update("metadata", device.Metadata)
	}

	// Create event
	timestamp := time.Now()
	if req.Timestamp != nil {
		if parsed, err := time.Parse(time.RFC3339, *req.Timestamp); err == nil {
			timestamp = parsed
		}
	}

	event := models.Event{
		DeviceID:  req.DeviceID,
		Type:      req.Type,
		Data:      req.Data,
		RiskLevel: req.RiskLevel,
		Timestamp: timestamp,
	}

	if err := database.DB.Create(&event).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to ingest event"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"success": true, "eventId": event.ID})
}

