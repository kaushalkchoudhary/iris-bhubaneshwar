package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/irisdrone/backend/database"
	"github.com/irisdrone/backend/models"
)

// GetViolationTrends handles GET /api/analytics/violations/trends
func GetViolationTrends(c *gin.Context) {
	startTimeStr := c.Query("startTime")
	endTimeStr := c.Query("endTime")
	groupBy := c.DefaultQuery("groupBy", "day")

	var startTime, endTime time.Time
	var err error

	if startTimeStr != "" {
		startTime, err = time.Parse(time.RFC3339, startTimeStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid startTime"})
			return
		}
	} else {
		startTime = time.Now().AddDate(0, 0, -7) // Default to 7 days ago
	}

	if endTimeStr != "" {
		endTime, err = time.Parse(time.RFC3339, endTimeStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid endTime"})
			return
		}
	} else {
		endTime = time.Now()
	}

	var trends []struct {
		Period string `json:"period"`
		Count  int64  `json:"count"`
	}

	query := database.DB.Model(&models.TrafficViolation{}).
		Where("timestamp >= ? AND timestamp <= ?", startTime, endTime)

	switch groupBy {
	case "hour":
		query.Select("DATE_TRUNC('hour', timestamp) as period, COUNT(*) as count").
			Group("period").
			Order("period ASC")
	case "day":
		query.Select("DATE_TRUNC('day', timestamp) as period, COUNT(*) as count").
			Group("period").
			Order("period ASC")
	case "week":
		query.Select("DATE_TRUNC('week', timestamp) as period, COUNT(*) as count").
			Group("period").
			Order("period ASC")
	case "month":
		query.Select("DATE_TRUNC('month', timestamp) as period, COUNT(*) as count").
			Group("period").
			Order("period ASC")
	default:
		query.Select("DATE_TRUNC('day', timestamp) as period, COUNT(*) as count").
			Group("period").
			Order("period ASC")
	}

	if err := query.Scan(&trends).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch trends"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"trends": trends})
}

// GetDevicePerformance handles GET /api/analytics/devices/performance
func GetDevicePerformance(c *gin.Context) {
	startTimeStr := c.Query("startTime")
	endTimeStr := c.Query("endTime")

	var startTime, endTime time.Time
	var err error

	if startTimeStr != "" {
		startTime, err = time.Parse(time.RFC3339, startTimeStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid startTime"})
			return
		}
	} else {
		startTime = time.Now().AddDate(0, 0, -7)
	}

	if endTimeStr != "" {
		endTime, err = time.Parse(time.RFC3339, endTimeStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid endTime"})
			return
		}
	} else {
		endTime = time.Now()
	}

	var performance []struct {
		DeviceID      string  `json:"deviceId"`
		DeviceName    string  `json:"deviceName"`
		ViolationCount int64  `json:"violationCount"`
		DetectionCount int64  `json:"detectionCount"`
		UptimePercent float64 `json:"uptimePercent"`
	}

	query := `
		SELECT 
			d.id as device_id,
			COALESCE(d.name, d.id) as device_name,
			COUNT(DISTINCT v.id) as violation_count,
			COUNT(DISTINCT vd.id) as detection_count,
			95.0 as uptime_percent
		FROM devices d
		LEFT JOIN traffic_violations v ON v.device_id = d.id AND v.timestamp >= ? AND v.timestamp <= ?
		LEFT JOIN vehicle_detections vd ON vd.device_id = d.id AND vd.timestamp >= ? AND vd.timestamp <= ?
		GROUP BY d.id, d.name
		ORDER BY violation_count DESC
	`

	if err := database.DB.Raw(query, startTime, endTime, startTime, endTime).Scan(&performance).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch device performance"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"performance": performance})
}

// GetViolationHotspots handles GET /api/analytics/hotspots
func GetViolationHotspots(c *gin.Context) {
	startTimeStr := c.Query("startTime")
	endTimeStr := c.Query("endTime")

	var startTime, endTime time.Time
	var err error

	if startTimeStr != "" {
		startTime, err = time.Parse(time.RFC3339, startTimeStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid startTime"})
			return
		}
	} else {
		startTime = time.Now().AddDate(0, 0, -7)
	}

	if endTimeStr != "" {
		endTime, err = time.Parse(time.RFC3339, endTimeStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid endTime"})
			return
		}
	} else {
		endTime = time.Now()
	}

	var hotspots []struct {
		DeviceID    string  `json:"deviceId"`
		DeviceName  string  `json:"deviceName"`
		Lat         float64 `json:"lat"`
		Lng         float64 `json:"lng"`
		ViolationCount int64 `json:"violationCount"`
		Severity    string  `json:"severity"`
	}

	query := `
		SELECT 
			d.id as device_id,
			COALESCE(d.name, d.id) as device_name,
			d.lat,
			d.lng,
			COUNT(v.id) as violation_count,
			CASE
				WHEN COUNT(v.id) > 100 THEN 'HIGH'
				WHEN COUNT(v.id) > 50 THEN 'MEDIUM'
				ELSE 'LOW'
			END as severity
		FROM devices d
		LEFT JOIN traffic_violations v ON v.device_id = d.id AND v.timestamp >= ? AND v.timestamp <= ?
		WHERE d.lat != 0 AND d.lng != 0
		GROUP BY d.id, d.name, d.lat, d.lng
		HAVING COUNT(v.id) > 0
		ORDER BY violation_count DESC
		LIMIT 50
	`

	if err := database.DB.Raw(query, startTime, endTime).Scan(&hotspots).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch hotspots"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"hotspots": hotspots})
}

// ComparePeriods handles GET /api/analytics/compare
func ComparePeriods(c *gin.Context) {
	period1StartStr := c.Query("period1Start")
	period1EndStr := c.Query("period1End")
	period2StartStr := c.Query("period2Start")
	period2EndStr := c.Query("period2End")

	var period1Start, period1End, period2Start, period2End time.Time
	var err error

	if period1StartStr != "" && period1EndStr != "" {
		period1Start, err = time.Parse(time.RFC3339, period1StartStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid period1Start"})
			return
		}
		period1End, err = time.Parse(time.RFC3339, period1EndStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid period1End"})
			return
		}
	} else {
		// Default: compare last 7 days with previous 7 days
		period1End = time.Now()
		period1Start = period1End.AddDate(0, 0, -7)
		period2End = period1Start
		period2Start = period2End.AddDate(0, 0, -7)
	}

	if period2StartStr != "" && period2EndStr != "" {
		period2Start, err = time.Parse(time.RFC3339, period2StartStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid period2Start"})
			return
		}
		period2End, err = time.Parse(time.RFC3339, period2EndStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid period2End"})
			return
		}
	}

	var period1Count, period2Count int64
	database.DB.Model(&models.TrafficViolation{}).
		Where("timestamp >= ? AND timestamp <= ?", period1Start, period1End).
		Count(&period1Count)
	database.DB.Model(&models.TrafficViolation{}).
		Where("timestamp >= ? AND timestamp <= ?", period2Start, period2End).
		Count(&period2Count)

	var changePercent float64
	if period2Count > 0 {
		changePercent = ((float64(period1Count) - float64(period2Count)) / float64(period2Count)) * 100
	}

	c.JSON(http.StatusOK, gin.H{
		"period1": gin.H{
			"start": period1Start,
			"end":   period1End,
			"count": period1Count,
		},
		"period2": gin.H{
			"start": period2Start,
			"end":   period2End,
			"count": period2Count,
		},
		"changePercent": changePercent,
	})
}

