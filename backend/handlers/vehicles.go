package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/irisdrone/backend/database"
	"github.com/irisdrone/backend/models"
	"gorm.io/gorm"
)

// PostVehicleDetection handles POST /api/vehicles/detect - Ingest vehicle detection from camera
func PostVehicleDetection(c *gin.Context) {
	var req struct {
		DeviceID         string                 `json:"deviceId" binding:"required"`
		PlateNumber     *string                `json:"plateNumber"`
		PlateConfidence *float64               `json:"plateConfidence"`
		Make            *string               `json:"make"`
		Model           *string               `json:"model"`
		VehicleType     models.VehicleType    `json:"vehicleType"`
		Color           *string               `json:"color"`
		Confidence      *float64              `json:"confidence"`
		FullImageURL    *string               `json:"fullImageUrl"`
		PlateImageURL   *string               `json:"plateImageUrl"`
		VehicleImageURL *string               `json:"vehicleImageUrl"`
		FrameID         *string               `json:"frameId"`
		Direction       *string               `json:"direction"`
		Lane            *int                  `json:"lane"`
		Metadata        models.JSONB          `json:"metadata"`
		Timestamp       *string               `json:"timestamp"`
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

	timestamp := time.Now()
	if req.Timestamp != nil {
		if parsed, err := time.Parse(time.RFC3339, *req.Timestamp); err == nil {
			timestamp = parsed
		}
	}

	plateDetected := req.PlateNumber != nil && *req.PlateNumber != ""
	makeModelDetected := req.Make != nil || req.Model != nil

	// Create detection record
	detection := models.VehicleDetection{
		DeviceID:          req.DeviceID,
		Timestamp:        timestamp,
		PlateNumber:      req.PlateNumber,
		PlateConfidence:  req.PlateConfidence,
		Make:             req.Make,
		Model:            req.Model,
		VehicleType:      req.VehicleType,
		Color:            req.Color,
		Confidence:       req.Confidence,
		FullImageURL:     req.FullImageURL,
		PlateImageURL:    req.PlateImageURL,
		VehicleImageURL:  req.VehicleImageURL,
		FrameID:          req.FrameID,
		Direction:        req.Direction,
		Lane:             req.Lane,
		Metadata:         req.Metadata,
		PlateDetected:    plateDetected,
		MakeModelDetected: makeModelDetected,
	}

	// Try to find or create vehicle
	var vehicle *models.Vehicle
	if plateDetected && req.PlateNumber != nil {
		// Try to find existing vehicle by plate
		var existingVehicle models.Vehicle
		err := database.DB.Where("plate_number = ?", *req.PlateNumber).First(&existingVehicle).Error
		
		if err == nil {
			// Found existing vehicle - update it
			vehicle = &existingVehicle
			updates := map[string]interface{}{
				"last_seen":       timestamp,
				"detection_count": gorm.Expr("detection_count + 1"),
			}
			
			// Update vehicle info if we have better data
			if req.Make != nil && *req.Make != "" {
				updates["make"] = *req.Make
			}
			if req.Model != nil && *req.Model != "" {
				updates["model"] = *req.Model
			}
			if req.VehicleType != "" {
				updates["vehicle_type"] = req.VehicleType
			}
			if req.Color != nil && *req.Color != "" {
				updates["color"] = *req.Color
			}
			
			database.DB.Model(&existingVehicle).Updates(updates)
			detection.VehicleID = &vehicle.ID
		} else if err == gorm.ErrRecordNotFound {
			// Create new vehicle
			newVehicle := models.Vehicle{
				PlateNumber:    req.PlateNumber,
				Make:           req.Make,
				Model:          req.Model,
				VehicleType:    req.VehicleType,
				Color:          req.Color,
				FirstSeen:      timestamp,
				LastSeen:       timestamp,
				DetectionCount: 1,
				IsWatchlisted:  false,
			}
			
			if err := database.DB.Create(&newVehicle).Error; err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create vehicle"})
				return
			}
			vehicle = &newVehicle
			detection.VehicleID = &vehicle.ID
		}
	} else {
		// No plate detected - create detection without vehicle link
		// Vehicle can be linked later if plate is identified
	}

	// Create detection
	if err := database.DB.Create(&detection).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create detection"})
		return
	}

	// Check watchlist and create alert if needed
	if vehicle != nil && plateDetected && req.PlateNumber != nil {
		var watchlist models.Watchlist
		err := database.DB.Where("vehicle_id = ? AND is_active = ? AND alert_on_detection = ?", vehicle.ID, true, true).First(&watchlist).Error
		if err == nil {
			// Watchlist match! Create alert
			alert := models.WatchlistAlert{
				WatchlistID: watchlist.ID,
				VehicleID:   &vehicle.ID,
				DetectionID: &detection.ID,
				AlertType:   "DETECTION",
				Message:     "Watchlisted vehicle detected: " + *req.PlateNumber,
				IsRead:      false,
				DeviceID:    req.DeviceID,
				Timestamp:   timestamp,
				Metadata:    models.JSONB{},
			}
			database.DB.Create(&alert)
		}
	}

	response := gin.H{
		"success":    true,
		"detectionId": strconv.FormatInt(detection.ID, 10),
	}
	if vehicle != nil {
		response["vehicleId"] = strconv.FormatInt(vehicle.ID, 10)
	}

	c.JSON(http.StatusCreated, response)
}

// GetVehicles handles GET /api/vehicles - Search/list vehicles
func GetVehicles(c *gin.Context) {
	query := database.DB.Model(&models.Vehicle{})

	// Search by plate number
	if plateNumber := c.Query("plateNumber"); plateNumber != "" {
		query = query.Where("plate_number ILIKE ?", "%"+plateNumber+"%")
	}

	// Filter by vehicle type
	if vehicleType := c.Query("vehicleType"); vehicleType != "" {
		query = query.Where("vehicle_type = ?", vehicleType)
	}

	// Filter by make
	if make := c.Query("make"); make != "" {
		query = query.Where("make ILIKE ?", "%"+make+"%")
	}

	// Filter by model
	if model := c.Query("model"); model != "" {
		query = query.Where("model ILIKE ?", "%"+model+"%")
	}

	// Filter by color
	if color := c.Query("color"); color != "" {
		query = query.Where("color ILIKE ?", "%"+color+"%")
	}

	// Filter by watchlist status
	if watchlisted := c.Query("watchlisted"); watchlisted != "" {
		if watchlisted == "true" {
			query = query.Where("is_watchlisted = ?", true)
		} else {
			query = query.Where("is_watchlisted = ?", false)
		}
	}

	// Filter by date range
	if startTime := c.Query("startTime"); startTime != "" {
		if parsed, err := time.Parse(time.RFC3339, startTime); err == nil {
			query = query.Where("last_seen >= ?", parsed)
		}
	}
	if endTime := c.Query("endTime"); endTime != "" {
		if parsed, err := time.Parse(time.RFC3339, endTime); err == nil {
			query = query.Where("last_seen <= ?", parsed)
		}
	}

	// Pagination
	limit := 50
	if limitStr := c.Query("limit"); limitStr != "" {
		if parsed, err := strconv.Atoi(limitStr); err == nil && parsed > 0 && parsed <= 200 {
			limit = parsed
		}
	}
	offset := 0
	if offsetStr := c.Query("offset"); offsetStr != "" {
		if parsed, err := strconv.Atoi(offsetStr); err == nil && parsed >= 0 {
			offset = parsed
		}
	}

	var vehicles []models.Vehicle
	var total int64

	// Get total count
	query.Model(&models.Vehicle{}).Count(&total)

	// Get vehicles
	orderBy := c.DefaultQuery("orderBy", "last_seen")
	orderDir := c.DefaultQuery("orderDir", "desc")
	if orderDir != "asc" && orderDir != "desc" {
		orderDir = "desc"
	}

	// Preload latest detection for thumbnail
	query = query.Preload("Detections", func(db *gorm.DB) *gorm.DB {
		return db.Order("timestamp DESC").Limit(1)
	})

	if err := query.Order(orderBy + " " + orderDir).Limit(limit).Offset(offset).Find(&vehicles).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch vehicles"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"vehicles": vehicles,
		"total":    total,
		"limit":    limit,
		"offset":   offset,
	})
}

// GetVehicle handles GET /api/vehicles/:id - Get single vehicle with optional detections
func GetVehicle(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid vehicle ID"})
		return
	}

	// Check if detections should be included
	includeDetections := c.Query("includeDetections") == "true"
	detectionLimit := 100 // Default limit for detections
	if limitStr := c.Query("detectionLimit"); limitStr != "" {
		if parsed, err := strconv.Atoi(limitStr); err == nil && parsed > 0 && parsed <= 500 {
			detectionLimit = parsed
		}
	}

	// Build query - start with Vehicle table (fast lookup)
	query := database.DB.Model(&models.Vehicle{}).Where("id = ?", id)

	// Preload watchlist
	query = query.Preload("Watchlist")

	// Optionally preload detections with device info
	if includeDetections {
		query = query.Preload("Detections", func(db *gorm.DB) *gorm.DB {
			// Preload device info but only select needed fields
			return db.Preload("Device", func(db *gorm.DB) *gorm.DB {
				return db.Select("id, name, lat, lng, type")
			}).Order("timestamp DESC").Limit(detectionLimit)
		})
	}

	var vehicle models.Vehicle
	if err := query.First(&vehicle).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Vehicle not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch vehicle"})
		return
	}

	c.JSON(http.StatusOK, vehicle)
}

// GetVehicleDetections handles GET /api/vehicles/:id/detections - Get detection history
func GetVehicleDetections(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid vehicle ID"})
		return
	}

	// Check vehicle exists
	var vehicle models.Vehicle
	if err := database.DB.First(&vehicle, id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Vehicle not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch vehicle"})
		return
	}

	query := database.DB.Model(&models.VehicleDetection{}).Where("vehicle_id = ?", id)

	// Filter by device
	if deviceID := c.Query("deviceId"); deviceID != "" {
		query = query.Where("device_id = ?", deviceID)
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

	limit := 100
	if limitStr := c.Query("limit"); limitStr != "" {
		if parsed, err := strconv.Atoi(limitStr); err == nil && parsed > 0 && parsed <= 500 {
			limit = parsed
		}
	}

	var detections []models.VehicleDetection
	if err := query.Preload("Device", func(db *gorm.DB) *gorm.DB {
		return db.Select("id, name, lat, lng, type")
	}).Order("timestamp DESC").Limit(limit).Find(&detections).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch detections"})
		return
	}

	c.JSON(http.StatusOK, detections)
}

// GetVehicleViolations handles GET /api/vehicles/:id/violations - Get violations for vehicle
func GetVehicleViolations(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid vehicle ID"})
		return
	}

	query := database.DB.Model(&models.TrafficViolation{}).Where("vehicle_id = ?", id)

	// Filter by status
	if status := c.Query("status"); status != "" {
		query = query.Where("status = ?", status)
	}

	limit := 50
	if limitStr := c.Query("limit"); limitStr != "" {
		if parsed, err := strconv.Atoi(limitStr); err == nil && parsed > 0 {
			limit = parsed
		}
	}

	var violations []models.TrafficViolation
	if err := query.Preload("Device", func(db *gorm.DB) *gorm.DB {
		return db.Select("id, name, lat, lng, type")
	}).Order("timestamp DESC").Limit(limit).Find(&violations).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch violations"})
		return
	}

	c.JSON(http.StatusOK, violations)
}

// AddToWatchlist handles POST /api/vehicles/:id/watchlist
func AddToWatchlist(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid vehicle ID"})
		return
	}

	var req struct {
		Reason           string `json:"reason" binding:"required"`
		AddedBy         string `json:"addedBy" binding:"required"`
		AlertOnDetection bool  `json:"alertOnDetection"`
		AlertOnViolation bool  `json:"alertOnViolation"`
		Notes           *string `json:"notes"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	// Check vehicle exists
	var vehicle models.Vehicle
	if err := database.DB.First(&vehicle, id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Vehicle not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch vehicle"})
		return
	}

	// Check if already watchlisted
	var existingWatchlist models.Watchlist
	err = database.DB.Where("vehicle_id = ? AND is_active = ?", id, true).First(&existingWatchlist).Error
	if err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Vehicle is already on watchlist"})
		return
	}

	watchlist := models.Watchlist{
		VehicleID:        id,
		Reason:           req.Reason,
		AddedBy:         req.AddedBy,
		IsActive:        true,
		AlertOnDetection: req.AlertOnDetection,
		AlertOnViolation: req.AlertOnViolation,
		Notes:           req.Notes,
	}

	if err := database.DB.Create(&watchlist).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add to watchlist"})
		return
	}

	// Update vehicle watchlist flag
	database.DB.Model(&vehicle).Update("is_watchlisted", true)

	c.JSON(http.StatusCreated, watchlist)
}

// RemoveFromWatchlist handles DELETE /api/vehicles/:id/watchlist
func RemoveFromWatchlist(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid vehicle ID"})
		return
	}

	// Deactivate watchlist entry
	if err := database.DB.Model(&models.Watchlist{}).
		Where("vehicle_id = ?", id).
		Update("is_active", false).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to remove from watchlist"})
		return
	}

	// Update vehicle watchlist flag
	database.DB.Model(&models.Vehicle{}).Where("id = ?", id).Update("is_watchlisted", false)

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// GetWatchlist handles GET /api/watchlist - Get all watchlisted vehicles
func GetWatchlist(c *gin.Context) {
	query := database.DB.Model(&models.Watchlist{}).Where("is_active = ?", true)

	var watchlist []models.Watchlist
	if err := query.Preload("Vehicle").Order("added_at DESC").Find(&watchlist).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch watchlist"})
		return
	}

	c.JSON(http.StatusOK, watchlist)
}

// PostWatchlistByPlate handles POST /api/watchlist - Create watchlist entry by plate number
func PostWatchlistByPlate(c *gin.Context) {
	var req struct {
		PlateNumber      string  `json:"plateNumber" binding:"required"`
		Reason           string  `json:"reason" binding:"required"`
		AddedBy          string  `json:"addedBy" binding:"required"`
		AlertOnDetection bool    `json:"alertOnDetection"`
		AlertOnViolation bool    `json:"alertOnViolation"`
		Notes            *string `json:"notes"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	// Set defaults
	if req.AlertOnDetection == false && req.AlertOnViolation == false {
		req.AlertOnDetection = true // Default to true if both are false
	}

	// Find or create vehicle by plate number
	var vehicle models.Vehicle
	err := database.DB.Where("plate_number = ?", req.PlateNumber).First(&vehicle).Error
	
	if err == gorm.ErrRecordNotFound {
		// Create new vehicle with just plate number
		now := time.Now()
		vehicle = models.Vehicle{
			PlateNumber:    &req.PlateNumber,
			VehicleType:    models.VehicleTypeUnknown,
			FirstSeen:      now,
			LastSeen:       now,
			DetectionCount: 0,
			IsWatchlisted:  true,
		}
		
		if err := database.DB.Create(&vehicle).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create vehicle"})
			return
		}
	} else if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to check vehicle"})
		return
	} else {
		// Vehicle exists - check if already watchlisted
		var existingWatchlist models.Watchlist
		err = database.DB.Where("vehicle_id = ? AND is_active = ?", vehicle.ID, true).First(&existingWatchlist).Error
		if err == nil {
			c.JSON(http.StatusConflict, gin.H{"error": "Vehicle is already on watchlist"})
			return
		}
	}

	// Create watchlist entry
	watchlist := models.Watchlist{
		VehicleID:        vehicle.ID,
		Reason:           req.Reason,
		AddedBy:         req.AddedBy,
		IsActive:        true,
		AlertOnDetection: req.AlertOnDetection,
		AlertOnViolation: req.AlertOnViolation,
		Notes:           req.Notes,
	}

	if err := database.DB.Create(&watchlist).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add to watchlist"})
		return
	}

	// Update vehicle watchlist flag
	database.DB.Model(&vehicle).Update("is_watchlisted", true)

	// Create alerts for recent past detections (last 48 hours) if AlertOnDetection is enabled
	if req.AlertOnDetection && vehicle.ID > 0 {
		cutoffTime := time.Now().Add(-48 * time.Hour)
		var recentDetections []models.VehicleDetection
		if err := database.DB.Where("vehicle_id = ? AND timestamp >= ?", vehicle.ID, cutoffTime).
			Order("timestamp DESC").Limit(50).Find(&recentDetections).Error; err == nil {
			for _, detection := range recentDetections {
				metadata := make(map[string]interface{})
				if detection.FullImageURL != nil {
					metadata["fullImageUrl"] = *detection.FullImageURL
				}
				if detection.PlateImageURL != nil {
					metadata["plateImageUrl"] = *detection.PlateImageURL
				}
				metadata["historical"] = true

				alert := models.WatchlistAlert{
					WatchlistID: watchlist.ID,
					VehicleID:   &vehicle.ID,
					DetectionID: &detection.ID,
					AlertType:   "DETECTION",
					Message:     fmt.Sprintf("Watchlisted vehicle detected: %s at %s (historical)", req.PlateNumber, detection.DeviceID),
					IsRead:      false,
					DeviceID:    detection.DeviceID,
					Timestamp:   detection.Timestamp,
					Metadata:    models.JSONB{Data: metadata},
				}
				database.DB.Create(&alert)
			}
		}
	}

	// Create alerts for recent past violations (last 48 hours) if AlertOnViolation is enabled
	if req.AlertOnViolation && vehicle.ID > 0 {
		cutoffTime := time.Now().Add(-48 * time.Hour)
		var recentViolations []models.TrafficViolation
		if err := database.DB.Where("vehicle_id = ? AND timestamp >= ?", vehicle.ID, cutoffTime).
			Order("timestamp DESC").Limit(50).Find(&recentViolations).Error; err == nil {
			for _, violation := range recentViolations {
				metadata := make(map[string]interface{})
				metadata["violationType"] = string(violation.ViolationType)
				if violation.FullSnapshotURL != nil {
					metadata["fullImageUrl"] = *violation.FullSnapshotURL
				}
				metadata["historical"] = true

				alert := models.WatchlistAlert{
					WatchlistID: watchlist.ID,
					VehicleID:   &vehicle.ID,
					AlertType:   "VIOLATION",
					Message:     fmt.Sprintf("Watchlisted vehicle violation: %s - %s at %s (historical)", req.PlateNumber, violation.ViolationType, violation.DeviceID),
					IsRead:      false,
					DeviceID:    violation.DeviceID,
					Timestamp:   violation.Timestamp,
					Metadata:    models.JSONB{Data: metadata},
				}
				database.DB.Create(&alert)
			}
		}
	}

	// Preload vehicle for response
	database.DB.Preload("Vehicle").First(&watchlist, watchlist.ID)

	c.JSON(http.StatusCreated, watchlist)
}

// GetVehicleStats handles GET /api/vehicles/stats - Get vehicle statistics
func GetVehicleStats(c *gin.Context) {
	var stats struct {
		Total          int64            `json:"total"`
		WithPlates     int64            `json:"withPlates"`
		WithoutPlates  int64            `json:"withoutPlates"`
		Watchlisted    int64            `json:"watchlisted"`
		ByType         map[string]int64 `json:"byType"`
		ByMake         map[string]int64 `json:"byMake"`
		DetectionsToday int64           `json:"detectionsToday"`
	}

	stats.ByType = make(map[string]int64)
	stats.ByMake = make(map[string]int64)

	// Get counts
	database.DB.Model(&models.Vehicle{}).Count(&stats.Total)
	database.DB.Model(&models.Vehicle{}).Where("plate_number IS NOT NULL").Count(&stats.WithPlates)
	database.DB.Model(&models.Vehicle{}).Where("plate_number IS NULL").Count(&stats.WithoutPlates)
	database.DB.Model(&models.Vehicle{}).Where("is_watchlisted = ?", true).Count(&stats.Watchlisted)

	// Get today's detections
	today := time.Now().Truncate(24 * time.Hour)
	database.DB.Model(&models.VehicleDetection{}).Where("timestamp >= ?", today).Count(&stats.DetectionsToday)

	// Get counts by type
	var typeCounts []struct {
		VehicleType string
		Count       int64
	}
	database.DB.Model(&models.Vehicle{}).
		Select("vehicle_type, COUNT(*) as count").
		Group("vehicle_type").
		Scan(&typeCounts)

	for _, tc := range typeCounts {
		stats.ByType[tc.VehicleType] = tc.Count
	}

	// Get counts by make
	var makeCounts []struct {
		Make  string
		Count int64
	}
	database.DB.Model(&models.Vehicle{}).
		Where("make IS NOT NULL").
		Select("make, COUNT(*) as count").
		Group("make").
		Scan(&makeCounts)

	for _, mc := range makeCounts {
		stats.ByMake[mc.Make] = mc.Count
	}

	c.JSON(http.StatusOK, stats)
}

// UpdateVehicle handles PATCH /api/vehicles/:id - Update vehicle information
func UpdateVehicle(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid vehicle ID"})
		return
	}

	var req struct {
		PlateNumber *string            `json:"plateNumber"`
		Make        *string            `json:"make"`
		Model       *string            `json:"model"`
		VehicleType *models.VehicleType `json:"vehicleType"`
		Color       *string            `json:"color"`
		Metadata    models.JSONB       `json:"metadata"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	updates := make(map[string]interface{})
	if req.PlateNumber != nil {
		updates["plate_number"] = *req.PlateNumber
	}
	if req.Make != nil {
		updates["make"] = *req.Make
	}
	if req.Model != nil {
		updates["model"] = *req.Model
	}
	if req.VehicleType != nil {
		updates["vehicle_type"] = *req.VehicleType
	}
	if req.Color != nil {
		updates["color"] = *req.Color
	}
	if req.Metadata.Data != nil {
		updates["metadata"] = req.Metadata
	}

	if err := database.DB.Model(&models.Vehicle{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Vehicle not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update vehicle"})
		return
	}

	var vehicle models.Vehicle
	database.DB.First(&vehicle, id)
	c.JSON(http.StatusOK, vehicle)
}

// SearchVehicles handles GET /api/vehicles/search - Advanced search
func SearchVehicles(c *gin.Context) {
	query := database.DB.Model(&models.Vehicle{})

	if plateNumber := c.Query("plateNumber"); plateNumber != "" {
		query = query.Where("plate_number ILIKE ?", "%"+plateNumber+"%")
	}
	if make := c.Query("make"); make != "" {
		query = query.Where("make ILIKE ?", "%"+make+"%")
	}
	if model := c.Query("model"); model != "" {
		query = query.Where("model ILIKE ?", "%"+model+"%")
	}
	if vehicleType := c.Query("vehicleType"); vehicleType != "" {
		query = query.Where("vehicle_type = ?", vehicleType)
	}
	if color := c.Query("color"); color != "" {
		query = query.Where("color ILIKE ?", "%"+color+"%")
	}

	limit := 100
	if limitStr := c.Query("limit"); limitStr != "" {
		if parsed, err := strconv.Atoi(limitStr); err == nil && parsed > 0 && parsed <= 500 {
			limit = parsed
		}
	}

	var vehicles []models.Vehicle
	if err := query.Limit(limit).Order("last_seen DESC").Find(&vehicles).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to search vehicles"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"vehicles": vehicles, "count": len(vehicles)})
}

// GetVehicleRoute handles GET /api/vehicles/:id/route - Route visualization data
func GetVehicleRoute(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid vehicle ID"})
		return
	}

	var detections []models.VehicleDetection
	if err := database.DB.Where("vehicle_id = ?", id).
		Preload("Device").
		Order("timestamp ASC").
		Find(&detections).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch route data"})
		return
	}

	routePoints := make([]map[string]interface{}, 0)
	for _, det := range detections {
		if det.DeviceID != "" {
			routePoint := map[string]interface{}{
				"timestamp": det.Timestamp,
				"deviceId":  det.DeviceID,
			}
			// Add device location if available (Device is loaded via Preload)
			// Check if Device was loaded by checking if ID is set
			if det.Device.ID != "" {
				routePoint["lat"] = det.Device.Lat
				routePoint["lng"] = det.Device.Lng
				if det.Device.Name != nil {
					routePoint["deviceName"] = *det.Device.Name
				} else {
					routePoint["deviceName"] = det.DeviceID
				}
			}
			routePoints = append(routePoints, routePoint)
		}
	}

	c.JSON(http.StatusOK, gin.H{"route": routePoints, "count": len(routePoints)})
}

// GetVehiclePatterns handles GET /api/vehicles/:id/patterns - Pattern analysis
func GetVehiclePatterns(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid vehicle ID"})
		return
	}

	// Get frequent routes (devices visited most often)
	var frequentRoutes []struct {
		DeviceID   string `json:"deviceId"`
		DeviceName string `json:"deviceName"`
		Count      int64  `json:"count"`
		Lat        float64 `json:"lat"`
		Lng        float64 `json:"lng"`
	}

	database.DB.Raw(`
		SELECT 
			vd.device_id,
			COALESCE(d.name, vd.device_id) as device_name,
			COUNT(*) as count,
			d.lat,
			d.lng
		FROM vehicle_detections vd
		LEFT JOIN devices d ON d.id = vd.device_id
		WHERE vd.vehicle_id = ?
		GROUP BY vd.device_id, d.name, d.lat, d.lng
		ORDER BY count DESC
		LIMIT 10
	`, id).Scan(&frequentRoutes)

	// Get peak hours
	var peakHours []struct {
		Hour  int   `json:"hour"`
		Count int64 `json:"count"`
	}

	database.DB.Raw(`
		SELECT 
			EXTRACT(HOUR FROM timestamp)::int as hour,
			COUNT(*) as count
		FROM vehicle_detections
		WHERE vehicle_id = ?
		GROUP BY hour
		ORDER BY count DESC
		LIMIT 5
	`, id).Scan(&peakHours)

	c.JSON(http.StatusOK, gin.H{
		"frequentRoutes": frequentRoutes,
		"peakHours":     peakHours,
	})
}

// AddVehicleNote handles POST /api/vehicles/:id/notes - Add notes to vehicle
func AddVehicleNote(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid vehicle ID"})
		return
	}

	var req struct {
		Note     string `json:"note" binding:"required"`
		AddedBy  string `json:"addedBy"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	// For now, store notes in metadata
	// A proper notes table can be added later
	var vehicle models.Vehicle
	if err := database.DB.First(&vehicle, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Vehicle not found"})
		return
	}

	// Update metadata with notes
	metadata := vehicle.Metadata
	if metadata.Data == nil {
		metadata = models.NewJSONB(map[string]interface{}{})
	}

	notes, ok := metadata.Data.(map[string]interface{})
	if !ok {
		notes = make(map[string]interface{})
	}

	noteList, ok := notes["notes"].([]interface{})
	if !ok {
		noteList = []interface{}{}
	}

	noteList = append(noteList, map[string]interface{}{
		"note":     req.Note,
		"addedBy":  req.AddedBy,
		"addedAt":  time.Now().Format(time.RFC3339),
	})

	notes["notes"] = noteList
	metadata = models.NewJSONB(notes)

	if err := database.DB.Model(&vehicle).Update("metadata", metadata).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add note"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ExportVehicleReport handles GET /api/vehicles/:id/export - Export vehicle report
func ExportVehicleReport(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid vehicle ID"})
		return
	}

	var vehicle models.Vehicle
	if err := database.DB.Preload("Watchlist").First(&vehicle, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Vehicle not found"})
		return
	}

	var detections []models.VehicleDetection
	var violations []models.TrafficViolation

	database.DB.Where("vehicle_id = ?", id).Order("timestamp DESC").Limit(100).Find(&detections)
	database.DB.Where("vehicle_id = ?", id).Order("timestamp DESC").Limit(100).Find(&violations)

	c.JSON(http.StatusOK, gin.H{
		"vehicle":    vehicle,
		"detections": detections,
		"violations": violations,
	})
}

