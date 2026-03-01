package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/irisdrone/backend/database"
	"github.com/irisdrone/backend/models"
	"gorm.io/gorm"
)

// sendWhatsAppNotification sends a WhatsApp message via WASender API for an approved violation
func sendWhatsAppNotification(violation models.TrafficViolation) {
	plate := "UNKNOWN"
	if violation.PlateNumber != nil {
		plate = *violation.PlateNumber
	}

	vType := strings.ReplaceAll(string(violation.ViolationType), "_", " ")

	fineStr := "As per MV Act"
	if violation.FineAmount != nil {
		fineStr = fmt.Sprintf("₹%.0f", *violation.FineAmount)
	}

	msg := fmt.Sprintf(`⚠️ *MANGALORE CITY TRAFFIC POLICE* ⚠️
━━━━━━━━━━━━━━━━━━━━━━
*TRAFFIC VIOLATION NOTICE*
━━━━━━━━━━━━━━━━━━━━━━

*Ref No:* MNG/TV/%d
*Date:* %s
*Vehicle No:* %s
*Violation:* %s
*Fine Amount:* %s
*Detection:* AI-Based Surveillance System

Dear Vehicle Owner,

A traffic violation has been recorded and verified against your vehicle *%s* by the Mangalore City Traffic Police AI Surveillance System.

You are hereby directed to pay the penalty amount at the nearest traffic police station or online within *15 days* from the date of this notice.

Failure to pay the fine may result in further legal action under the Motor Vehicles Act, 1988.

📍 *Office of the Commissioner of Police*
Mangalore City, Karnataka

📞 Helpline: 0824-2220500
🌐 Online Payment: https://ksp.karnataka.gov.in

_This is a system-generated message. Do not reply._
━━━━━━━━━━━━━━━━━━━━━━`,
		violation.ID,
		violation.Timestamp.Format("02-Jan-2006 03:04 PM"),
		plate,
		vType,
		fineStr,
		plate,
	)

	// Send violation notice to the violator
	sendWASenderMessage("+917218289793", msg)
	log.Printf("WhatsApp violation notice sent for violation %d", violation.ID)

	// Send acknowledgement to admin
	ackMsg := fmt.Sprintf(`✅ *Violation Notice Sent*

Ref: MNG/TV/%d
Vehicle: %s
Violation: %s
Time: %s

WhatsApp notice has been dispatched to the vehicle owner.`,
		violation.ID,
		plate,
		vType,
		violation.Timestamp.Format("02-Jan-2006 03:04 PM"),
	)
	sendWASenderMessage("+918097476656", ackMsg)
	log.Printf("WhatsApp acknowledgement sent for violation %d", violation.ID)
}

// sendWASenderMessage sends a WhatsApp text message to the given number via WASender API
func sendWASenderMessage(to string, text string) {
	wasenderToken := os.Getenv("WASENDER_API_TOKEN")
	if wasenderToken == "" {
		log.Printf("WASENDER_API_TOKEN not set; skipping WhatsApp notification to %s", to)
		return
	}

	body, _ := json.Marshal(map[string]string{
		"to":   to,
		"text": text,
	})

	req, err := http.NewRequest("POST", "https://www.wasenderapi.com/api/send-message", bytes.NewBuffer(body))
	if err != nil {
		log.Printf("WhatsApp send error (%s): %v", to, err)
		return
	}
	req.Header.Set("Authorization", "Bearer "+wasenderToken)
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("WhatsApp send error (%s): %v", to, err)
		return
	}
	defer resp.Body.Close()
	log.Printf("WhatsApp message sent to %s, status: %d", to, resp.StatusCode)
}

// PostViolation handles POST /api/violations - Ingest violation from edge worker
func PostViolation(c *gin.Context) {
	var req struct {
		DeviceID        string                 `json:"deviceId" binding:"required"`
		ViolationType   models.ViolationType   `json:"violationType" binding:"required"`
		DetectionMethod models.DetectionMethod `json:"detectionMethod"`
		PlateNumber     *string                `json:"plateNumber"`
		PlateConfidence *float64               `json:"plateConfidence"`
		PlateImageURL   *string                `json:"plateImageUrl"`
		FullSnapshotURL *string                `json:"fullSnapshotUrl"`
		FrameID         *string                `json:"frameId"`
		DetectedSpeed   *float64               `json:"detectedSpeed"`
		SpeedLimit2W    *float64               `json:"speedLimit2W"`
		SpeedLimit4W    *float64               `json:"speedLimit4W"`
		SpeedOverLimit  *float64               `json:"speedOverLimit"`
		Confidence      *float64               `json:"confidence"`
		Video           *string                `json:"video"`
		Metadata        models.JSONB           `json:"metadata"`
		Timestamp       *string                `json:"timestamp"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	// Upsert device - create if not exists
	device := models.Device{
		ID:     req.DeviceID,
		Type:   models.DeviceTypeCamera, // Default to camera
		Status: "active",
	}

	// Try to extract lat/lng from metadata if available
	if req.Metadata.Data != nil {
		if dataMap, ok := req.Metadata.Data.(map[string]interface{}); ok {
			if lat, ok := dataMap["lat"].(float64); ok {
				device.Lat = lat
			}
			if lng, ok := dataMap["lng"].(float64); ok {
				device.Lng = lng
			}
		}
	}

	// Set default name if not provided
	if device.Name == nil {
		name := "Camera " + req.DeviceID
		device.Name = &name
	}

	// Create or update device
	if err := database.DB.Where("id = ?", req.DeviceID).
		Assign(models.Device{
			UpdatedAt: time.Now(),
		}).
		FirstOrCreate(&device).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to upsert device"})
		return
	}

	// Try to link to vehicle if plate number is provided
	var vehicleID *int64
	if req.PlateNumber != nil && *req.PlateNumber != "" {
		var vehicle models.Vehicle
		err := database.DB.Where("plate_number = ?", *req.PlateNumber).First(&vehicle).Error
		if err == nil {
			vehicleID = &vehicle.ID
		}
	}

	detectionMethod := req.DetectionMethod
	if detectionMethod == "" {
		detectionMethod = models.DetectionAIVision
	}

	timestamp := time.Now()
	if req.Timestamp != nil {
		if parsed, err := time.Parse(time.RFC3339, *req.Timestamp); err == nil {
			timestamp = parsed
		}
	}

	violation := models.TrafficViolation{
		DeviceID:        req.DeviceID,
		VehicleID:       vehicleID, // Link to vehicle if found
		ViolationType:   req.ViolationType,
		Status:          models.ViolationPending,
		DetectionMethod: detectionMethod,
		PlateNumber:     req.PlateNumber,
		PlateConfidence: req.PlateConfidence,
		PlateImageURL:   req.PlateImageURL,
		FullSnapshotURL: req.FullSnapshotURL,
		FrameID:         req.FrameID,
		Video:           req.Video,
		DetectedSpeed:   req.DetectedSpeed,
		SpeedLimit2W:    req.SpeedLimit2W,
		SpeedLimit4W:    req.SpeedLimit4W,
		SpeedOverLimit:  req.SpeedOverLimit,
		Confidence:      req.Confidence,
		Metadata:        req.Metadata,
		Timestamp:       timestamp,
	}

	if err := database.DB.Create(&violation).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create violation"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"success": true, "id": strconv.FormatInt(violation.ID, 10)})
}

// GetViolations handles GET /api/violations - List violations with filters
func GetViolations(c *gin.Context) {
	query := database.DB.Model(&models.TrafficViolation{})

	// Optional: filter by id
	if idStr := c.Query("id"); idStr != "" {
		id, err := strconv.ParseInt(idStr, 10, 64)
		if err != nil || id <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid id"})
			return
		}
		query = query.Where("id = ?", id)
	}

	// Filter by status
	if status := c.Query("status"); status != "" {
		status = strings.ToUpper(strings.TrimSpace(status))
		switch models.ViolationStatus(status) {
		case models.ViolationPending, models.ViolationApproved, models.ViolationRejected, models.ViolationFined:
			query = query.Where("status = ?", status)
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid status"})
			return
		}
	}

	// Filter by violation type
	if violationType := c.Query("violationType"); violationType != "" {
		violationType = strings.ToUpper(strings.TrimSpace(violationType))
		switch models.ViolationType(violationType) {
		case models.ViolationSpeed, models.ViolationHelmet, models.ViolationWrongSide, models.ViolationRedLight,
			models.ViolationNoSeatbelt, models.ViolationOverloading, models.ViolationIllegalParking,
			models.ViolationTripleRiding, models.ViolationOther:
			query = query.Where("violation_type = ?", violationType)
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid violationType"})
			return
		}
	}

	// Filter by device
	if deviceID := c.Query("deviceId"); deviceID != "" {
		deviceID = strings.TrimSpace(deviceID)
		if len(deviceID) > 64 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid deviceId"})
			return
		}
		query = query.Where("device_id = ?", deviceID)
	}

	// Filter by plate number
	if plateNumber := c.Query("plateNumber"); plateNumber != "" {
		plateNumber = strings.TrimSpace(plateNumber)
		if len(plateNumber) > 32 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid plateNumber"})
			return
		}
		query = query.Where("plate_number ILIKE ?", "%"+plateNumber+"%")
	}

	// Filter by date range
	if startTime := c.Query("startTime"); startTime != "" {
		parsed, err := time.Parse(time.RFC3339, startTime)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid startTime"})
			return
		}
		query = query.Where("timestamp >= ?", parsed)
	}
	if endTime := c.Query("endTime"); endTime != "" {
		parsed, err := time.Parse(time.RFC3339, endTime)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid endTime"})
			return
		}
		query = query.Where("timestamp <= ?", parsed)
	}

	// Sorting (allowlist)
	sortCol := "timestamp"
	if sort := strings.TrimSpace(c.Query("sort")); sort != "" {
		switch strings.ToLower(sort) {
		case "timestamp":
			sortCol = "timestamp"
		case "id":
			sortCol = "id"
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid sort"})
			return
		}
	}
	sortOrder := "desc"
	if order := strings.TrimSpace(c.Query("order")); order != "" {
		switch strings.ToLower(order) {
		case "asc", "desc":
			sortOrder = strings.ToLower(order)
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid order"})
			return
		}
	}

	// Pagination
	limit := 50
	if limitStr := c.Query("limit"); limitStr != "" {
		parsed, err := strconv.Atoi(limitStr)
		if err != nil || parsed <= 0 || parsed > 200 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid limit"})
			return
		}
		limit = parsed
	}
	offset := 0
	if offsetStr := c.Query("offset"); offsetStr != "" {
		parsed, err := strconv.Atoi(offsetStr)
		if err != nil || parsed < 0 || parsed > 100000 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid offset"})
			return
		}
		offset = parsed
	}

	var violations []models.TrafficViolation
	var total int64

	// Get total count
	query.Model(&models.TrafficViolation{}).Count(&total)

	// Get violations
	if err := query.Preload("Device", func(db *gorm.DB) *gorm.DB {
		return db.Select("id, name, lat, lng, type")
	}).Order(sortCol + " " + sortOrder).Limit(limit).Offset(offset).Find(&violations).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch violations"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"violations": violations,
		"total":      total,
		"limit":      limit,
		"offset":     offset,
	})
}

// GetViolation handles GET /api/violations/:id - Get single violation
func GetViolation(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid violation ID"})
		return
	}

	var violation models.TrafficViolation
	if err := database.DB.Preload("Device").First(&violation, id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Violation not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch violation"})
		return
	}

	c.JSON(http.StatusOK, violation)
}

// ApproveViolation handles PATCH /api/violations/:id/approve
func ApproveViolation(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid violation ID"})
		return
	}

	var req struct {
		ReviewNote *string `json:"reviewNote"`
		ReviewedBy *string `json:"reviewedBy"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		// Optional body, continue without it
	}

	now := time.Now()
	updates := map[string]interface{}{
		"status":      models.ViolationApproved,
		"reviewed_at": now,
	}
	if req.ReviewNote != nil {
		updates["review_note"] = *req.ReviewNote
	}
	if req.ReviewedBy != nil {
		updates["reviewed_by"] = *req.ReviewedBy
	}

	if err := database.DB.Model(&models.TrafficViolation{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Violation not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to approve violation"})
		return
	}

	var violation models.TrafficViolation
	database.DB.First(&violation, id)

	// Send WhatsApp notification asynchronously
	go sendWhatsAppNotification(violation)

	c.JSON(http.StatusOK, violation)
}

// RejectViolation handles PATCH /api/violations/:id/reject
func RejectViolation(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid violation ID"})
		return
	}

	var req struct {
		RejectionReason string  `json:"rejectionReason" binding:"required"`
		ReviewedBy      *string `json:"reviewedBy"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "rejectionReason is required"})
		return
	}

	now := time.Now()
	updates := map[string]interface{}{
		"status":           models.ViolationRejected,
		"reviewed_at":      now,
		"rejection_reason": req.RejectionReason,
	}
	if req.ReviewedBy != nil {
		updates["reviewed_by"] = *req.ReviewedBy
	}

	if err := database.DB.Model(&models.TrafficViolation{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Violation not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to reject violation"})
		return
	}

	var violation models.TrafficViolation
	database.DB.First(&violation, id)
	c.JSON(http.StatusOK, violation)
}

// UpdateViolationPlate handles PATCH /api/violations/:id/plate - Update plate number
func UpdateViolationPlate(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid violation ID"})
		return
	}

	var req struct {
		PlateNumber string `json:"plateNumber" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "plateNumber is required"})
		return
	}

	if err := database.DB.Model(&models.TrafficViolation{}).Where("id = ?", id).Update("plate_number", req.PlateNumber).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Violation not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update plate number"})
		return
	}

	var violation models.TrafficViolation
	database.DB.First(&violation, id)
	c.JSON(http.StatusOK, violation)
}

// GetViolationStats handles GET /api/violations/stats - Get violation statistics
func GetViolationStats(c *gin.Context) {
	// Parse time range (optional)
	var startTime *time.Time
	var endTime *time.Time

	if startTimeStr := c.Query("startTime"); startTimeStr != "" {
		if parsed, err := time.Parse(time.RFC3339, startTimeStr); err == nil {
			startTime = &parsed
		}
	}
	if endTimeStr := c.Query("endTime"); endTimeStr != "" {
		if parsed, err := time.Parse(time.RFC3339, endTimeStr); err == nil {
			endTime = &parsed
		}
	}

	// Build base query with optional time range
	baseQuery := database.DB.Model(&models.TrafficViolation{})
	if startTime != nil {
		baseQuery = baseQuery.Where("timestamp >= ?", *startTime)
	}
	if endTime != nil {
		baseQuery = baseQuery.Where("timestamp <= ?", *endTime)
	}

	var stats struct {
		Total    int64                    `json:"total"`
		Pending  int64                    `json:"pending"`
		Approved int64                    `json:"approved"`
		Rejected int64                    `json:"rejected"`
		Fined    int64                    `json:"fined"`
		ByType   map[string]int64         `json:"byType"`
		ByDevice map[string]int64         `json:"byDevice"`
		ByHour   map[int]int64            `json:"byHour"` // 0-23 hour distribution
		ByTime   []map[string]interface{} `json:"byTime"` // For trendline visualization
	}

	stats.ByType = make(map[string]int64)
	stats.ByDevice = make(map[string]int64)
	stats.ByHour = make(map[int]int64)

	// Get counts by status
	baseQuery.Count(&stats.Total)
	baseQuery.Where("status = ?", models.ViolationPending).Count(&stats.Pending)
	baseQuery.Where("status = ?", models.ViolationApproved).Count(&stats.Approved)
	baseQuery.Where("status = ?", models.ViolationRejected).Count(&stats.Rejected)
	baseQuery.Where("status = ?", models.ViolationFined).Count(&stats.Fined)

	// Get counts by type using raw SQL
	var typeCounts []struct {
		ViolationType string `gorm:"column:violation_type"`
		Count         int64  `gorm:"column:count"`
	}

	// Build WHERE clause for raw query
	whereClause := "1=1"
	var args []interface{}
	if startTime != nil {
		whereClause += " AND timestamp >= ?"
		args = append(args, *startTime)
	}
	if endTime != nil {
		whereClause += " AND timestamp <= ?"
		args = append(args, *endTime)
	}

	database.DB.Raw(`
		SELECT 
			COALESCE(NULLIF(violation_type, ''), 'OTHER') as violation_type,
			COUNT(*) as count
		FROM traffic_violations
		WHERE `+whereClause+`
		GROUP BY COALESCE(NULLIF(violation_type, ''), 'OTHER')
	`, args...).Scan(&typeCounts)

	for _, tc := range typeCounts {
		violationType := tc.ViolationType
		if violationType == "" {
			violationType = "OTHER"
		}
		stats.ByType[violationType] = tc.Count
	}

	// Get counts by device using raw SQL
	var deviceCounts []struct {
		DeviceID string `gorm:"column:device_id"`
		Count    int64  `gorm:"column:count"`
	}

	database.DB.Raw(`
		SELECT 
			device_id,
			COUNT(*) as count
		FROM traffic_violations
		WHERE `+whereClause+`
		GROUP BY device_id
	`, args...).Scan(&deviceCounts)

	for _, dc := range deviceCounts {
		if dc.DeviceID != "" {
			stats.ByDevice[dc.DeviceID] = dc.Count
		}
	}

	// Get hourly distribution (0-23)
	var hourCounts []struct {
		Hour  int
		Count int64
	}

	// Build SQL query with proper time filtering
	if startTime != nil && endTime != nil {
		database.DB.Raw(`
			SELECT EXTRACT(HOUR FROM timestamp)::int as hour, COUNT(*) as count
			FROM traffic_violations
			WHERE timestamp >= ? AND timestamp <= ?
			GROUP BY EXTRACT(HOUR FROM timestamp)
			ORDER BY hour
		`, *startTime, *endTime).Scan(&hourCounts)
	} else if startTime != nil {
		database.DB.Raw(`
			SELECT EXTRACT(HOUR FROM timestamp)::int as hour, COUNT(*) as count
			FROM traffic_violations
			WHERE timestamp >= ?
			GROUP BY EXTRACT(HOUR FROM timestamp)
			ORDER BY hour
		`, *startTime).Scan(&hourCounts)
	} else if endTime != nil {
		database.DB.Raw(`
			SELECT EXTRACT(HOUR FROM timestamp)::int as hour, COUNT(*) as count
			FROM traffic_violations
			WHERE timestamp <= ?
			GROUP BY EXTRACT(HOUR FROM timestamp)
			ORDER BY hour
		`, *endTime).Scan(&hourCounts)
	} else {
		database.DB.Raw(`
			SELECT EXTRACT(HOUR FROM timestamp)::int as hour, COUNT(*) as count
			FROM traffic_violations
			GROUP BY EXTRACT(HOUR FROM timestamp)
			ORDER BY hour
		`).Scan(&hourCounts)
	}

	for _, hc := range hourCounts {
		stats.ByHour[hc.Hour] = hc.Count
	}

	// Build byTime array for trendline (hourly data)
	stats.ByTime = make([]map[string]interface{}, 0)
	for hour := 0; hour < 24; hour++ {
		count := stats.ByHour[hour]
		stats.ByTime = append(stats.ByTime, map[string]interface{}{
			"hour":  hour,
			"count": count,
		})
	}

	c.JSON(http.StatusOK, stats)
}

// BulkUpdateViolations handles PATCH /api/violations/bulk
func BulkUpdateViolations(c *gin.Context) {
	var req struct {
		IDs    []int64 `json:"ids" binding:"required"`
		Action string  `json:"action" binding:"required"` // "approve" or "reject"
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	if req.Action != "approve" && req.Action != "reject" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Action must be 'approve' or 'reject'"})
		return
	}

	var status models.ViolationStatus
	if req.Action == "approve" {
		status = models.ViolationApproved
	} else {
		status = models.ViolationRejected
	}

	if err := database.DB.Model(&models.TrafficViolation{}).
		Where("id IN ?", req.IDs).
		Update("status", status).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update violations"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "updated": len(req.IDs)})
}

// ExportViolations handles GET /api/violations/export
func ExportViolations(c *gin.Context) {
	var violations []models.TrafficViolation
	query := database.DB.Model(&models.TrafficViolation{})

	// Apply filters
	if status := c.Query("status"); status != "" {
		query = query.Where("status = ?", status)
	}
	if violationType := c.Query("violationType"); violationType != "" {
		query = query.Where("violation_type = ?", violationType)
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

	limit := 1000
	if limitStr := c.Query("limit"); limitStr != "" {
		if parsed, err := strconv.Atoi(limitStr); err == nil && parsed > 0 && parsed <= 10000 {
			limit = parsed
		}
	}

	if err := query.Limit(limit).Order("timestamp DESC").Find(&violations).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to export violations"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"violations": violations, "count": len(violations)})
}
