package services

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/irisdrone/backend/database"
	"github.com/irisdrone/backend/models"
	"gopkg.in/yaml.v3"
	"gorm.io/gorm"
)

type frsTopologyConfig struct {
	Jetsons []frsTopologyJetson `yaml:"jetsons"`
}

type frsTopologyJetson struct {
	ID       string              `yaml:"id"`
	Name     string              `yaml:"name"`
	IP       string              `yaml:"ip"`
	MAC      string              `yaml:"mac"`
	Model    string              `yaml:"model"`
	ZoneID   string              `yaml:"zone_id"`
	Password string              `yaml:"password,omitempty"`
	Cameras  []frsTopologyCamera `yaml:"cameras"`
}

type frsTopologyCamera struct {
	CameraID       string                 `yaml:"camera_id"`
	Name           string                 `yaml:"name"`
	RTSPUrl        string                 `yaml:"rtsp_url"`
	ZoneID         string                 `yaml:"zone_id"`
	Lat            *float64               `yaml:"lat"`
	Lng            *float64               `yaml:"lng"`
	Services       []string               `yaml:"services"`
	AnalyticConfig map[string]interface{} `yaml:"analytic_config"`
}

// LoadFRSTopologyFromConfig upserts workers and camera devices from a YAML topology file.
func LoadFRSTopologyFromConfig() error {
	path := strings.TrimSpace(os.Getenv("FRS_TOPOLOGY_CONFIG_PATH"))
	autoSyncEnabled := strings.EqualFold(strings.TrimSpace(os.Getenv("FRS_TOPOLOGY_SYNC_ON_START")), "1") ||
		strings.EqualFold(strings.TrimSpace(os.Getenv("FRS_TOPOLOGY_SYNC_ON_START")), "true") ||
		strings.EqualFold(strings.TrimSpace(os.Getenv("FRS_TOPOLOGY_SYNC_ON_START")), "yes")

	// Default behavior: do not overwrite DB topology from YAML unless explicitly enabled.
	// This keeps admin UI as the source of truth for worker/camera configuration.
	if path == "" && !autoSyncEnabled {
		log.Printf("FRS topology sync disabled (set FRS_TOPOLOGY_SYNC_ON_START=1 to enable YAML sync)")
		return nil
	}

	if path == "" {
		// Default candidates keep this feature opt-in by file presence.
		candidates := []string{
			filepath.Join("config", "frs_topology.yaml"),
			filepath.Join("backend", "config", "frs_topology.yaml"),
		}
		for _, candidate := range candidates {
			if _, err := os.Stat(candidate); err == nil {
				path = candidate
				break
			}
		}
		if path == "" {
			path = candidates[0]
		}
	}

	if _, err := os.Stat(path); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			log.Printf("FRS topology not loaded (file not found: %s)", path)
			return nil
		}
		return fmt.Errorf("failed to stat FRS topology file %s: %w", path, err)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("failed to read FRS topology file %s: %w", path, err)
	}

	var cfg frsTopologyConfig
	if err := yaml.Unmarshal(raw, &cfg); err != nil {
		return fmt.Errorf("failed to parse FRS topology YAML %s: %w", path, err)
	}
	if len(cfg.Jetsons) == 0 {
		log.Printf("FRS topology loaded from %s with 0 jetsons; nothing to sync", path)
		return nil
	}

	now := time.Now().UTC()
	updatedWorkers := 0
	updatedCameras := 0

	for _, jetson := range cfg.Jetsons {
		if strings.TrimSpace(jetson.ID) == "" {
			log.Printf("Skipping jetson entry with empty id")
			continue
		}
		if err := upsertJetsonWorker(jetson, now); err != nil {
			return fmt.Errorf("failed to upsert jetson %s: %w", jetson.ID, err)
		}
		updatedWorkers++

		for _, cam := range jetson.Cameras {
			if strings.TrimSpace(cam.CameraID) == "" || strings.TrimSpace(cam.RTSPUrl) == "" {
				log.Printf("Skipping camera entry with missing id/rtsp under jetson %s", jetson.ID)
				continue
			}
			if err := upsertTopologyCamera(jetson, cam, now); err != nil {
				return fmt.Errorf("failed to upsert camera %s (jetson %s): %w", cam.CameraID, jetson.ID, err)
			}
			updatedCameras++
		}
	}

	log.Printf("FRS topology synced from %s (workers=%d, cameras=%d)", path, updatedWorkers, updatedCameras)
	return nil
}

// PersistFRSTopologyToConfig writes the current worker/camera topology from DB to YAML.
func PersistFRSTopologyToConfig() error {
	path := resolveTopologyConfigPath()
	if path == "" {
		return fmt.Errorf("unable to resolve topology config path")
	}

	var workers []models.Worker
	if err := database.DB.Order("created_at ASC").Find(&workers).Error; err != nil {
		return fmt.Errorf("failed to load workers: %w", err)
	}

	var devices []models.Device
	if err := database.DB.
		Where("type = ? AND worker_id IS NOT NULL", models.DeviceTypeCamera).
		Order("created_at ASC").
		Find(&devices).Error; err != nil {
		return fmt.Errorf("failed to load worker cameras: %w", err)
	}

	var assignments []models.WorkerCameraAssignment
	if err := database.DB.Where("is_active = ?", true).Find(&assignments).Error; err != nil {
		return fmt.Errorf("failed to load assignments: %w", err)
	}

	assignmentByDevice := make(map[string]models.WorkerCameraAssignment, len(assignments))
	for _, a := range assignments {
		assignmentByDevice[a.DeviceID] = a
	}

	camerasByWorker := map[string][]frsTopologyCamera{}
	defaultPassword := strings.TrimSpace(os.Getenv("FRS_DEFAULT_WORKER_PASSWORD"))
	if defaultPassword == "" {
		defaultPassword = "jetson"
	}

	for _, d := range devices {
		if d.WorkerID == nil || strings.TrimSpace(*d.WorkerID) == "" {
			continue
		}
		workerID := strings.TrimSpace(*d.WorkerID)
		name := d.ID
		if d.Name != nil && strings.TrimSpace(*d.Name) != "" {
			name = strings.TrimSpace(*d.Name)
		}
		rtsp := ""
		if d.RTSPUrl != nil {
			rtsp = strings.TrimSpace(*d.RTSPUrl)
		}
		zoneID := ""
		if d.ZoneID != nil {
			zoneID = strings.TrimSpace(*d.ZoneID)
		}

		services := []string{"frs"}
		analyticCfg := map[string]interface{}{}

		if a, ok := assignmentByDevice[d.ID]; ok {
			if arr, ok := a.Analytics.Data.([]interface{}); ok && len(arr) > 0 {
				services = make([]string, 0, len(arr))
				for _, item := range arr {
					if s, ok := item.(string); ok && strings.TrimSpace(s) != "" {
						services = append(services, strings.ToLower(strings.TrimSpace(s)))
					}
				}
				if len(services) == 0 {
					services = []string{"frs"}
				}
			}
			analyticCfg["fps"] = a.FPS
			analyticCfg["resolution"] = a.Resolution
		}

		lat := d.Lat
		lng := d.Lng

		camerasByWorker[workerID] = append(camerasByWorker[workerID], frsTopologyCamera{
			CameraID:       d.ID,
			Name:           name,
			RTSPUrl:        rtsp,
			ZoneID:         zoneID,
			Lat:            &lat,
			Lng:            &lng,
			Services:       services,
			AnalyticConfig: analyticCfg,
		})
	}

	out := frsTopologyConfig{
		Jetsons: make([]frsTopologyJetson, 0, len(workers)),
	}
	for _, w := range workers {
		if strings.TrimSpace(w.ID) == "" {
			continue
		}
		zoneID := "zone_pending"
		if cams := camerasByWorker[w.ID]; len(cams) > 0 && strings.TrimSpace(cams[0].ZoneID) != "" {
			zoneID = strings.TrimSpace(cams[0].ZoneID)
		}
		jetson := frsTopologyJetson{
			ID:       w.ID,
			Name:     strings.TrimSpace(w.Name),
			IP:       strings.TrimSpace(w.IP),
			MAC:      strings.TrimSpace(w.MAC),
			Model:    strings.TrimSpace(w.Model),
			ZoneID:   zoneID,
			Password: defaultPassword,
			Cameras:  camerasByWorker[w.ID],
		}
		if jetson.Name == "" {
			jetson.Name = w.ID
		}
		out.Jetsons = append(out.Jetsons, jetson)
	}

	raw, err := yaml.Marshal(&out)
	if err != nil {
		return fmt.Errorf("failed to marshal topology yaml: %w", err)
	}

	header := "# Generated from backend DB (workers/devices assignments).\n" +
		"# Edit via UI/API; backend rewrites this file on topology changes.\n\n"
	content := append([]byte(header), raw...)

	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return fmt.Errorf("failed to create config directory: %w", err)
	}
	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, content, 0644); err != nil {
		return fmt.Errorf("failed to write temp topology file: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return fmt.Errorf("failed to replace topology file: %w", err)
	}

	log.Printf("FRS topology persisted to %s (workers=%d)", path, len(out.Jetsons))
	return nil
}

func upsertJetsonWorker(jetson frsTopologyJetson, now time.Time) error {
	workerID := strings.TrimSpace(jetson.ID)
	defaultName := workerID
	if strings.TrimSpace(jetson.Name) != "" {
		defaultName = strings.TrimSpace(jetson.Name)
	}
	defaultIP := strings.TrimSpace(jetson.IP)
	if defaultIP == "" {
		defaultIP = "0.0.0.0"
	}
	defaultMAC := strings.TrimSpace(jetson.MAC)
	if defaultMAC == "" {
		defaultMAC = fmt.Sprintf("auto-%s", sanitizeID(workerID))
	}
	defaultModel := strings.TrimSpace(jetson.Model)
	if defaultModel == "" {
		defaultModel = "Jetson Orin Nano"
	}

	var worker models.Worker
	err := database.DB.First(&worker, "id = ?", workerID).Error
	if err != nil {
		if err != gorm.ErrRecordNotFound {
			return err
		}
		authToken, tokErr := randomHex(32)
		if tokErr != nil {
			return tokErr
		}
		worker = models.Worker{
			ID:        workerID,
			Name:      defaultName,
			Status:    models.WorkerStatusApproved,
			IP:        defaultIP,
			MAC:       defaultMAC,
			Model:     defaultModel,
			AuthToken: authToken,
			LastSeen:  now,
			LastIP:    stringPtr(defaultIP),
			Metadata: models.NewJSONB(map[string]interface{}{
				"source": "frs_topology",
			}),
		}
		return database.DB.Create(&worker).Error
	}

	updates := map[string]interface{}{
		"name":      defaultName,
		"ip":        defaultIP,
		"model":     defaultModel,
		"status":    models.WorkerStatusApproved,
		"last_seen": now,
		"last_ip":   defaultIP,
	}
	if worker.MAC == "" || strings.HasPrefix(worker.MAC, "auto-") {
		updates["mac"] = defaultMAC
	}
	return database.DB.Model(&models.Worker{}).Where("id = ?", workerID).Updates(updates).Error
}

func upsertTopologyCamera(jetson frsTopologyJetson, cam frsTopologyCamera, now time.Time) error {
	cameraID := strings.TrimSpace(cam.CameraID)
	workerID := strings.TrimSpace(jetson.ID)
	cameraName := strings.TrimSpace(cam.Name)
	if cameraName == "" {
		cameraName = cameraID
	}

	zoneID := strings.TrimSpace(cam.ZoneID)
	if zoneID == "" {
		zoneID = strings.TrimSpace(jetson.ZoneID)
	}

	services := normalizeServices(cam.Services)
	if len(services) == 0 {
		services = []string{"frs"}
	}

	configMap := map[string]interface{}{
		"services":       services,
		"topologySource": "frs_topology",
		"jetsonId":       workerID,
	}
	frsConfig := map[string]interface{}{
		"jetson_id": workerID,
	}
	for k, v := range cam.AnalyticConfig {
		frsConfig[k] = v
	}
	configMap["frs"] = frsConfig

	metadataMap := map[string]interface{}{
		"managedBy": "frs_topology",
		"jetsonId":  workerID,
	}

	var device models.Device
	err := database.DB.First(&device, "id = ?", cameraID).Error
	if err != nil {
		if err != gorm.ErrRecordNotFound {
			return err
		}

		device = models.Device{
			ID:       cameraID,
			Type:     models.DeviceTypeCamera,
			Name:     stringPtr(cameraName),
			Status:   "ACTIVE",
			RTSPUrl:  stringPtr(strings.TrimSpace(cam.RTSPUrl)),
			Config:   models.NewJSONB(configMap),
			Metadata: models.NewJSONB(metadataMap),
			WorkerID: stringPtr(workerID),
			LastSeen: &now,
		}
		if zoneID != "" {
			device.ZoneID = stringPtr(zoneID)
		}
		if cam.Lat != nil {
			device.Lat = *cam.Lat
		}
		if cam.Lng != nil {
			device.Lng = *cam.Lng
		}
		return database.DB.Create(&device).Error
	}

	existingConfig, _ := device.Config.Data.(map[string]interface{})
	if existingConfig == nil {
		existingConfig = map[string]interface{}{}
	}
	existingConfig["services"] = mergeServices(existingConfig["services"], services)
	existingConfig["topologySource"] = "frs_topology"
	existingConfig["jetsonId"] = workerID
	existingFRS := mapStringAny(existingConfig["frs"])
	if existingFRS == nil {
		existingFRS = map[string]interface{}{}
	}
	existingFRS["jetson_id"] = workerID
	for k, v := range cam.AnalyticConfig {
		existingFRS[k] = v
	}
	existingConfig["frs"] = existingFRS

	updates := map[string]interface{}{
		"name":      cameraName,
		"rtsp_url":  strings.TrimSpace(cam.RTSPUrl),
		"status":    "ACTIVE",
		"worker_id": workerID,
		"config":    models.NewJSONB(existingConfig),
		"metadata":  models.NewJSONB(metadataMap),
		"last_seen": now,
	}
	if zoneID != "" {
		updates["zone_id"] = zoneID
	}
	if cam.Lat != nil {
		updates["lat"] = *cam.Lat
	}
	if cam.Lng != nil {
		updates["lng"] = *cam.Lng
	}

	return database.DB.Model(&models.Device{}).Where("id = ?", cameraID).Updates(updates).Error
}

func normalizeServices(raw []string) []string {
	out := make([]string, 0, len(raw))
	seen := map[string]struct{}{}
	for _, s := range raw {
		clean := strings.ToLower(strings.TrimSpace(s))
		if clean == "" {
			continue
		}
		if _, exists := seen[clean]; exists {
			continue
		}
		seen[clean] = struct{}{}
		out = append(out, clean)
	}
	return out
}

func mergeServices(existing interface{}, incoming []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0)

	appendService := func(s string) {
		clean := strings.ToLower(strings.TrimSpace(s))
		if clean == "" {
			return
		}
		if _, ok := seen[clean]; ok {
			return
		}
		seen[clean] = struct{}{}
		out = append(out, clean)
	}

	if arr, ok := existing.([]interface{}); ok {
		for _, item := range arr {
			if s, ok := item.(string); ok {
				appendService(s)
			}
		}
	}
	for _, s := range incoming {
		appendService(s)
	}
	return out
}

func mapStringAny(raw interface{}) map[string]interface{} {
	out := map[string]interface{}{}
	switch t := raw.(type) {
	case map[string]interface{}:
		for k, v := range t {
			out[k] = v
		}
	case map[interface{}]interface{}:
		for k, v := range t {
			if s, ok := k.(string); ok {
				out[s] = v
			}
		}
	default:
		return nil
	}
	return out
}

func randomHex(bytes int) (string, error) {
	buf := make([]byte, bytes)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func sanitizeID(v string) string {
	v = strings.ToLower(strings.TrimSpace(v))
	v = strings.ReplaceAll(v, " ", "-")
	v = strings.ReplaceAll(v, "_", "-")
	return v
}

func stringPtr(v string) *string {
	clean := strings.TrimSpace(v)
	if clean == "" {
		return nil
	}
	return &clean
}

func resolveTopologyConfigPath() string {
	if path := strings.TrimSpace(os.Getenv("FRS_TOPOLOGY_CONFIG_PATH")); path != "" {
		return path
	}
	candidates := []string{
		filepath.Join("config", "config.yml"),
		filepath.Join("backend", "config", "config.yml"),
	}
	for _, candidate := range candidates {
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	return candidates[0]
}
