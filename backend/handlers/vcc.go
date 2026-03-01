package handlers

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/irisdrone/backend/database"
	"github.com/irisdrone/backend/models"
)

// GetVCCStats handles GET /api/vcc/stats - Vehicle Classification and Counting statistics
func GetVCCStats(c *gin.Context) {
	// Parse time range
	startTime := time.Now().AddDate(0, 0, -7) // Default: last 7 days
	endTime := time.Now()

	if startTimeStr := c.Query("startTime"); startTimeStr != "" {
		if parsed, err := time.Parse(time.RFC3339, startTimeStr); err == nil {
			startTime = parsed
		}
	}
	if endTimeStr := c.Query("endTime"); endTimeStr != "" {
		if parsed, err := time.Parse(time.RFC3339, endTimeStr); err == nil {
			endTime = parsed
		}
	}

	// Group by time period
	groupBy := c.DefaultQuery("groupBy", "hour") // hour, day, week, month

	var stats struct {
		TotalDetections   int64                        `json:"totalDetections"`
		UniqueVehicles    int64                        `json:"uniqueVehicles"`
		ByVehicleType    map[string]int64             `json:"byVehicleType"`
		ByTime           []map[string]interface{}     `json:"byTime"`
		ByDevice         []map[string]interface{}      `json:"byDevice"`
		ByHour           map[int]int64                `json:"byHour"`      // 0-23 hour distribution
		ByDayOfWeek      map[string]int64              `json:"byDayOfWeek"` // Mon-Sun
		PeakHour         int                           `json:"peakHour"`
		PeakDay          string                        `json:"peakDay"`
		AveragePerHour   float64                       `json:"averagePerHour"`
		Classification   map[string]interface{}        `json:"classification"`
	}

	stats.ByVehicleType = make(map[string]int64)
	stats.ByHour = make(map[int]int64)
	stats.ByDayOfWeek = make(map[string]int64)

	// Total detections in time range
	database.DB.Model(&models.VehicleDetection{}).
		Where("timestamp >= ? AND timestamp <= ?", startTime, endTime).
		Count(&stats.TotalDetections)

	// Unique vehicles detected
	database.DB.Model(&models.VehicleDetection{}).
		Where("timestamp >= ? AND timestamp <= ? AND vehicle_id IS NOT NULL", startTime, endTime).
		Distinct("vehicle_id").
		Count(&stats.UniqueVehicles)

	// Count by vehicle type
	var typeCounts []struct {
		VehicleType string
		Count       int64
	}
	database.DB.Model(&models.VehicleDetection{}).
		Select("vehicle_type, COUNT(*) as count").
		Where("timestamp >= ? AND timestamp <= ?", startTime, endTime).
		Group("vehicle_type").
		Scan(&typeCounts)

	for _, tc := range typeCounts {
		stats.ByVehicleType[tc.VehicleType] = tc.Count
	}

	// Count by time period (hourly, daily, etc.)
	var timeTrunc string
	var timeLabel string
	var timeFormat string
	switch groupBy {
	case "hour":
		timeTrunc = "hour"
		timeLabel = "hour"
		timeFormat = "YYYY-MM-DD HH24:00"
	case "day":
		timeTrunc = "day"
		timeLabel = "day"
		timeFormat = "YYYY-MM-DD"
	case "week":
		timeTrunc = "week"
		timeLabel = "week"
		timeFormat = "IYYY-\"W\"IW"
	case "month":
		timeTrunc = "month"
		timeLabel = "month"
		timeFormat = "YYYY-MM"
	default:
		timeTrunc = "hour"
		timeLabel = "hour"
		timeFormat = "YYYY-MM-DD HH24:00"
	}

	var timeCounts []struct {
		TimePeriod string
		Count      int64
	}
	
	// PostgreSQL: Use DATE_TRUNC for grouping, then format for display
	// This is safer than using TO_CHAR with parameters
	query := fmt.Sprintf(`
		SELECT TO_CHAR(DATE_TRUNC('%s', timestamp), '%s') as time_period, COUNT(*) as count
		FROM vehicle_detections
		WHERE timestamp >= $1 AND timestamp <= $2
		GROUP BY DATE_TRUNC('%s', timestamp)
		ORDER BY DATE_TRUNC('%s', timestamp)
	`, timeTrunc, timeFormat, timeTrunc, timeTrunc)
	
	database.DB.Raw(query, startTime, endTime).Scan(&timeCounts)

	stats.ByTime = make([]map[string]interface{}, len(timeCounts))
	for i, tc := range timeCounts {
		stats.ByTime[i] = map[string]interface{}{
			timeLabel: tc.TimePeriod,
			"count":   tc.Count,
		}
	}

	// Count by device
	var deviceCounts []struct {
		DeviceID string
		DeviceName string
		Count    int64
	}
	database.DB.Model(&models.VehicleDetection{}).
		Select("vehicle_detections.device_id, devices.name as device_name, COUNT(*) as count").
		Joins("LEFT JOIN devices ON vehicle_detections.device_id = devices.id").
		Where("vehicle_detections.timestamp >= ? AND vehicle_detections.timestamp <= ?", startTime, endTime).
		Group("vehicle_detections.device_id, devices.name").
		Order("count DESC").
		Limit(20).
		Scan(&deviceCounts)

	stats.ByDevice = make([]map[string]interface{}, len(deviceCounts))
	for i, dc := range deviceCounts {
		stats.ByDevice[i] = map[string]interface{}{
			"deviceId":   dc.DeviceID,
			"deviceName": dc.DeviceName,
			"count":      dc.Count,
		}
	}

	// Hourly distribution (0-23)
	var hourCounts []struct {
		Hour  int
		Count int64
	}
	database.DB.Raw(`
		SELECT EXTRACT(HOUR FROM timestamp)::int as hour, COUNT(*) as count
		FROM vehicle_detections
		WHERE timestamp >= ? AND timestamp <= ?
		GROUP BY EXTRACT(HOUR FROM timestamp)
		ORDER BY hour
	`, startTime, endTime).Scan(&hourCounts)

	for _, hc := range hourCounts {
		stats.ByHour[int(hc.Hour)] = hc.Count
	}

	// Find peak hour
	maxHourCount := int64(0)
	for hour, count := range stats.ByHour {
		if count > maxHourCount {
			maxHourCount = count
			stats.PeakHour = hour
		}
	}

	// Day of week distribution
	var dayCounts []struct {
		DayOfWeek string
		Count     int64
	}
	database.DB.Raw(`
		SELECT TO_CHAR(timestamp, 'Day') as day_of_week, COUNT(*) as count
		FROM vehicle_detections
		WHERE timestamp >= ? AND timestamp <= ?
		GROUP BY TO_CHAR(timestamp, 'Day')
		ORDER BY count DESC
	`, startTime, endTime).Scan(&dayCounts)

	for _, dc := range dayCounts {
		dayName := strings.TrimSpace(dc.DayOfWeek)
		stats.ByDayOfWeek[dayName] = dc.Count
	}

	// Find peak day
	maxDayCount := int64(0)
	for day, count := range stats.ByDayOfWeek {
		if count > maxDayCount {
			maxDayCount = count
			stats.PeakDay = day
		}
	}

	// Calculate average per hour
	hoursDiff := endTime.Sub(startTime).Hours()
	if hoursDiff > 0 {
		stats.AveragePerHour = float64(stats.TotalDetections) / hoursDiff
	}

	// Classification breakdown
	stats.Classification = map[string]interface{}{
		"withPlates": 0,
		"withoutPlates": 0,
		"withMakeModel": 0,
		"plateOnly": 0,
		"fullClassification": 0,
	}

	var withPlates, withoutPlates, withMakeModel int64
	database.DB.Model(&models.VehicleDetection{}).
		Where("timestamp >= ? AND timestamp <= ? AND plate_detected = ?", startTime, endTime, true).
		Count(&withPlates)
	
	database.DB.Model(&models.VehicleDetection{}).
		Where("timestamp >= ? AND timestamp <= ? AND plate_detected = ?", startTime, endTime, false).
		Count(&withoutPlates)

	database.DB.Model(&models.VehicleDetection{}).
		Where("timestamp >= ? AND timestamp <= ? AND make_model_detected = ?", startTime, endTime, true).
		Count(&withMakeModel)

	stats.Classification["withPlates"] = withPlates
	stats.Classification["withoutPlates"] = withoutPlates
	stats.Classification["withMakeModel"] = withMakeModel
	stats.Classification["plateOnly"] = withPlates - withMakeModel
	stats.Classification["fullClassification"] = withMakeModel

	c.JSON(http.StatusOK, stats)
}

// GetVCCByDevice handles GET /api/vcc/device/:deviceId - VCC stats for specific device
func GetVCCByDevice(c *gin.Context) {
	deviceID := c.Param("deviceId")

	// Parse time range
	startTime := time.Now().AddDate(0, 0, -1) // Default: last 24 hours
	endTime := time.Now()

	if startTimeStr := c.Query("startTime"); startTimeStr != "" {
		if parsed, err := time.Parse(time.RFC3339, startTimeStr); err == nil {
			startTime = parsed
		}
	}
	if endTimeStr := c.Query("endTime"); endTimeStr != "" {
		if parsed, err := time.Parse(time.RFC3339, endTimeStr); err == nil {
			endTime = parsed
		}
	}

	var stats struct {
		DeviceID        string                `json:"deviceId"`
		DeviceName      string                `json:"deviceName"`
		TotalDetections int64                 `json:"totalDetections"`
		UniqueVehicles  int64                 `json:"uniqueVehicles"`
		ByVehicleType   map[string]int64      `json:"byVehicleType"`
		ByHour          map[int]int64         `json:"byHour"`
		PeakHour        int                   `json:"peakHour"`
		AveragePerHour  float64               `json:"averagePerHour"`
		Classification  map[string]interface{} `json:"classification"`
	}

	stats.ByVehicleType = make(map[string]int64)
	stats.ByHour = make(map[int]int64)

	// Get device info
	var device models.Device
	if err := database.DB.First(&device, "id = ?", deviceID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Device not found"})
		return
	}

	stats.DeviceID = device.ID
	if device.Name != nil {
		stats.DeviceName = *device.Name
	}

	// Total detections
	database.DB.Model(&models.VehicleDetection{}).
		Where("device_id = ? AND timestamp >= ? AND timestamp <= ?", deviceID, startTime, endTime).
		Count(&stats.TotalDetections)

	// Unique vehicles
	database.DB.Model(&models.VehicleDetection{}).
		Where("device_id = ? AND timestamp >= ? AND timestamp <= ? AND vehicle_id IS NOT NULL", deviceID, startTime, endTime).
		Distinct("vehicle_id").
		Count(&stats.UniqueVehicles)

	// By vehicle type
	var typeCounts []struct {
		VehicleType string
		Count       int64
	}
	database.DB.Model(&models.VehicleDetection{}).
		Select("vehicle_type, COUNT(*) as count").
		Where("device_id = ? AND timestamp >= ? AND timestamp <= ?", deviceID, startTime, endTime).
		Group("vehicle_type").
		Scan(&typeCounts)

	for _, tc := range typeCounts {
		stats.ByVehicleType[tc.VehicleType] = tc.Count
	}

	// Hourly distribution
	var hourCounts []struct {
		Hour  int
		Count int64
	}
	database.DB.Raw(`
		SELECT EXTRACT(HOUR FROM timestamp)::int as hour, COUNT(*) as count
		FROM vehicle_detections
		WHERE device_id = ? AND timestamp >= ? AND timestamp <= ?
		GROUP BY EXTRACT(HOUR FROM timestamp)
		ORDER BY hour
	`, deviceID, startTime, endTime).Scan(&hourCounts)

	for _, hc := range hourCounts {
		stats.ByHour[int(hc.Hour)] = hc.Count
	}

	// Peak hour
	maxHourCount := int64(0)
	for hour, count := range stats.ByHour {
		if count > maxHourCount {
			maxHourCount = count
			stats.PeakHour = hour
		}
	}

	// Average per hour
	hoursDiff := endTime.Sub(startTime).Hours()
	if hoursDiff > 0 {
		stats.AveragePerHour = float64(stats.TotalDetections) / hoursDiff
	}

	// Classification
	var withPlates, withMakeModel int64
	database.DB.Model(&models.VehicleDetection{}).
		Where("device_id = ? AND timestamp >= ? AND timestamp <= ? AND plate_detected = ?", deviceID, startTime, endTime, true).
		Count(&withPlates)

	database.DB.Model(&models.VehicleDetection{}).
		Where("device_id = ? AND timestamp >= ? AND timestamp <= ? AND make_model_detected = ?", deviceID, startTime, endTime, true).
		Count(&withMakeModel)

	stats.Classification = map[string]interface{}{
		"withPlates":          withPlates,
		"withoutPlates":       stats.TotalDetections - withPlates,
		"withMakeModel":       withMakeModel,
		"plateOnly":           withPlates - withMakeModel,
		"fullClassification": withMakeModel,
	}

	c.JSON(http.StatusOK, stats)
}

// GetVCCRealtime handles GET /api/vcc/realtime - Real-time vehicle counts
func GetVCCRealtime(c *gin.Context) {
	// Last 5 minutes
	startTime := time.Now().Add(-5 * time.Minute)
	endTime := time.Now()

	var stats struct {
		TotalDetections int64                `json:"totalDetections"`
		ByVehicleType   map[string]int64     `json:"byVehicleType"`
		ByDevice        []map[string]interface{} `json:"byDevice"`
		PerMinute       float64              `json:"perMinute"`
	}

	stats.ByVehicleType = make(map[string]int64)

	// Total in last 5 minutes
	database.DB.Model(&models.VehicleDetection{}).
		Where("timestamp >= ? AND timestamp <= ?", startTime, endTime).
		Count(&stats.TotalDetections)

	// By vehicle type
	var typeCounts []struct {
		VehicleType string
		Count       int64
	}
	database.DB.Model(&models.VehicleDetection{}).
		Select("vehicle_type, COUNT(*) as count").
		Where("timestamp >= ? AND timestamp <= ?", startTime, endTime).
		Group("vehicle_type").
		Scan(&typeCounts)

	for _, tc := range typeCounts {
		stats.ByVehicleType[tc.VehicleType] = tc.Count
	}

	// By device (top 10)
	var deviceCounts []struct {
		DeviceID   string
		DeviceName string
		Count      int64
	}
	database.DB.Model(&models.VehicleDetection{}).
		Select("vehicle_detections.device_id, devices.name as device_name, COUNT(*) as count").
		Joins("LEFT JOIN devices ON vehicle_detections.device_id = devices.id").
		Where("vehicle_detections.timestamp >= ? AND vehicle_detections.timestamp <= ?", startTime, endTime).
		Group("vehicle_detections.device_id, devices.name").
		Order("count DESC").
		Limit(10).
		Scan(&deviceCounts)

	stats.ByDevice = make([]map[string]interface{}, len(deviceCounts))
	for i, dc := range deviceCounts {
		stats.ByDevice[i] = map[string]interface{}{
			"deviceId":   dc.DeviceID,
			"deviceName": dc.DeviceName,
			"count":      dc.Count,
		}
	}

	stats.PerMinute = float64(stats.TotalDetections) / 5.0

	c.JSON(http.StatusOK, stats)
}

