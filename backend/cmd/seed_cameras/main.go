// seed_cameras: Seeds 20 CCTV camera devices with RTSP URLs and creates 5 Jetson workers
// with 4 cameras assigned to each.
// Run from backend/: go run cmd/seed_cameras/main.go
package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/joho/godotenv"
	"github.com/irisdrone/backend/database"
	"github.com/irisdrone/backend/models"
	"gorm.io/gorm"
)

// Camera definitions - name, RTSP URL
type cameraDef struct {
	ID      string
	Name    string
	RTSPUrl string
	Lat     float64
	Lng     float64
}

var cameras = []cameraDef{
	// LG Floor (Jetson-01 + Jetson-02)
	{ID: "cam_d03", Name: "D3 - LG FLOOR LIFT 1", RTSPUrl: "rtsp://admin:Admin@123@172.16.1.53/media/video1"},
	{ID: "cam_d04", Name: "D4 - LG FLOOR MINI CNFRNS HALL", RTSPUrl: "rtsp://admin:Admin@123@172.16.1.54/media/video1"},
	{ID: "cam_d05", Name: "D5 - LG FLOOR EKAMRA 1", RTSPUrl: "rtsp://admin:Admin@123@172.16.1.55/media/video1"},
	{ID: "cam_d06", Name: "D6 - LG FLOOR EKAMRA EXIT", RTSPUrl: "rtsp://admin:Admin@123@172.16.1.56/media/video1"},
	{ID: "cam_d07", Name: "D7 - LG FLOOR EKAMRA 2", RTSPUrl: "rtsp://admin:Admin@123@172.16.1.57/media/video1"},
	{ID: "cam_d08", Name: "D8 - LG FLOOR LIFT 2", RTSPUrl: "rtsp://admin:Admin@123@172.16.1.58/media/video1"},
	{ID: "cam_d09", Name: "D9 - LG FLOOR NEAR NULM SEC", RTSPUrl: "rtsp://admin:Admin@123@172.16.1.59/media/video1"},
	{ID: "cam_d10", Name: "D10 - LG FLOOR LIFT 5", RTSPUrl: "rtsp://admin:Admin@123@172.16.1.60/media/video1"},
	// LG Floor continued (Jetson-03)
	{ID: "cam_d11", Name: "D11 - LG FLOOR LIFT 6", RTSPUrl: "rtsp://admin:Admin@123@172.16.1.61/media/video1"},
	{ID: "cam_d12", Name: "D12 - LG FLOOR LIFT 3", RTSPUrl: "rtsp://admin:Admin@123@172.16.1.62/media/video1"},
	{ID: "cam_d13", Name: "D13 - LG FLOOR LIFT 4", RTSPUrl: "rtsp://admin:Admin@123@172.16.1.63/media/video1"},
	{ID: "cam_d14", Name: "D14 - LG FLOOR EXIT GATE", RTSPUrl: "rtsp://admin:Admin@123@172.16.1.64/media/video1"},
	// LG/UG Transition (Jetson-04)
	{ID: "cam_d15", Name: "D15 - LG FLOOR NEAR ENV SEC", RTSPUrl: "rtsp://admin:Admin@123@172.16.1.66/media/video1"},
	{ID: "cam_d16", Name: "D16 - UG FLOOR ENTRY GATE", RTSPUrl: "rtsp://admin:Admin@123@172.16.1.67/media/video1"},
	{ID: "cam_d17", Name: "D17 - UG FLOOR RECEPTION", RTSPUrl: "rtsp://admin:Admin@123@172.16.1.68/media/video1"},
	{ID: "cam_d18", Name: "D18 - UG FLOOR LIFT 1", RTSPUrl: "rtsp://admin:Admin@123@172.16.1.69/media/video1"},
	// UG Floor (Jetson-05)
	{ID: "cam_d19", Name: "D19 - UG FLOOR LIFT 2", RTSPUrl: "rtsp://admin:Admin@123@172.16.1.70/media/video1"},
	{ID: "cam_d20", Name: "D20 - UG FLOOR LIFT 3", RTSPUrl: "rtsp://admin:Admin@123@172.16.1.71/media/video1"},
	{ID: "cam_d21", Name: "D21 - UG FLOOR LIFT 4", RTSPUrl: "rtsp://admin:Admin@123@172.16.1.72/media/video1"},
	{ID: "cam_d22", Name: "D22 - UG FLOOR NEAR MAYOR", RTSPUrl: "rtsp://admin:Admin@123@172.16.1.73/media/video1"},
}

// Jetson worker definitions - 5 real units, 4 cameras each
// These IDs match the workers already registered in the DB.
type jetsonDef struct {
	ID      string
	Name    string
	IP      string
	MAC     string
	Cameras []string // Camera IDs assigned to this Jetson
}

var jetsons = []jetsonDef{
	{
		ID: "wk_51b031e35d101ded", Name: "jetson-11",
		IP: "10.10.0.11", MAC: "auto",
		Cameras: []string{"cam_d03", "cam_d04", "cam_d05", "cam_d06"},
	},
	{
		ID: "wk_92597e147bf7ea97", Name: "jetson-13",
		IP: "10.10.0.13", MAC: "auto",
		Cameras: []string{"cam_d07", "cam_d08", "cam_d09", "cam_d10"},
	},
	{
		ID: "wk_50c16c4103b9c13f", Name: "jetson-14",
		IP: "10.10.0.14", MAC: "auto",
		Cameras: []string{"cam_d11", "cam_d12", "cam_d13", "cam_d14"},
	},
	{
		ID: "wk_e56d0426fa6fefdd", Name: "jetson-22",
		IP: "10.10.0.22", MAC: "auto",
		Cameras: []string{"cam_d15", "cam_d16", "cam_d17", "cam_d18"},
	},
	{
		ID: "wk_be1f712f8a40b87e", Name: "jetson-150",
		IP: "10.10.0.150", MAC: "auto",
		Cameras: []string{"cam_d19", "cam_d20", "cam_d21", "cam_d22"},
	},
}

func generateAuthToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file, using env vars")
	}

	if err := database.Connect(); err != nil {
		log.Fatalf("DB connect failed: %v", err)
	}
	defer database.Close()

	fmt.Println("🎥  Seeding cameras...")
	for _, c := range cameras {
		name := c.Name
		rtsp := c.RTSPUrl

		var existing models.Device
		err := database.DB.Where("id = ?", c.ID).First(&existing).Error
		if err == nil {
			// Update RTSP URL and name
			database.DB.Model(&existing).Updates(map[string]interface{}{
				"name":     name,
				"rtsp_url": rtsp,
				"status":   "ACTIVE",
			})
			fmt.Printf("  ✏️  Updated  %s → %s\n", c.ID, c.Name)
			continue
		}

		device := models.Device{
			ID:      c.ID,
			Type:    models.DeviceTypeCamera,
			Name:    &name,
			RTSPUrl: &rtsp,
			Status:  "ACTIVE",
			Lat:     c.Lat,
			Lng:     c.Lng,
		}
		if err := database.DB.Create(&device).Error; err != nil {
			log.Printf("  ❌  Failed to create %s: %v", c.ID, err)
			continue
		}
		fmt.Printf("  ✅  Created  %s → %s\n", c.ID, c.Name)
	}

	fmt.Println("\n🤖  Seeding Jetson workers...")
	now := time.Now()
	for _, j := range jetsons {
		var existing models.Worker
		err := database.DB.Where("id = ?", j.ID).First(&existing).Error
		if err == nil {
			// Update IP only
			database.DB.Model(&existing).Updates(map[string]interface{}{"ip": j.IP})
			fmt.Printf("  ✏️  Worker exists: %s (%s)\n", j.Name, j.IP)
		} else {
			token := generateAuthToken()
			approved := now
			approvedBy := "seed"
			worker := models.Worker{
				ID:         j.ID,
				Name:       j.Name,
				Status:     models.WorkerStatusApproved,
				IP:         j.IP,
				MAC:        strings.ToLower(j.MAC),
				Model:      "Jetson Orin NX 8GB",
				AuthToken:  token,
				ApprovedAt: &approved,
				ApprovedBy: &approvedBy,
				LastSeen:   now,
				LastIP:     &j.IP,
			}
			if err := database.DB.Create(&worker).Error; err != nil {
				// MAC conflict → try to find by MAC and update ID
				log.Printf("  ⚠️  Worker create failed (%s): %v — skipping", j.Name, err)
				continue
			}
			fmt.Printf("  ✅  Created worker %s (%s)\n", j.Name, j.IP)
		}

		// Assign cameras to this worker
		fmt.Printf("     📷  Assigning %d cameras to %s...\n", len(j.Cameras), j.Name)

		// Deactivate existing assignments first
		database.DB.Model(&models.WorkerCameraAssignment{}).
			Where("worker_id = ?", j.ID).
			Update("is_active", false)

		for _, camID := range j.Cameras {
			// Verify camera exists
			var cam models.Device
			if err := database.DB.Where("id = ?", camID).First(&cam).Error; err != nil {
				log.Printf("     ⚠️  Camera %s not found, skipping", camID)
				continue
			}

			// Update camera's worker_id
			database.DB.Model(&models.Device{}).Where("id = ?", camID).Update("worker_id", j.ID)

			// Upsert assignment
			var assignment models.WorkerCameraAssignment
			err := database.DB.Where("worker_id = ? AND device_id = ?", j.ID, camID).First(&assignment).Error
			if err == gorm.ErrRecordNotFound {
				assignment = models.WorkerCameraAssignment{
					WorkerID:   j.ID,
					DeviceID:   camID,
					Analytics:  models.NewJSONB([]string{"crowd"}),
					FPS:        15,
					Resolution: "720p",
					IsActive:   true,
				}
				database.DB.Create(&assignment)
			} else {
				assignment.IsActive = true
				database.DB.Save(&assignment)
			}
		}

		// Bump config version
		database.DB.Model(&models.Worker{}).Where("id = ?", j.ID).
			Update("config_version", gorm.Expr("config_version + 1"))
	}

	fmt.Println("\n✅  Camera + Jetson seeding complete!")
	fmt.Printf("    Cameras: %d\n", len(cameras))
	fmt.Printf("    Jetsons: %d\n", len(jetsons))
}
