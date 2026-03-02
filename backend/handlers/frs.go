package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/irisdrone/backend/database"
	"github.com/irisdrone/backend/models"
	"gorm.io/gorm"
)

// watchlistVersion is bumped whenever the FRS person list changes so Jetsons
// can detect stale caches with a cheap polling endpoint instead of refetching
// the full person list every time.
var (
	watchlistVersionMu sync.RWMutex
	watchlistVersion   int64
	watchlistUpdatedAt time.Time
)

func bumpWatchlistVersion() {
	watchlistVersionMu.Lock()
	watchlistVersion++
	watchlistUpdatedAt = time.Now().UTC()
	watchlistVersionMu.Unlock()

	// Also increment ConfigVersion for all active workers/Jetsons so they detect
	// the change via their polling logic and restart inference to sync.
	if err := database.DB.Model(&models.Worker{}).
		Where("status IN ?", []string{"active", "approved"}).
		Update("config_version", gorm.Expr("config_version + 1")).Error; err != nil {
		fmt.Printf("Error bumping worker config versions: %v\n", err)
	}
}

// GetFRSWatchlistVersion returns the current watchlist version counter.
// Jetsons poll this every few seconds and only do a full person-list fetch
// when the version changes.
// GET /api/inference/frs/watchlist-version (no auth required)
func GetFRSWatchlistVersion(c *gin.Context) {
	watchlistVersionMu.RLock()
	v, t := watchlistVersion, watchlistUpdatedAt
	watchlistVersionMu.RUnlock()
	c.JSON(http.StatusOK, gin.H{"version": v, "updated_at": t.Format(time.RFC3339)})
}

// computeFaceEmbeddingOnJetson POSTs raw image bytes to the embedding server
// running on an active Jetson (port 5555) and returns the 512-dim face embedding.
// It tries each known worker in turn and returns on first success.
func computeFaceEmbeddingOnJetson(imageData []byte) ([]float64, error) {
	var workers []models.Worker
	if err := database.Main().
		Where("status IN ?", []string{string(models.WorkerStatusApproved), string(models.WorkerStatusActive)}).
		Find(&workers).Error; err != nil {
		return nil, fmt.Errorf("failed to fetch workers: %w", err)
	}
	if len(workers) == 0 {
		return nil, fmt.Errorf("no active Jetson workers available for embedding")
	}

	port := strings.TrimSpace(os.Getenv("EMBEDDING_SERVER_PORT"))
	if port == "" {
		port = "5555"
	}

	client := &http.Client{Timeout: 15 * time.Second}

	for _, w := range workers {
		ip := w.IP
		if ip == "" && w.LastIP != nil {
			ip = *w.LastIP
		}
		if ip == "" {
			continue
		}

		url := fmt.Sprintf("http://%s:%s/embed", ip, port)
		resp, err := client.Post(url, "image/jpeg", bytes.NewReader(imageData))
		if err != nil {
			log.Printf("WARN: embedding server at %s unreachable: %v", url, err)
			continue
		}

		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		var result struct {
			Success   bool      `json:"success"`
			Error     string    `json:"error"`
			Embedding []float64 `json:"embedding"`
		}
		if err := json.Unmarshal(body, &result); err != nil {
			log.Printf("WARN: embedding server at %s bad response: %v", url, err)
			continue
		}
		if result.Success && len(result.Embedding) > 0 {
			return result.Embedding, nil
		}
		if result.Error != "" {
			log.Printf("WARN: embedding server at %s: %s", url, result.Error)
		}
	}

	return nil, fmt.Errorf("no Jetson embedding server returned a valid embedding")
}

func getFormValue(c *gin.Context, keys ...string) string {
	for _, k := range keys {
		if v := strings.TrimSpace(c.PostForm(k)); v != "" {
			return v
		}
	}
	return ""
}

func getUploadDirBase() string {
	base := strings.TrimSpace(os.Getenv("UPLOAD_DIR"))
	if base == "" {
		home, _ := os.UserHomeDir()
		if home == "" {
			return "./itms/data"
		}
		return filepath.Join(home, "itms", "data")
	}
	return base
}

func saveFRSPersonImages(c *gin.Context, personID string) ([]string, error) {
	form, err := c.MultipartForm()
	if err != nil || form == nil {
		return nil, nil
	}

	files := append(form.File["images[]"], form.File["images"]...)
	if len(files) == 0 {
		return nil, nil
	}

	baseDir := getUploadDirBase()
	personDir := filepath.Join(baseDir, "frs", "persons", personID)
	if err := os.MkdirAll(personDir, 0755); err != nil {
		return nil, err
	}

	urls := make([]string, 0, len(files))
	for _, f := range files {
		name := filepath.Base(f.Filename)
		if name == "." || name == "/" || name == "" {
			name = "face.jpg"
		}
		dstName := fmt.Sprintf("%d_%s", time.Now().UnixNano(), name)
		dstPath := filepath.Join(personDir, dstName)
		if err := c.SaveUploadedFile(f, dstPath); err != nil {
			return nil, err
		}
		rel, err := filepath.Rel(baseDir, dstPath)
		if err != nil {
			rel = filepath.Base(dstPath)
		}
		urls = append(urls, "/uploads/"+filepath.ToSlash(rel))
	}
	return urls, nil
}

func GetFRSPersons(c *gin.Context) {
	var persons []models.FRSPerson
	if err := database.FRS().Order("created_at DESC").Find(&persons).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}
	c.JSON(http.StatusOK, persons)
}

// GetFRSPersonsForInference is a public read-only endpoint for inference services.
func GetFRSPersonsForInference(c *gin.Context) {
	GetFRSPersons(c)
}

func CreateFRSPerson(c *gin.Context) {
	id := fmt.Sprintf("person_%d", time.Now().UnixNano())
	name := getFormValue(c, "name")
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
		return
	}

	person := models.FRSPerson{
		ID:   id,
		Name: name,
	}

	if v := getFormValue(c, "age"); v != "" {
		if age, err := strconv.Atoi(v); err == nil {
			person.Age = &age
		}
	}
	if v := getFormValue(c, "gender"); v != "" {
		person.Gender = &v
	}
	if v := getFormValue(c, "status"); v != "" {
		person.Status = &v
	}
	if v := getFormValue(c, "height"); v != "" {
		person.Height = &v
	}
	if v := getFormValue(c, "aliases"); v != "" {
		person.Aliases = &v
	}
	if v := getFormValue(c, "category"); v != "" {
		person.Category = &v
	}
	if v := getFormValue(c, "threatLevel", "threat_level"); v != "" {
		person.ThreatLevel = &v
	}
	if v := getFormValue(c, "notes"); v != "" {
		person.Notes = &v
	}

	uploaded, err := saveFRSPersonImages(c, person.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to store uploaded image"})
		return
	}
	if len(uploaded) > 0 {
		person.FaceImageURL = &uploaded[0]
		person.Metadata = models.NewJSONB(map[string]interface{}{"galleryImages": uploaded})
	}

	// Compute face embeddings from uploaded images (via Jetson GPU embedding server)
	embeddings := []interface{}{}
	baseDir := getUploadDirBase()
	for _, relURL := range uploaded {
		rel := strings.TrimPrefix(relURL, "/uploads/")
		absPath := filepath.Join(baseDir, rel)
		imageData, readErr := os.ReadFile(absPath)
		if readErr != nil {
			log.Printf("WARN: could not read image for embedding: %v", readErr)
			continue
		}
		emb, embErr := computeFaceEmbeddingOnJetson(imageData)
		if embErr != nil {
			log.Printf("WARN: Jetson embedding failed: %v", embErr)
			continue
		}
		embeddings = append(embeddings, emb)
	}
	person.Embeddings = models.NewJSONB(embeddings)
	if len(embeddings) > 0 {
		if first, ok := embeddings[0].([]float64); ok {
			person.Embedding = models.NewJSONB(first)
		}
	}

	if err := database.FRS().Create(&person).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	bumpWatchlistVersion()
	c.JSON(http.StatusOK, person)
}

func UpdateFRSPerson(c *gin.Context) {
	id := c.Param("id")
	var person models.FRSPerson
	if err := database.FRS().First(&person, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Person not found"})
		return
	}

	if v := getFormValue(c, "name"); v != "" {
		person.Name = v
	}
	if v := getFormValue(c, "age"); v != "" {
		if age, err := strconv.Atoi(v); err == nil {
			person.Age = &age
		}
	}
	if v := getFormValue(c, "gender"); v != "" {
		person.Gender = &v
	}
	if v := getFormValue(c, "status"); v != "" {
		person.Status = &v
	}
	if v := getFormValue(c, "height"); v != "" {
		person.Height = &v
	}
	if v := getFormValue(c, "aliases"); v != "" {
		person.Aliases = &v
	}
	if v := getFormValue(c, "category"); v != "" {
		person.Category = &v
	}
	if v := getFormValue(c, "threatLevel", "threat_level"); v != "" {
		person.ThreatLevel = &v
	}
	if v := getFormValue(c, "notes"); v != "" {
		person.Notes = &v
	}

	uploaded, err := saveFRSPersonImages(c, person.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to store uploaded image"})
		return
	}
	if len(uploaded) > 0 {
		person.FaceImageURL = &uploaded[0]
	}

	if err := database.FRS().Save(&person).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	bumpWatchlistVersion()
	c.JSON(http.StatusOK, person)
}

func DeleteFRSPerson(c *gin.Context) {
	id := c.Param("id")
	if err := database.FRS().Delete(&models.FRSPerson{}, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}
	_ = database.FRS().Model(&models.FRSDetection{}).Where("person_id = ?", id).Update("person_id", nil).Error
	bumpWatchlistVersion()
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func AddFRSPersonEmbeddings(c *gin.Context) {
	id := c.Param("id")
	var person models.FRSPerson
	if err := database.FRS().First(&person, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Person not found"})
		return
	}

	uploaded, err := saveFRSPersonImages(c, person.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to store uploaded image"})
		return
	}

	embeddings := []interface{}{}
	if person.Embeddings.Data != nil {
		if arr, ok := person.Embeddings.Data.([]interface{}); ok {
			embeddings = arr
		}
	}

	newCount := 0

	// Accept a raw pre-computed embedding (backward compat)
	if raw := getFormValue(c, "embedding"); raw != "" {
		embeddings = append(embeddings, raw)
		newCount++
	}

	// Compute embeddings from any newly uploaded images (via Jetson GPU embedding server)
	baseDir := getUploadDirBase()
	for _, relURL := range uploaded {
		rel := strings.TrimPrefix(relURL, "/uploads/")
		absPath := filepath.Join(baseDir, rel)
		imageData, readErr := os.ReadFile(absPath)
		if readErr != nil {
			log.Printf("WARN: could not read image for embedding: %v", readErr)
			continue
		}
		emb, embErr := computeFaceEmbeddingOnJetson(imageData)
		if embErr != nil {
			log.Printf("WARN: Jetson embedding failed: %v", embErr)
			continue
		}
		embeddings = append(embeddings, emb)
		newCount++
	}

	person.Embeddings = models.NewJSONB(embeddings)

	if len(uploaded) > 0 {
		meta, _ := person.Metadata.Data.(map[string]interface{})
		if meta == nil {
			meta = map[string]interface{}{}
		}
		existing := []interface{}{}
		if g, ok := meta["galleryImages"].([]interface{}); ok {
			existing = g
		}
		for _, u := range uploaded {
			existing = append(existing, u)
		}
		meta["galleryImages"] = existing
		person.Metadata = models.NewJSONB(meta)
		if person.FaceImageURL == nil && len(uploaded) > 0 {
			person.FaceImageURL = &uploaded[0]
		}
	}

	if err := database.FRS().Save(&person).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	total := len(embeddings)
	bumpWatchlistVersion()
	c.JSON(http.StatusOK, gin.H{
		"person":             person,
		"newEmbeddingsCount": newCount,
		"totalEmbeddings":    total,
	})
}

func GetFRSDetections(c *gin.Context) {
	limit := 50
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed <= 500 {
			limit = parsed
		}
	}

	query := database.FRS().Model(&models.FRSDetection{}).
		Preload("Person").
		Preload("GlobalIdentity").
		Order("timestamp DESC").
		Limit(limit)

	if personID := strings.TrimSpace(c.Query("personId")); personID != "" {
		query = query.Where("person_id = ?", personID)
	}
	if deviceID := strings.TrimSpace(c.Query("deviceId")); deviceID != "" {
		query = query.Where("device_id = ?", deviceID)
	}
	if globalIdentityID := strings.TrimSpace(c.Query("globalIdentityId")); globalIdentityID != "" {
		query = query.Where("global_identity_id = ?", globalIdentityID)
	}
	if unknown := strings.TrimSpace(strings.ToLower(c.Query("unknown"))); unknown != "" {
		if unknown == "true" || unknown == "1" {
			query = query.Where("person_id IS NULL OR person_id = ''")
		} else if unknown == "false" || unknown == "0" {
			query = query.Where("person_id IS NOT NULL AND person_id <> ''")
		}
	}
	if start := strings.TrimSpace(c.Query("startTime")); start != "" {
		if parsed, err := time.Parse(time.RFC3339, start); err == nil {
			query = query.Where("timestamp >= ?", parsed)
		}
	}
	if end := strings.TrimSpace(c.Query("endTime")); end != "" {
		if parsed, err := time.Parse(time.RFC3339, end); err == nil {
			query = query.Where("timestamp <= ?", parsed)
		}
	}

	var detections []models.FRSDetection
	if err := query.Find(&detections).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	// Ensure metadata.images remains available for existing UI usage.
	for i := range detections {
		meta, _ := detections[i].Metadata.Data.(map[string]interface{})
		if meta == nil {
			meta = map[string]interface{}{}
		}
		images, _ := meta["images"].(map[string]interface{})
		if images == nil {
			images = map[string]interface{}{}
		}
		if detections[i].FaceSnapshotURL != nil && images["face.jpg"] == nil {
			images["face.jpg"] = *detections[i].FaceSnapshotURL
		}
		if detections[i].FullSnapshotURL != nil && images["frame.jpg"] == nil {
			images["frame.jpg"] = *detections[i].FullSnapshotURL
		}
		if detections[i].PersonID != nil {
			meta["person_id"] = *detections[i].PersonID
		}
		meta["is_known"] = detections[i].PersonID != nil
		meta["images"] = images
		detections[i].Metadata = models.NewJSONB(meta)
	}

	c.JSON(http.StatusOK, detections)
}

// GetFRSGlobalIdentities lists ReID global identities with optional filters.
func GetFRSGlobalIdentities(c *gin.Context) {
	limit := 100
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed <= 1000 {
			limit = parsed
		}
	}

	query := database.FRS().Model(&models.GlobalIdentity{}).
		Preload("AssociatedPerson").
		Order("last_seen_timestamp DESC").
		Limit(limit)

	if known := strings.TrimSpace(strings.ToLower(c.Query("known"))); known != "" {
		if known == "true" || known == "1" {
			query = query.Where("associated_person_id IS NOT NULL AND associated_person_id <> ''")
		} else if known == "false" || known == "0" {
			query = query.Where("associated_person_id IS NULL OR associated_person_id = ''")
		}
	}
	if riskLevel := strings.TrimSpace(strings.ToLower(c.Query("riskLevel"))); riskLevel != "" {
		query = query.Where("LOWER(risk_level) = ?", riskLevel)
	}
	if since := strings.TrimSpace(c.Query("since")); since != "" {
		if parsed, err := time.Parse(time.RFC3339, since); err == nil {
			query = query.Where("last_seen_timestamp >= ?", parsed)
		}
	}

	var identities []models.GlobalIdentity
	if err := query.Find(&identities).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}
	c.JSON(http.StatusOK, identities)
}

// GetFRSGlobalIdentityDetections returns timeline detections for one global identity.
func GetFRSGlobalIdentityDetections(c *gin.Context) {
	globalIdentityID := strings.TrimSpace(c.Param("id"))
	if globalIdentityID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "global identity id is required"})
		return
	}

	limit := 200
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed <= 2000 {
			limit = parsed
		}
	}

	var detections []models.FRSDetection
	if err := database.FRS().Model(&models.FRSDetection{}).
		Preload("Person").
		Preload("GlobalIdentity").
		Where("global_identity_id = ?", globalIdentityID).
		Order("timestamp DESC").
		Limit(limit).
		Find(&detections).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
		return
	}

	c.JSON(http.StatusOK, detections)
}
