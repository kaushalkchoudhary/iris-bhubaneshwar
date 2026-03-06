package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/user"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/irisdrone/backend/database"
	"github.com/irisdrone/backend/models"
	"gorm.io/gorm"
)

// IngestEvent represents an event from edge worker
type IngestEvent struct {
	ID           string                 `json:"id"`
	TimestampRaw string                 `json:"timestamp,omitempty"` // Ignored - we use current time
	Timestamp    *time.Time             `json:"-"`                   // Set by normalizeEvent, not from JSON
	WorkerID     string                 `json:"worker_id"`
	DeviceID     string                 `json:"device_id"`
	Type         string                 `json:"type"` // anpr, violation, vcc, crowd, alert
	Data         map[string]interface{} `json:"data"`
	Images       []string               `json:"images,omitempty"` // Image filenames
}

// normalizeEvent sets the timestamp to current time and ensures required fields
func normalizeEvent(event *IngestEvent) {
	// Always use current time, ignore timestamp from payload
	now := time.Now()
	event.Timestamp = &now
}

// ensureDeviceExists creates a device if it doesn't exist
func ensureDeviceExists(deviceID string, workerID string) error {
	var device models.Device
	result := database.DB.First(&device, "id = ?", deviceID)

	if result.Error == nil {
		// Device exists, update last seen if needed
		return nil
	}

	if result.Error != gorm.ErrRecordNotFound {
		// Some other error occurred
		return result.Error
	}

	// Device doesn't exist, create it
	name := "Camera " + deviceID
	device = models.Device{
		ID:       deviceID,
		Type:     models.DeviceTypeCamera,
		Name:     &name,
		Status:   "active",
		WorkerID: &workerID,
	}

	return database.DB.Create(&device).Error
}

// IngestEventsRequest - Batch event ingest
type IngestEventsRequest struct {
	Events []IngestEvent `json:"events"`
}

// IngestEvents handles event ingestion from edge workers
// POST /api/events/ingest (multipart form or JSON)
func IngestEvents(c *gin.Context) {
	// Log incoming request
	startTime := time.Now()
	clientIP := c.ClientIP()
	workerID := c.GetHeader("X-Worker-ID")
	authToken := c.GetHeader("X-Auth-Token")
	contentType := c.ContentType()
	method := c.Request.Method
	contentLength := c.Request.ContentLength

	// Build header info for logging
	headerInfo := fmt.Sprintf("Method: %s, ContentType: %s", method, contentType)
	if contentType == "" {
		// Check Content-Type header directly if empty
		if ct := c.GetHeader("Content-Type"); ct != "" {
			contentType = ct
			headerInfo = fmt.Sprintf("Method: %s, ContentType: %s (from header)", method, contentType)
		} else {
			headerInfo = fmt.Sprintf("Method: %s, ContentType: <empty>", method)
		}
	}
	if contentLength > 0 {
		headerInfo += fmt.Sprintf(", ContentLength: %d", contentLength)
	}

	log.Printf("📥 [EVENT_INGEST] Request received - IP: %s, WorkerID: %s, %s",
		clientIP, workerID, headerInfo)
	log.Printf("🔍 [EVENT_INGEST] DEBUG HEADERS: %v", c.Request.Header)

	// In production, always require worker auth for ingest.
	if strings.TrimSpace(strings.ToLower(os.Getenv("ENV"))) == "production" {
		if workerID == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Worker authentication required"})
			return
		}
	}

	// Validate worker if headers are provided (or required by env).
	if workerID != "" {
		var worker models.Worker
		if err := database.DB.First(&worker, "id = ?", workerID).Error; err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid worker"})
			return
		}
		if worker.AuthToken != authToken {
			log.Printf("❌ [EVENT_INGEST] Auth failed for worker %s: expected '%s', got '%s'", workerID, worker.AuthToken, authToken)
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid auth token"})
			return
		}
		if worker.Status == models.WorkerStatusRevoked {
			c.JSON(http.StatusForbidden, gin.H{"error": "Worker has been revoked"})
			return
		}
	}

	// Try JSON parsing if content type is JSON or empty (might be JSON without proper header)
	if contentType == "application/json" || contentType == "" {
		// JSON batch ingest (no images)
		var req IngestEventsRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			// If content type was empty and JSON parsing failed, continue to multipart handling
			if contentType == "" {
				log.Printf("⚠️ [EVENT_INGEST] Empty ContentType, JSON parse failed - IP: %s, WorkerID: %s, Error: %v, trying multipart...",
					clientIP, workerID, err)
				// Continue to multipart handling below
			} else {
				log.Printf("❌ [EVENT_INGEST] JSON parse error - IP: %s, WorkerID: %s, Error: %v",
					clientIP, workerID, err)
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
		} else {
			// Successfully parsed as JSON
			if contentType == "" {
				log.Printf("ℹ️ [EVENT_INGEST] Detected JSON content (ContentType was empty) - IP: %s, WorkerID: %s",
					clientIP, workerID)
			}

			// Log batch request details
			eventTypes := make(map[string]int)
			for _, event := range req.Events {
				eventTypes[event.Type]++
			}
			log.Printf("📦 [EVENT_INGEST] Batch request - WorkerID: %s, Total: %d, Types: %v",
				workerID, len(req.Events), eventTypes)

			processed := 0
			for i := range req.Events {
				// Normalize event (set timestamp to current time)
				normalizeEvent(&req.Events[i])

				if err := processEvent(req.Events[i], nil); err != nil {
					log.Printf("⚠️ [EVENT_INGEST] Failed to process event - WorkerID: %s, EventID: %s, Type: %s, Error: %v",
						workerID, req.Events[i].ID, req.Events[i].Type, err)
					continue
				}
				processed++
			}

			duration := time.Since(startTime)
			log.Printf("✅ [EVENT_INGEST] Batch processed - WorkerID: %s, Processed: %d/%d, Duration: %v",
				workerID, processed, len(req.Events), duration)

			c.JSON(http.StatusOK, gin.H{
				"status":    "ok",
				"processed": processed,
				"total":     len(req.Events),
			})
			return
		}
	}

	// Multipart form (single event with images)
	// Also handle form-urlencoded or other content types
	eventJSON := c.PostForm("event")
	if eventJSON == "" {
		eventJSON = c.PostForm("events")
		// If it looks like an array, try to extract the first element
		if strings.HasPrefix(strings.TrimSpace(eventJSON), "[") {
			var events []interface{}
			if err := json.Unmarshal([]byte(eventJSON), &events); err == nil && len(events) > 0 {
				if firstEvent, err := json.Marshal(events[0]); err == nil {
					eventJSON = string(firstEvent)
				}
			}
		}
	}

	if eventJSON == "" {
		// Try to get raw body for debugging
		bodySize := 0
		if c.Request.Body != nil {
			bodyBytes, _ := io.ReadAll(c.Request.Body)
			bodySize = len(bodyBytes)
			// Restore body for further processing
			c.Request.Body = io.NopCloser(bytes.NewReader(bodyBytes))
		}

		// Log all form values for debugging
		formValues := make(map[string]string)
		for key, values := range c.Request.PostForm {
			if len(values) > 0 {
				formValues[key] = values[0]
			}
		}

		log.Printf("❌ [EVENT_INGEST] Missing event data - IP: %s, WorkerID: %s, ContentType: %s, BodySize: %d, FormKeys: %v",
			clientIP, workerID, contentType, bodySize, formValues)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing event data"})
		return
	}

	var event IngestEvent
	if err := json.Unmarshal([]byte(eventJSON), &event); err != nil {
		// Log the actual JSON for debugging (truncate if too long)
		jsonPreview := eventJSON
		if len(jsonPreview) > 500 {
			jsonPreview = jsonPreview[:500] + "... (truncated)"
		}
		log.Printf("❌ [EVENT_INGEST] Invalid event JSON - IP: %s, WorkerID: %s, Error: %v, JSON: %s",
			clientIP, workerID, err, jsonPreview)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid event JSON"})
		return
	}

	// Normalize event (set timestamp to current time, ignore payload timestamp)
	normalizeEvent(&event)

	// Log multipart request details
	log.Printf("📤 [EVENT_INGEST] Multipart request - WorkerID: %s, EventID: %s, Type: %s, DeviceID: %s",
		workerID, event.ID, event.Type, event.DeviceID)

	// Handle uploaded images
	// Parse multipart form if not already parsed (max 32MB)
	if err := c.Request.ParseMultipartForm(32 << 20); err != nil {
		log.Printf("⚠️ [EVENT_INGEST] Failed to parse multipart form - IP: %s, WorkerID: %s, Error: %v",
			clientIP, workerID, err)
	}

	form := c.Request.MultipartForm
	imageURLs := make(map[string]string)

	if form != nil && form.File != nil {
		// Log all file keys for debugging
		fileKeys := make([]string, 0, len(form.File))
		for key := range form.File {
			fileKeys = append(fileKeys, key)
		}
		log.Printf("📎 [EVENT_INGEST] Multipart files found - Keys: %v", fileKeys)

		for key, files := range form.File {
			if key == "event" {
				continue
			}
			for _, file := range files {
				// Save image
				src, err := file.Open()
				if err != nil {
					log.Printf("⚠️ [EVENT_INGEST] Failed to open file - Key: %s, Filename: %s, Error: %v",
						key, file.Filename, err)
					continue
				}

				// Generate storage path
				storagePath := generateImagePath(event.WorkerID, event.DeviceID, event.Type, file.Filename)

				// Ensure directory exists
				dir := filepath.Dir(storagePath)
				if err := os.MkdirAll(dir, 0755); err != nil {
					log.Printf("⚠️ [EVENT_INGEST] Failed to create directory - Path: %s, Error: %v", dir, err)
					src.Close()
					continue
				}

				// Save file
				dst, err := os.Create(storagePath)
				if err != nil {
					log.Printf("⚠️ [EVENT_INGEST] Failed to create file - Path: %s, Error: %v", storagePath, err)
					src.Close()
					continue
				}

				if _, err := io.Copy(dst, src); err != nil {
					log.Printf("⚠️ [EVENT_INGEST] Failed to copy file - Path: %s, Error: %v", storagePath, err)
					src.Close()
					dst.Close()
					continue
				}

				src.Close()
				dst.Close()

				// Generate URL - need to get relative path from base directory
				baseDir := getUploadBaseDir()

				// Get relative path from base directory
				relPath, err := filepath.Rel(baseDir, storagePath)
				if err != nil {
					// Fallback to just filename if relative path fails
					relPath = filepath.Base(storagePath)
				}

				// Convert to forward slashes for URL (Windows compatibility)
				relPath = filepath.ToSlash(relPath)
				imageURLs[key] = "/uploads/" + relPath
				log.Printf("💾 [EVENT_INGEST] Image saved - Key: %s, Path: %s, URL: %s",
					key, storagePath, imageURLs[key])
			}
		}
	} else {
		log.Printf("⚠️ [EVENT_INGEST] No multipart form or files found - Form: %v", form != nil)
	}

	// Check if this is an image upload only request (no event processing needed)
	uploadOnly := false
	if event.Data != nil {
		if uploadOnlyVal, ok := event.Data["upload_only"].(bool); ok && uploadOnlyVal {
			uploadOnly = true
		}
	}

	if uploadOnly {
		// Just save images and return URLs, don't process the event
		duration := time.Since(startTime)
		imageCount := len(imageURLs)
		log.Printf("📤 [EVENT_INGEST] Image upload only - WorkerID: %s, EventID: %s, Images: %d, Duration: %v",
			workerID, event.ID, imageCount, duration)

		c.JSON(http.StatusOK, gin.H{
			"status":   "ok",
			"event_id": event.ID,
			"images":   imageURLs,
		})
		return
	}

	// Process the event
	if err := processEvent(event, imageURLs); err != nil {
		duration := time.Since(startTime)
		log.Printf("❌ [EVENT_INGEST] Processing failed - WorkerID: %s, EventID: %s, Type: %s, Error: %v, Duration: %v",
			workerID, event.ID, event.Type, err, duration)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	duration := time.Since(startTime)
	imageCount := len(imageURLs)
	log.Printf("✅ [EVENT_INGEST] Event processed - WorkerID: %s, EventID: %s, Type: %s, Images: %d, Duration: %v",
		workerID, event.ID, event.Type, imageCount, duration)

	c.JSON(http.StatusOK, gin.H{
		"status":   "ok",
		"event_id": event.ID,
		"images":   imageURLs,
	})
}

// processEvent processes a single event based on type
func processEvent(event IngestEvent, imageURLs map[string]string) error {
	// Ensure device exists before processing event
	if err := ensureDeviceExists(event.DeviceID, event.WorkerID); err != nil {
		return fmt.Errorf("failed to ensure device exists: %w", err)
	}

	switch event.Type {
	case "anpr", "plate_detected":
		return processANPREvent(event, imageURLs)
	case "violation":
		return processViolationEvent(event, imageURLs)
	case "vcc", "vehicle_detected":
		return processVCCEvent(event, imageURLs)
	case "crowd", "crowd_density":
		return processCrowdEvent(event, imageURLs)
	case "face_detected", "person_match":
		return processFRSEvent(event, imageURLs)
	case "alert":
		return processAlertEvent(event, imageURLs)
	default:
		// Store as generic event
		return processGenericEvent(event, imageURLs)
	}
}

// processANPREvent handles ANPR/plate detection events
func processANPREvent(event IngestEvent, imageURLs map[string]string) error {
	data := event.Data

	// Extract plate info
	plateNumber, _ := data["plate_number"].(string)
	plateConfidence, _ := data["plate_confidence"].(float64)
	vehicleTypeStr, _ := data["vehicle_type"].(string)
	make, _ := data["make"].(string)
	model, _ := data["model"].(string)
	color, _ := data["color"].(string)

	// Determine vehicle type
	vehicleType := models.VehicleTypeUnknown
	switch vehicleTypeStr {
	case "2W":
		vehicleType = models.VehicleType2Wheeler
	case "4W":
		vehicleType = models.VehicleType4Wheeler
	case "AUTO":
		vehicleType = models.VehicleTypeAuto
	case "TRUCK":
		vehicleType = models.VehicleTypeTruck
	case "BUS":
		vehicleType = models.VehicleTypeBus
	}

	// Find or create vehicle if plate detected
	var vehicleID *int64
	if plateNumber != "" {
		var vehicle models.Vehicle
		err := database.DB.Where("plate_number = ?", plateNumber).First(&vehicle).Error
		if err != nil {
			// Create new vehicle
			now := time.Now()
			vehicle = models.Vehicle{
				PlateNumber:    &plateNumber,
				VehicleType:    vehicleType,
				FirstSeen:      now,
				LastSeen:       now,
				DetectionCount: 1,
			}
			if make != "" {
				vehicle.Make = &make
			}
			if model != "" {
				vehicle.Model = &model
			}
			if color != "" {
				vehicle.Color = &color
			}
			database.DB.Create(&vehicle)
		} else {
			// Update existing
			vehicle.LastSeen = time.Now()
			vehicle.DetectionCount++
			database.DB.Save(&vehicle)
		}
		vehicleID = &vehicle.ID
	}

	// Create detection record
	detection := models.VehicleDetection{
		VehicleID:         vehicleID,
		DeviceID:          event.DeviceID,
		Timestamp:         *event.Timestamp,
		PlateNumber:       &plateNumber,
		VehicleType:       vehicleType,
		PlateDetected:     plateNumber != "",
		MakeModelDetected: make != "" || model != "",
	}

	if plateConfidence > 0 {
		detection.PlateConfidence = &plateConfidence
	}
	if make != "" {
		detection.Make = &make
	}
	if model != "" {
		detection.Model = &model
	}
	if color != "" {
		detection.Color = &color
	}

	// Add image URLs
	if url, ok := imageURLs["frame.jpg"]; ok {
		detection.FullImageURL = &url
	}
	if url, ok := imageURLs["plate.jpg"]; ok {
		detection.PlateImageURL = &url
	}
	if url, ok := imageURLs["vehicle.jpg"]; ok {
		detection.VehicleImageURL = &url
	}

	// Create detection first to get ID
	if err := database.DB.Create(&detection).Error; err != nil {
		return err
	}

	// Check watchlist and create alert if needed (after detection is created)
	if vehicleID != nil {
		var watchlist models.Watchlist
		if err := database.DB.Where("vehicle_id = ? AND is_active = ? AND alert_on_detection = ?", *vehicleID, true, true).First(&watchlist).Error; err == nil {
			// Watchlist match! Create alert
			alert := models.WatchlistAlert{
				WatchlistID: watchlist.ID,
				VehicleID:   vehicleID,
				DetectionID: &detection.ID,
				AlertType:   "DETECTION",
				Message:     "Watchlisted vehicle detected: " + plateNumber,
				IsRead:      false,
				DeviceID:    event.DeviceID,
				Timestamp:   *event.Timestamp,
				Metadata:    models.JSONB{},
			}
			database.DB.Create(&alert)
		}
	}

	return nil
}

// processViolationEvent handles traffic violation events
func processViolationEvent(event IngestEvent, imageURLs map[string]string) error {
	data := event.Data

	// Extract violation info
	violationTypeStr, _ := data["violation_type"].(string)
	plateNumber, _ := data["plate_number"].(string)
	speed, _ := data["speed"].(float64)
	speedLimit, _ := data["speed_limit"].(float64)

	// Map violation type
	violationType := models.ViolationOther
	switch violationTypeStr {
	case "SPEED":
		violationType = models.ViolationSpeed
	case "HELMET":
		violationType = models.ViolationHelmet
	case "WRONG_SIDE":
		violationType = models.ViolationWrongSide
	case "RED_LIGHT":
		violationType = models.ViolationRedLight
	case "NO_SEATBELT":
		violationType = models.ViolationNoSeatbelt
	case "TRIPLE_RIDING":
		violationType = models.ViolationTripleRiding
	}

	// Find vehicle by plate
	var vehicleID *int64
	if plateNumber != "" {
		var vehicle models.Vehicle
		if err := database.DB.Where("plate_number = ?", plateNumber).First(&vehicle).Error; err == nil {
			vehicleID = &vehicle.ID
		}
	}

	violation := models.TrafficViolation{
		DeviceID:        event.DeviceID,
		VehicleID:       vehicleID,
		Timestamp:       *event.Timestamp,
		ViolationType:   violationType,
		Status:          models.ViolationPending,
		DetectionMethod: models.DetectionAIVision,
	}

	if plateNumber != "" {
		violation.PlateNumber = &plateNumber
	}
	if speed > 0 {
		violation.DetectedSpeed = &speed
	}
	if speedLimit > 0 {
		violation.SpeedLimit4W = &speedLimit
	}

	// Add image URLs
	if url, ok := imageURLs["frame.jpg"]; ok {
		violation.FullSnapshotURL = &url
	}
	if url, ok := imageURLs["plate.jpg"]; ok {
		violation.PlateImageURL = &url
	}

	// Build metadata: event.Data plus additionalImages from extra form-file keys
	meta := make(map[string]interface{})
	if data != nil {
		for k, v := range data {
			meta[k] = v
		}
	}
	var additionalImages []string
	for key, url := range imageURLs {
		if key != "frame.jpg" && key != "plate.jpg" {
			additionalImages = append(additionalImages, url)
		}
	}
	if len(additionalImages) > 0 {
		meta["additionalImages"] = additionalImages
	}
	violation.Metadata = models.NewJSONB(meta)

	return database.DB.Create(&violation).Error
}

// processVCCEvent handles vehicle counting events
func processVCCEvent(event IngestEvent, imageURLs map[string]string) error {
	data := event.Data

	vehicleTypeStr, _ := data["vehicle_type"].(string)

	vehicleType := models.VehicleTypeUnknown
	switch vehicleTypeStr {
	case "2W":
		vehicleType = models.VehicleType2Wheeler
	case "4W":
		vehicleType = models.VehicleType4Wheeler
	case "AUTO":
		vehicleType = models.VehicleTypeAuto
	case "TRUCK":
		vehicleType = models.VehicleTypeTruck
	case "BUS":
		vehicleType = models.VehicleTypeBus
	}

	detection := models.VehicleDetection{
		DeviceID:    event.DeviceID,
		Timestamp:   *event.Timestamp,
		VehicleType: vehicleType,
		Metadata:    models.NewJSONB(data),
	}

	if url, ok := imageURLs["frame.jpg"]; ok {
		detection.FullImageURL = &url
	}

	return database.DB.Create(&detection).Error
}

// processCrowdEvent handles crowd density events
func processCrowdEvent(event IngestEvent, imageURLs map[string]string) error {
	data := event.Data

	peopleCount, _ := data["people_count"].(float64)
	densityValue, _ := data["density_value"].(float64)
	densityLevelStr, _ := data["density_level"].(string)

	densityLevel := models.DensityLow
	switch densityLevelStr {
	case "MEDIUM":
		densityLevel = models.DensityMedium
	case "HIGH":
		densityLevel = models.DensityHigh
	case "CRITICAL":
		densityLevel = models.DensityCritical
	}

	analysis := models.CrowdAnalysis{
		DeviceID:        event.DeviceID,
		Timestamp:       *event.Timestamp,
		DensityLevel:    densityLevel,
		MovementType:    models.MovementStatic,
		HotspotSeverity: models.SeverityGreen,
	}

	if peopleCount > 0 {
		pc := int(peopleCount)
		analysis.PeopleCount = &pc
	}
	if densityValue > 0 {
		analysis.DensityValue = &densityValue
	}

	if url, ok := imageURLs["frame.jpg"]; ok {
		analysis.FrameURL = &url
	}
	if url, ok := imageURLs["heatmap.jpg"]; ok {
		analysis.HeatmapImageURL = &url
	}

	return database.DB.Create(&analysis).Error
}

// processFRSEvent handles face detection and person match events from FRS pipeline
func processFRSEvent(event IngestEvent, imageURLs map[string]string) error {
	data := event.Data

	confidence, _ := data["confidence"].(float64)
	if confidence < 0 {
		confidence = 0
	}

	var personIDPtr *string
	if personID, ok := data["person_id"].(string); ok && strings.TrimSpace(personID) != "" {
		pid := strings.TrimSpace(personID)
		personIDPtr = &pid
	}

	var matchScorePtr *float64
	if m, ok := data["match_score"].(float64); ok {
		matchScorePtr = &m
	}

	var frameIDPtr *string
	if frameID, ok := data["frame_id"].(string); ok && strings.TrimSpace(frameID) != "" {
		fid := strings.TrimSpace(frameID)
		frameIDPtr = &fid
	}

	// Event payload may include metadata map with scores/flags.
	meta := map[string]interface{}{}
	if metadata, ok := data["metadata"].(map[string]interface{}); ok {
		for k, v := range metadata {
			meta[k] = v
		}
		if matchScorePtr == nil {
			if ms, ok := metadata["match_score"].(float64); ok {
				matchScorePtr = &ms
			}
		}
		if personIDPtr == nil {
			if pid, ok := metadata["person_id"].(string); ok && strings.TrimSpace(pid) != "" {
				clean := strings.TrimSpace(pid)
				personIDPtr = &clean
			}
		}
	}

	// Include all uploaded image URLs in metadata so UI can use metadata.images["face.jpg"].
	if len(imageURLs) > 0 {
		meta["images"] = imageURLs
	}
	if personIDPtr != nil {
		meta["person_id"] = *personIDPtr
	}
	meta["is_known"] = personIDPtr != nil

	embedding, embErr := decodeFaceEmbedding(data)
	if embErr != nil {
		log.Printf("⚠️ [EVENT_INGEST] Invalid FRS embedding for event %s: %v", event.ID, embErr)
	}

	return database.FRS().Transaction(func(tx *gorm.DB) error {
		globalIdentity, reidScore, prevSeen, reidErr := assignGlobalIdentity(tx, personIDPtr, embedding, *event.Timestamp)
		if reidErr != nil {
			return reidErr
		}

		// Cooldown check: if this identity was seen on the SAME device within FRS_DETECTION_COOLDOWN_SECONDS,
		// skip creating a new detection row to prevent database bloat and alert spam.
		if globalIdentity != nil && !prevSeen.IsZero() {
			cfg := loadFRSReIDConfig()
			if event.Timestamp.Sub(prevSeen) < cfg.DetectionCooldown {
				// Check if it was the same device (optional but recommended for multi-camera continuity)
				// Here we just check globally per identity for now, or we could join with detections.
				// However, globalIdentity update already happened. If we want to skip detection record:
				log.Printf("[FRS_INGEST] Cooldown active for %s (last seen %v ago), skipping detection record",
					globalIdentity.GlobalIdentityID, event.Timestamp.Sub(prevSeen))
				return nil
			}
		}

		var globalIdentityIDPtr *string
		if globalIdentity != nil && strings.TrimSpace(globalIdentity.GlobalIdentityID) != "" {
			gid := strings.TrimSpace(globalIdentity.GlobalIdentityID)
			globalIdentityIDPtr = &gid
			meta["global_identity_id"] = gid
		}
		if reidScore > 0 {
			meta["reid_score"] = reidScore
		}

		detection := models.FRSDetection{
			GlobalIdentityID: globalIdentityIDPtr,
			PersonID:         personIDPtr,
			DeviceID:         event.DeviceID,
			Timestamp:        *event.Timestamp,
			Confidence:       confidence,
			MatchScore:       matchScorePtr,
			FrameID:          frameIDPtr,
			BBox:             models.NewJSONB(data["bbox"]),
			Metadata:         models.NewJSONB(meta),
		}

		// Prefer face crop URL when available, fall back to face.jpg.
		if url, ok := imageURLs["face_crop.jpg"]; ok {
			detection.FaceSnapshotURL = &url
		} else if url, ok := imageURLs["face.jpg"]; ok {
			detection.FaceSnapshotURL = &url
		}
		if url, ok := imageURLs["frame.jpg"]; ok {
			detection.FullSnapshotURL = &url
		}

		if err := tx.Create(&detection).Error; err != nil {
			return err
		}

		if err := storeFRSEmbedding(tx, detection.ID, embedding); err != nil {
			return err
		}

		return nil
	})
}

// IngestFRSEventFromSystem allows internal services (e.g. MQTT) to store FRS events.
func IngestFRSEventFromSystem(
	deviceID string,
	eventType string,
	data map[string]interface{},
	timestamp time.Time,
	imageURLs map[string]string,
) error {
	if strings.TrimSpace(deviceID) == "" {
		return fmt.Errorf("deviceID is required")
	}
	if data == nil {
		data = map[string]interface{}{}
	}
	if eventType == "" {
		eventType = "face_detected"
	}

	event := IngestEvent{
		ID:       fmt.Sprintf("mqtt_%d", time.Now().UnixNano()),
		WorkerID: "mqtt-ingest",
		DeviceID: strings.TrimSpace(deviceID),
		Type:     eventType,
		Data:     data,
	}

	ts := timestamp
	if ts.IsZero() {
		ts = time.Now().UTC()
	}
	event.Timestamp = &ts

	if err := ensureDeviceExists(event.DeviceID, event.WorkerID); err != nil {
		return err
	}

	return processFRSEvent(event, imageURLs)
}

// processAlertEvent handles alert events
func processAlertEvent(event IngestEvent, imageURLs map[string]string) error {
	// Store as crowd alert for now
	data := event.Data

	title, _ := data["title"].(string)
	description, _ := data["description"].(string)
	severityStr, _ := data["severity"].(string)

	severity := models.SeverityYellow
	switch severityStr {
	case "GREEN":
		severity = models.SeverityGreen
	case "ORANGE":
		severity = models.SeverityOrange
	case "RED":
		severity = models.SeverityRed
	}

	alert := models.CrowdAlert{
		DeviceID:     event.DeviceID,
		Timestamp:    *event.Timestamp,
		AlertType:    "worker_alert",
		Severity:     severity,
		Title:        title,
		DensityLevel: models.DensityMedium,
		ActualValue:  0,
	}

	if description != "" {
		alert.Description = &description
	}

	return database.DB.Create(&alert).Error
}

// processGenericEvent handles unknown event types
func processGenericEvent(event IngestEvent, imageURLs map[string]string) error {
	// Store as generic event
	genericEvent := models.Event{
		DeviceID:  event.DeviceID,
		Timestamp: *event.Timestamp,
		Type:      event.Type,
		Data:      models.NewJSONB(event.Data),
	}

	// Add image URLs to data
	if len(imageURLs) > 0 {
		if dataMap, ok := genericEvent.Data.Data.(map[string]interface{}); ok {
			dataMap["images"] = imageURLs
			genericEvent.Data = models.NewJSONB(dataMap)
		}
	}

	return database.DB.Create(&genericEvent).Error
}

// getUploadBaseDir returns the base directory for uploads
func getUploadBaseDir() string {
	baseDir := os.Getenv("UPLOAD_DIR")
	if baseDir == "" {
		// Default to ~/itms/data
		currentUser, err := user.Current()
		if err != nil {
			log.Printf("⚠️ [EVENT_INGEST] Failed to get current user, using ./itms/data: %v", err)
			baseDir = "./itms/data"
		} else {
			baseDir = filepath.Join(currentUser.HomeDir, "itms", "data")
		}
	}
	return baseDir
}

// generateImagePath creates a storage path for uploaded images
func generateImagePath(workerID, deviceID, eventType, filename string) string {
	// Base directory
	baseDir := getUploadBaseDir()

	// Create the directory if it doesn't exist
	if err := os.MkdirAll(baseDir, 0755); err != nil {
		log.Printf("⚠️ [EVENT_INGEST] Failed to create upload directory %s: %v", baseDir, err)
		// Fallback to ./itms/data if home directory fails
		baseDir = "./itms/data"
		if err := os.MkdirAll(baseDir, 0755); err != nil {
			log.Printf("❌ [EVENT_INGEST] Failed to create fallback upload directory %s: %v", baseDir, err)
		}
	}

	log.Printf("📁 [EVENT_INGEST] Using upload directory: %s", baseDir)

	// Create date-based path
	now := time.Now()
	datePath := now.Format("2006/01/02")

	// Generate unique filename
	// Prevent path traversal and filesystem metacharacters.
	safeWorker := sanitizeFileSegment(workerID)
	safeDevice := sanitizeFileSegment(deviceID)
	safeType := sanitizeFileSegment(eventType)
	safeName := sanitizeFilename(filename)

	uniqueName := fmt.Sprintf("%s_%s_%s_%d_%s",
		safeWorker, safeDevice, safeType, now.UnixMilli(), safeName)

	return filepath.Join(baseDir, datePath, uniqueName)
}

func sanitizeFilename(name string) string {
	// Drop any directory components first.
	name = filepath.Base(strings.TrimSpace(name))
	if name == "." || name == "" {
		return "upload.bin"
	}

	// Allow only a conservative set of characters.
	var b strings.Builder
	b.Grow(len(name))
	for _, r := range name {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '.' || r == '_' || r == '-' {
			b.WriteRune(r)
		} else {
			b.WriteByte('_')
		}
	}
	out := b.String()
	if len(out) > 120 {
		out = out[:120]
	}
	out = strings.Trim(out, "._-")
	if out == "" {
		return "upload.bin"
	}
	return out
}

func sanitizeFileSegment(seg string) string {
	seg = strings.TrimSpace(seg)
	if seg == "" {
		return "unknown"
	}
	// Reuse filename sanitizer; segments live inside the filename too.
	return sanitizeFilename(seg)
}
