package handlers

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/irisdrone/backend/database"
	"github.com/irisdrone/backend/models"
	"gorm.io/gorm"
)

// GetAlerts handles GET /api/alerts - List alerts with filters
func GetAlerts(c *gin.Context) {
	query := database.DB.Model(&models.WatchlistAlert{})

	// Filter by read status
	if isRead := c.Query("isRead"); isRead != "" {
		if isRead == "true" {
			query = query.Where("is_read = ?", true)
		} else if isRead == "false" {
			query = query.Where("is_read = ?", false)
		}
	}

	// Filter by alert type
	if alertType := c.Query("alertType"); alertType != "" {
		query = query.Where("alert_type = ?", alertType)
	}

	// Filter by date range
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

	// Pagination
	limit := 100
	if limitStr := c.Query("limit"); limitStr != "" {
		if parsed, err := strconv.Atoi(limitStr); err == nil && parsed > 0 && parsed <= 500 {
			limit = parsed
		}
	}
	offset := 0
	if offsetStr := c.Query("offset"); offsetStr != "" {
		if parsed, err := strconv.Atoi(offsetStr); err == nil && parsed >= 0 {
			offset = parsed
		}
	}

	var alerts []models.WatchlistAlert
	var total int64

	// Get total count
	query.Model(&models.WatchlistAlert{}).Count(&total)

	// Fetch alerts with relations
	if err := query.
		Preload("Watchlist").
		Preload("Watchlist.Vehicle").
		Preload("Vehicle").
		Preload("Detection").
		Preload("Device").
		Order("timestamp DESC").
		Limit(limit).
		Offset(offset).
		Find(&alerts).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch alerts"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"alerts": alerts,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

// MarkAlertRead handles PATCH /api/alerts/:id/read - Mark alert as read
func MarkAlertRead(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid alert ID"})
		return
	}

	var alert models.WatchlistAlert
	if err := database.DB.First(&alert, id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Alert not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch alert"})
		return
	}

	now := time.Now()
	updates := map[string]interface{}{
		"is_read": true,
		"read_at": now,
	}

	if err := database.DB.Model(&alert).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to mark alert as read"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// DismissAlert handles DELETE /api/alerts/:id - Delete/dismiss alert
func DismissAlert(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid alert ID"})
		return
	}

	if err := database.DB.Delete(&models.WatchlistAlert{}, id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to dismiss alert"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// GetAlertStats handles GET /api/alerts/stats - Get alert statistics
func GetAlertStats(c *gin.Context) {
	var stats struct {
		Total      int64 `json:"total"`
		Unread     int64 `json:"unread"`
		Read       int64 `json:"read"`
		Today      int64 `json:"today"`
		ByType     map[string]int64 `json:"byType"`
	}

	stats.ByType = make(map[string]int64)

	// Get total count
	database.DB.Model(&models.WatchlistAlert{}).Count(&stats.Total)

	// Get unread count
	database.DB.Model(&models.WatchlistAlert{}).Where("is_read = ?", false).Count(&stats.Unread)

	// Get read count
	database.DB.Model(&models.WatchlistAlert{}).Where("is_read = ?", true).Count(&stats.Read)

	// Get today's count
	todayStart := time.Now().Truncate(24 * time.Hour)
	database.DB.Model(&models.WatchlistAlert{}).Where("timestamp >= ?", todayStart).Count(&stats.Today)

	// Get counts by type
	var typeCounts []struct {
		AlertType string
		Count     int64
	}
	database.DB.Model(&models.WatchlistAlert{}).
		Select("alert_type, COUNT(*) as count").
		Group("alert_type").
		Scan(&typeCounts)

	for _, tc := range typeCounts {
		stats.ByType[tc.AlertType] = tc.Count
	}

	c.JSON(http.StatusOK, stats)
}

