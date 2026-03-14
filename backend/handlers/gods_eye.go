package handlers

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// GodsEyePromptConfig is the prompt config returned to Jetsons and set by the frontend.
type GodsEyePromptConfig struct {
	Mode          string                   `json:"mode"`          // "text" or "visual"
	Classes       []string                 `json:"classes"`       // text class list
	ReferImage    string                   `json:"referImage"`    // base64 image for visual mode
	VisualPrompts []map[string]interface{} `json:"visualPrompts"` // bbox prompts for visual mode
	UpdatedAt     time.Time                `json:"updatedAt"`
}

// GodsEyeDetectionEvent is a single detection event from a Jetson.
type GodsEyeDetectionEvent struct {
	Ts         float64 `json:"ts"`
	TrackID    int     `json:"track_id"`
	Class      string  `json:"class"`
	Confidence float64 `json:"confidence"`
}

// GodsEyeDetectionsPayload is what the Jetson POSTs.
type GodsEyeDetectionsPayload struct {
	WorkerID  string                  `json:"worker_id"`
	CameraID  string                  `json:"camera_id"`
	CameraKey string                  `json:"camera_key"`
	Events    []GodsEyeDetectionEvent `json:"events"`
}

var (
	godsEyeMu     sync.RWMutex
	godsEyePrompt = GodsEyePromptConfig{
		Mode:          "text",
		Classes:       []string{"person", "backpack", "handbag", "suitcase", "laptop", "cell phone"},
		ReferImage:    "",
		VisualPrompts: []map[string]interface{}{},
		UpdatedAt:     time.Now(),
	}

	// Recent detection events per camera_key, capped at 200 per key.
	godsEyeEventsMu sync.RWMutex
	godsEyeEvents   = map[string][]GodsEyeDetectionEvent{}
)

// GetGodsEyePrompts — GET /api/gods-eye/prompts
// Jetsons poll this every 1s to get the current class list.
// workerId and cameraId query params are accepted but we return global config.
func GetGodsEyePrompts(c *gin.Context) {
	godsEyeMu.RLock()
	cfg := godsEyePrompt
	godsEyeMu.RUnlock()
	c.JSON(http.StatusOK, cfg)
}

// SetGodsEyePrompts — PUT /api/gods-eye/prompts
// Frontend calls this to update the active class list.
func SetGodsEyePrompts(c *gin.Context) {
	var body struct {
		Mode          string                   `json:"mode"`
		Classes       []string                 `json:"classes"`
		ReferImage    string                   `json:"referImage"`
		VisualPrompts []map[string]interface{} `json:"visualPrompts"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	mode := body.Mode
	if mode == "" {
		mode = "text"
	}
	classes := body.Classes
	if classes == nil {
		classes = []string{}
	}
	visualPrompts := body.VisualPrompts
	if visualPrompts == nil {
		visualPrompts = []map[string]interface{}{}
	}

	godsEyeMu.Lock()
	godsEyePrompt = GodsEyePromptConfig{
		Mode:          mode,
		Classes:       classes,
		ReferImage:    body.ReferImage,
		VisualPrompts: visualPrompts,
		UpdatedAt:     time.Now(),
	}
	godsEyeMu.Unlock()

	c.JSON(http.StatusOK, gin.H{"ok": true, "classes": classes, "mode": mode})
}

// PostGodsEyeDetections — POST /api/gods-eye/detections
// Jetsons batch-post detection events here every 10s.
func PostGodsEyeDetections(c *gin.Context) {
	var payload GodsEyeDetectionsPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	key := payload.CameraKey
	if key == "" {
		key = payload.WorkerID + "." + payload.CameraID
	}

	godsEyeEventsMu.Lock()
	existing := godsEyeEvents[key]
	existing = append(existing, payload.Events...)
	if len(existing) > 200 {
		existing = existing[len(existing)-200:]
	}
	godsEyeEvents[key] = existing
	godsEyeEventsMu.Unlock()

	c.JSON(http.StatusOK, gin.H{"ok": true, "stored": len(payload.Events)})
}

// GetGodsEyeDetections — GET /api/gods-eye/detections
// Frontend fetches recent detection events.
func GetGodsEyeDetections(c *gin.Context) {
	godsEyeEventsMu.Lock()
	defer godsEyeEventsMu.Unlock()

	now := float64(time.Now().Unix())
	expiry := 3600.0 // 1 hour

	result := map[string][]GodsEyeDetectionEvent{}
	for k, v := range godsEyeEvents {
		// Filter out old events
		filtered := make([]GodsEyeDetectionEvent, 0, len(v))
		for _, e := range v {
			if now-e.Ts < expiry {
				filtered = append(filtered, e)
			}
		}

		if len(filtered) > 0 {
			godsEyeEvents[k] = filtered
			cp := make([]GodsEyeDetectionEvent, len(filtered))
			copy(cp, filtered)
			result[k] = cp
		} else {
			delete(godsEyeEvents, k)
		}
	}
	c.JSON(http.StatusOK, result)
}
