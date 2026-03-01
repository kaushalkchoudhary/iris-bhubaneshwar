package handlers

import (
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/irisdrone/backend/database"
	"github.com/irisdrone/backend/models"
)

type frsNodeHeartbeat struct {
	NodeID            string                 `json:"node_id"`
	NodeRole          string                 `json:"node_role"` // ingress | worker
	NodeIP            string                 `json:"node_ip"`
	WorkerID          string                 `json:"worker_id"`
	ProcessedFrames   int64                  `json:"processed_frames"`
	PublishedEvents   int64                  `json:"published_events"`
	ConnectedCameras  int                    `json:"connected_cameras"`
	ActiveAssignments int                    `json:"active_assignments"`
	Metadata          map[string]interface{} `json:"metadata"`
	UpdatedAt         time.Time              `json:"updated_at"`
}

var (
	frsNodesMu sync.RWMutex
	frsNodes   = map[string]frsNodeHeartbeat{}
)

func parseAnalytics(raw interface{}) []string {
	switch t := raw.(type) {
	case []string:
		return t
	case []interface{}:
		out := make([]string, 0, len(t))
		for _, v := range t {
			if s, ok := v.(string); ok {
				s = strings.TrimSpace(strings.ToLower(s))
				if s != "" {
					out = append(out, s)
				}
			}
		}
		return out
	default:
		return nil
	}
}

func analyticsHasFRS(list []string) bool {
	for _, s := range list {
		switch strings.TrimSpace(strings.ToLower(s)) {
		case "frs", "face", "face_recognition":
			return true
		}
	}
	return false
}

func pickIngressWorker(workers []models.Worker) string {
	preferred := strings.TrimSpace(os.Getenv("FRS_INGRESS_WORKER_ID"))
	if preferred != "" {
		for _, w := range workers {
			if w.ID == preferred {
				return preferred
			}
		}
	}

	if len(workers) == 0 {
		return ""
	}
	sort.Slice(workers, func(i, j int) bool {
		return workers[i].CreatedAt.Before(workers[j].CreatedAt)
	})
	return workers[0].ID
}

// GetFRSDistributedPlan returns worker and camera plan for distributed FRS orchestration.
// GET /api/frs/distributed/plan
func GetFRSDistributedPlan(c *gin.Context) {
	type cameraItem struct {
		DeviceID          string   `json:"device_id"`
		Name              string   `json:"name"`
		RTSPUrl           string   `json:"rtsp_url"`
		AssignedWorkerID  string   `json:"assigned_worker_id,omitempty"`
		AssignedWorkerIP  string   `json:"assigned_worker_ip,omitempty"`
		AssignedAnalytics []string `json:"assigned_analytics,omitempty"`
	}
	type workerItem struct {
		ID                 string    `json:"id"`
		Name               string    `json:"name"`
		IP                 string    `json:"ip"`
		Status             string    `json:"status"`
		LastSeen           time.Time `json:"last_seen"`
		AssignedFRSCameras int       `json:"assigned_frs_cameras"`
	}

	var workers []models.Worker
	if err := database.DB.Order("created_at ASC").Find(&workers).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load workers"})
		return
	}

	var assignments []models.WorkerCameraAssignment
	if err := database.DB.Where("is_active = true").Find(&assignments).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load assignments"})
		return
	}

	workerByID := make(map[string]models.Worker, len(workers))
	workerCameraCount := make(map[string]int, len(workers))
	for _, w := range workers {
		workerByID[w.ID] = w
	}

	assignByDevice := map[string]models.WorkerCameraAssignment{}
	for _, a := range assignments {
		analytics := parseAnalytics(a.Analytics.Data)
		if !analyticsHasFRS(analytics) {
			continue
		}
		assignByDevice[a.DeviceID] = a
		workerCameraCount[a.WorkerID]++
	}

	var devices []models.Device
	if err := database.DB.Where("type = ? AND rtsp_url IS NOT NULL", models.DeviceTypeCamera).Order("created_at ASC").Find(&devices).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load camera devices"})
		return
	}

	cameras := make([]cameraItem, 0, len(devices))
	for _, d := range devices {
		rtsp := strings.TrimSpace("")
		if d.RTSPUrl != nil {
			rtsp = strings.TrimSpace(*d.RTSPUrl)
		}
		if rtsp == "" {
			continue
		}
		item := cameraItem{
			DeviceID: d.ID,
			Name:     d.ID,
			RTSPUrl:  rtsp,
		}
		if d.Name != nil && strings.TrimSpace(*d.Name) != "" {
			item.Name = strings.TrimSpace(*d.Name)
		}
		if a, ok := assignByDevice[d.ID]; ok {
			item.AssignedWorkerID = a.WorkerID
			item.AssignedAnalytics = parseAnalytics(a.Analytics.Data)
			if w, ok := workerByID[a.WorkerID]; ok {
				item.AssignedWorkerIP = strings.TrimSpace(w.IP)
			}
		}
		cameras = append(cameras, item)
	}

	workerItems := make([]workerItem, 0, len(workers))
	for _, w := range workers {
		workerItems = append(workerItems, workerItem{
			ID:                 w.ID,
			Name:               w.Name,
			IP:                 strings.TrimSpace(w.IP),
			Status:             string(w.Status),
			LastSeen:           w.LastSeen,
			AssignedFRSCameras: workerCameraCount[w.ID],
		})
	}

	ingressWorkerID := pickIngressWorker(workers)

	c.JSON(http.StatusOK, gin.H{
		"generated_at":      time.Now().UTC().Format(time.RFC3339),
		"ingress_worker_id": ingressWorkerID,
		"workers":           workerItems,
		"cameras":           cameras,
		"total_workers":     len(workerItems),
		"total_cameras":     len(cameras),
	})
}

// PostFRSDistributedHeartbeat stores latest status from distributed FRS nodes.
// POST /api/frs/distributed/heartbeat
func PostFRSDistributedHeartbeat(c *gin.Context) {
	var req frsNodeHeartbeat
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.NodeID = strings.TrimSpace(req.NodeID)
	if req.NodeID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "node_id is required"})
		return
	}
	req.NodeRole = strings.TrimSpace(strings.ToLower(req.NodeRole))
	if req.NodeRole == "" {
		req.NodeRole = "worker"
	}
	if req.Metadata == nil {
		req.Metadata = map[string]interface{}{}
	}
	req.UpdatedAt = time.Now().UTC()

	frsNodesMu.Lock()
	frsNodes[req.NodeID] = req
	frsNodesMu.Unlock()

	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// GetFRSDistributedNodes returns in-memory distributed node statuses.
// GET /api/frs/distributed/nodes
func GetFRSDistributedNodes(c *gin.Context) {
	frsNodesMu.RLock()
	defer frsNodesMu.RUnlock()

	nodes := make([]frsNodeHeartbeat, 0, len(frsNodes))
	for _, n := range frsNodes {
		nodes = append(nodes, n)
	}
	sort.Slice(nodes, func(i, j int) bool {
		return nodes[i].UpdatedAt.After(nodes[j].UpdatedAt)
	})

	c.JSON(http.StatusOK, gin.H{
		"nodes":       nodes,
		"total_nodes": len(nodes),
	})
}
