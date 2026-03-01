package main

import (
	"fmt"
	"log"
	"math/rand"
	"time"

	"github.com/joho/godotenv"
	"github.com/irisdrone/backend/database"
	"github.com/irisdrone/backend/models"
	"gorm.io/gorm"
)

var samplePlates = []string{
	"KA01P3249", "KA51JU6888", "KA51S1211", "KA51F1481", "KA01JD2011",
	"KA40A9996", "KA25MC8245", "KA01AP820", "KA51P8651", "KA03KZ61",
	"KA09HV6114", "KA19MB4995", "KA51AB1234", "KA02CD5678", "KA05EF9012",
}

var violationTypes = []models.ViolationType{
	models.ViolationSpeed,
	models.ViolationHelmet,
	models.ViolationWrongSide,
	models.ViolationRedLight,
	models.ViolationNoSeatbelt,
}

var statuses = []models.ViolationStatus{
	models.ViolationPending,
	models.ViolationPending,
	models.ViolationPending,
	models.ViolationApproved,
	models.ViolationRejected,
}

var detectionMethods = []models.DetectionMethod{
	models.DetectionRadar,
	models.DetectionAIVision,
	models.DetectionCamera,
}

func main() {
	// Load environment variables
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using environment variables")
	}

	// Connect to database
	if err := database.Connect(); err != nil {
		log.Fatalf("❌ Failed to connect to database: %v", err)
	}
	defer database.Close()

	fmt.Println("🌱 Starting violation seed...")

	// Get camera devices
	var devices []models.Device
	if err := database.DB.Where("type = ? AND lat != ? AND lng != ?", models.DeviceTypeCamera, 0, 0).
		Limit(15).
		Find(&devices).Error; err != nil {
		log.Fatalf("Failed to fetch devices: %v", err)
	}

	if len(devices) == 0 {
		fmt.Println("⚠️  No camera devices found. Skipping violation seeding.")
		return
	}

	rand.Seed(time.Now().UnixNano())
	now := time.Now()
	totalCreated := 0

	// Create violations for each device
	for _, device := range devices {
		numViolations := rand.Intn(8) + 5 // 5-12 violations per device

		for i := 0; i < numViolations; i++ {
			violationType := violationTypes[rand.Intn(len(violationTypes))]
			status := statuses[rand.Intn(len(statuses))]
			plateNumber := samplePlates[rand.Intn(len(samplePlates))]
			detectionMethod := detectionMethods[rand.Intn(len(detectionMethods))]

			// Create timestamp within last 7 days
			daysAgo := rand.Intn(7)
			hoursAgo := rand.Intn(24)
			minutesAgo := rand.Intn(60)
			timestamp := now.Add(-time.Duration(daysAgo)*24*time.Hour -
				time.Duration(hoursAgo)*time.Hour -
				time.Duration(minutesAgo)*time.Minute)

			plateConfidence := 0.5 + rand.Float64()*0.3 // 50-80%
			confidence := 0.6 + rand.Float64()*0.3     // 60-90%

			violation := models.TrafficViolation{
				DeviceID:        device.ID,
				Timestamp:       timestamp,
				ViolationType:   violationType,
				Status:          status,
				DetectionMethod: detectionMethod,
				PlateNumber:     &plateNumber,
				PlateConfidence: &plateConfidence,
				Confidence:      &confidence,
			}

			// Add placeholder image URLs
			fullSnapshotURL := fmt.Sprintf("https://via.placeholder.com/800x600/333333/FFFFFF?text=Violation+%s+%s", violationType, plateNumber)
			plateImageURL := fmt.Sprintf("https://via.placeholder.com/200x100/FFD700/000000?text=%s", plateNumber)
			frameID := fmt.Sprintf("frame_%s_%d", device.ID, timestamp.Unix())

			violation.FullSnapshotURL = &fullSnapshotURL
			violation.PlateImageURL = &plateImageURL
			violation.FrameID = &frameID

			// Add speed-specific data
			if violationType == models.ViolationSpeed {
				speedLimit2W := 40.0
				speedLimit4W := 30.0
				detectedSpeed := 45.0 + rand.Float64()*30 // 45-75 km/h
				speedOverLimit := detectedSpeed - speedLimit4W

				violation.DetectedSpeed = &detectedSpeed
				violation.SpeedLimit2W = &speedLimit2W
				violation.SpeedLimit4W = &speedLimit4W
				violation.SpeedOverLimit = &speedOverLimit

				metadata := models.JSONB{
					Data: map[string]interface{}{
						"boundingBox": map[string]interface{}{
							"x":      rand.Float64() * 100,
							"y":      rand.Float64() * 100,
							"width":  50 + rand.Float64()*30,
							"height": 50 + rand.Float64()*30,
						},
						"speedText": fmt.Sprintf("%.1f km/h", detectedSpeed),
					},
				}
				violation.Metadata = metadata
			} else if violationType == models.ViolationHelmet {
				metadata := models.JSONB{
					Data: map[string]interface{}{
						"boundingBox": map[string]interface{}{
							"x":      rand.Float64() * 100,
							"y":      rand.Float64() * 100,
							"width":  40 + rand.Float64()*20,
							"height": 40 + rand.Float64()*20,
						},
						"personCount":    rand.Intn(2) + 1,
						"helmetDetected": false,
					},
				}
				violation.Metadata = metadata
			} else {
				metadata := models.JSONB{
					Data: map[string]interface{}{
						"boundingBox": map[string]interface{}{
							"x":      rand.Float64() * 100,
							"y":      rand.Float64() * 100,
							"width":  50 + rand.Float64()*30,
							"height": 50 + rand.Float64()*30,
						},
					},
				}
				violation.Metadata = metadata
			}

			// Add review data if approved or rejected
			if status == models.ViolationApproved {
				reviewedAt := timestamp.Add(time.Duration(rand.Intn(3600)) * time.Second)
				reviewedBy := "admin"
				reviewNote := "Verified violation. Proceed with fine."

				violation.ReviewedAt = &reviewedAt
				violation.ReviewedBy = &reviewedBy
				violation.ReviewNote = &reviewNote

				// Some approved violations get fined
				if rand.Float64() > 0.5 {
					fineAmounts := map[models.ViolationType]float64{
						models.ViolationSpeed:       1000,
						models.ViolationHelmet:      500,
						models.ViolationWrongSide:   2000,
						models.ViolationRedLight:    1500,
						models.ViolationNoSeatbelt:  1000,
						models.ViolationOverloading: 5000,
						models.ViolationIllegalParking: 200,
						models.ViolationOther:       500,
					}
					fineAmount := fineAmounts[violationType]
					fineIssuedAt := reviewedAt.Add(time.Duration(rand.Intn(86400)) * time.Second)
					fineReference := fmt.Sprintf("FINE-%d-%d", time.Now().Unix(), rand.Intn(1000))

					violation.Status = models.ViolationFined
					violation.FineAmount = &fineAmount
					violation.FineIssuedAt = &fineIssuedAt
					violation.FineReference = &fineReference
				}
			} else if status == models.ViolationRejected {
				reviewedAt := timestamp.Add(time.Duration(rand.Intn(3600)) * time.Second)
				reviewedBy := "admin"
				rejectionReasons := []string{
					"False positive - plate misread",
					"Insufficient evidence",
					"Vehicle not in violation",
					"Camera angle issue",
				}
				rejectionReason := rejectionReasons[rand.Intn(len(rejectionReasons))]

				violation.ReviewedAt = &reviewedAt
				violation.ReviewedBy = &reviewedBy
				violation.RejectionReason = &rejectionReason
			}

			if err := database.DB.Create(&violation).Error; err != nil {
				log.Printf("Failed to create violation: %v", err)
				continue
			}
			totalCreated++
		}
	}

	fmt.Printf("✅ Created %d traffic violations for %d devices\n", totalCreated, len(devices))

	// Seed vehicle detections (VCC)
	fmt.Println("🌱 Seeding vehicle detections (VCC)...")

	vehicleTypes := []models.VehicleType{
		models.VehicleType2Wheeler,
		models.VehicleType4Wheeler,
		models.VehicleTypeAuto,
		models.VehicleTypeTruck,
		models.VehicleTypeBus,
	}

	makes := []string{"Honda", "Toyota", "Maruti", "Hyundai", "Tata", "Mahindra", "Bajaj", "Hero", "Yamaha", "TVS"}
	modelsList := []string{"City", "Innova", "Swift", "i20", "Nexon", "XUV", "Pulsar", "Splendor", "FZ", "Apache"}
	colors := []string{"White", "Black", "Silver", "Red", "Blue", "Gray", "Brown"}

	detectionCount := 0

	// Create detections for each device over the last 7 days
	for _, device := range devices {
		// Create 50-200 detections per device over 7 days
		numDetections := rand.Intn(151) + 50

		for i := 0; i < numDetections; i++ {
			// Random time within last 7 days
			daysAgo := rand.Intn(7)
			hoursAgo := rand.Intn(24)
			minutesAgo := rand.Intn(60)
			secondsAgo := rand.Intn(60)
			timestamp := now.Add(-time.Duration(daysAgo)*24*time.Hour -
				time.Duration(hoursAgo)*time.Hour -
				time.Duration(minutesAgo)*time.Minute -
				time.Duration(secondsAgo)*time.Second)

			vehicleType := vehicleTypes[rand.Intn(len(vehicleTypes))]
			plateDetected := rand.Float64() > 0.3 // 70% have plates detected
			makeModelDetected := rand.Float64() > 0.5 // 50% have make/model detected

			var plateNumber *string
			var plateConfidence *float64
			var make *string
			var model *string
			var color *string
			var vehicleID *int64

			if plateDetected {
				plate := samplePlates[rand.Intn(len(samplePlates))]
				plateNumber = &plate
				conf := 0.5 + rand.Float64()*0.4 // 50-90% confidence
				plateConfidence = &conf

				// Try to find or create vehicle
				var vehicle models.Vehicle
				err := database.DB.Where("plate_number = ?", plate).First(&vehicle).Error
				if err == nil {
					vehicleID = &vehicle.ID
					// Update vehicle last seen
					database.DB.Model(&vehicle).Updates(map[string]interface{}{
						"last_seen":       timestamp,
						"detection_count": gorm.Expr("detection_count + 1"),
					})
				} else {
					// Create new vehicle
					if makeModelDetected {
						makeVal := makes[rand.Intn(len(makes))]
						modelVal := modelsList[rand.Intn(len(modelsList))]
						colorVal := colors[rand.Intn(len(colors))]
						make = &makeVal
						model = &modelVal
						color = &colorVal
					}

					newVehicle := models.Vehicle{
						PlateNumber:    plateNumber,
						Make:           make,
						Model:          model,
						VehicleType:    vehicleType,
						Color:          color,
						FirstSeen:      timestamp,
						LastSeen:       timestamp,
						DetectionCount: 1,
						IsWatchlisted:  false,
					}
					if err := database.DB.Create(&newVehicle).Error; err == nil {
						vehicleID = &newVehicle.ID
					}
				}
			} else if makeModelDetected {
				// No plate but has make/model
				makeVal := makes[rand.Intn(len(makes))]
				modelVal := modelsList[rand.Intn(len(modelsList))]
				colorVal := colors[rand.Intn(len(colors))]
				make = &makeVal
				model = &modelVal
				color = &colorVal
			}

			confidence := 0.6 + rand.Float64()*0.3 // 60-90%
			fullImageURL := fmt.Sprintf("https://via.placeholder.com/800x600/333333/FFFFFF?text=Vehicle+%s", vehicleType)
			plateImageURL := ""
			if plateDetected && plateNumber != nil {
				plateImageURL = fmt.Sprintf("https://via.placeholder.com/200x100/FFD700/000000?text=%s", *plateNumber)
			}
			frameID := fmt.Sprintf("frame_%s_%d", device.ID, timestamp.Unix())

			direction := []string{"north", "south", "east", "west"}[rand.Intn(4)]
			lane := rand.Intn(3) + 1

			detection := models.VehicleDetection{
				VehicleID:        vehicleID,
				DeviceID:         device.ID,
				Timestamp:        timestamp,
				PlateNumber:      plateNumber,
				PlateConfidence:  plateConfidence,
				Make:             make,
				Model:            model,
				VehicleType:      vehicleType,
				Color:            color,
				Confidence:       &confidence,
				PlateDetected:    plateDetected,
				MakeModelDetected: makeModelDetected,
				FullImageURL:     &fullImageURL,
				PlateImageURL:    func() *string { if plateImageURL != "" { return &plateImageURL }; return nil }(),
				FrameID:          &frameID,
				Direction:        &direction,
				Lane:             &lane,
			}

			if err := database.DB.Create(&detection).Error; err != nil {
				log.Printf("Failed to create detection: %v", err)
				continue
			}
			detectionCount++
		}
	}

	fmt.Printf("✅ Created %d vehicle detections for %d devices\n", detectionCount, len(devices))
	fmt.Println("✅ All seeding completed.")
}

