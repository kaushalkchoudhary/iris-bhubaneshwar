package handlers

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/irisdrone/backend/database"
	"github.com/irisdrone/backend/models"
)

type workerConfigAnalytic struct {
	AnalyticCode string                 `json:"analyticCode"`
	Config       map[string]interface{} `json:"config"`
}

type workerConfigResponse struct {
	ID        string                 `json:"id"`
	Name      string                 `json:"name"`
	RTSPUrl   string                 `json:"rtspUrl"`
	WorkerID  *string                `json:"workerId,omitempty"`
	Location  map[string]interface{} `json:"location"`
	Analytics []workerConfigAnalytic `json:"analytics"`
}

func toStringSlice(raw interface{}) []string {
	if raw == nil {
		return nil
	}
	switch arr := raw.(type) {
	case []string:
		return arr
	case []interface{}:
		out := make([]string, 0, len(arr))
		for _, v := range arr {
			if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
				out = append(out, strings.TrimSpace(s))
			}
		}
		return out
	default:
		return nil
	}
}

func toStringMap(raw interface{}) map[string]interface{} {
	if raw == nil {
		return nil
	}
	switch m := raw.(type) {
	case map[string]interface{}:
		out := make(map[string]interface{}, len(m))
		for k, v := range m {
			out[k] = v
		}
		return out
	case map[interface{}]interface{}:
		out := make(map[string]interface{}, len(m))
		for k, v := range m {
			if s, ok := k.(string); ok {
				out[s] = v
			}
		}
		return out
	default:
		return nil
	}
}

func mapServiceToAnalyticCode(service string) string {
	switch strings.ToLower(strings.TrimSpace(service)) {
	case "crowd":
		return "crowd-counting"
	case "crowd_flow":
		return "crowd-flow"
	case "frs":
		return "A-6"
	case "anpr_vcc":
		return "anpr-vcc"
	default:
		return ""
	}
}

// GetWorkerConfigs provides camera analytics config for inference orchestrators.
// This is intentionally lightweight and tolerant of partially configured devices.
func GetWorkerConfigs(c *gin.Context) {
	var devices []models.Device
	if err := database.DB.Where("type = ?", models.DeviceTypeCamera).Find(&devices).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"status": "error", "error": "failed to load devices"})
		return
	}

	out := make([]workerConfigResponse, 0, len(devices))
	for _, d := range devices {
		if d.RTSPUrl == nil || strings.TrimSpace(*d.RTSPUrl) == "" {
			continue
		}

		cfgMap, _ := d.Config.Data.(map[string]interface{})
		services := toStringSlice(cfgMap["services"])

		analytics := make([]workerConfigAnalytic, 0, len(services))
		for _, s := range services {
			code := mapServiceToAnalyticCode(s)
			if code == "" {
				continue
			}
			serviceCfg := toStringMap(cfgMap[s])
			if serviceCfg == nil {
				serviceCfg = map[string]interface{}{}
			}
			if _, ok := serviceCfg["service"]; !ok {
				serviceCfg["service"] = s
			}
			if _, ok := serviceCfg["isActive"]; !ok {
				serviceCfg["isActive"] = true
			}
			if _, ok := serviceCfg["jetson_id"]; !ok {
				if jetsonID, ok := cfgMap["jetsonId"].(string); ok && strings.TrimSpace(jetsonID) != "" {
					serviceCfg["jetson_id"] = strings.TrimSpace(jetsonID)
				}
			}
			if d.WorkerID != nil && strings.TrimSpace(*d.WorkerID) != "" {
				if _, ok := serviceCfg["worker_id"]; !ok {
					serviceCfg["worker_id"] = strings.TrimSpace(*d.WorkerID)
				}
			}
			analytics = append(analytics, workerConfigAnalytic{
				AnalyticCode: code,
				Config:       serviceCfg,
			})
		}

		zoneName := ""
		if d.ZoneID != nil {
			zoneName = *d.ZoneID
		}
		deviceName := d.ID
		if d.Name != nil && strings.TrimSpace(*d.Name) != "" {
			deviceName = *d.Name
		}
		locationID := d.ID
		if d.ZoneID != nil && strings.TrimSpace(*d.ZoneID) != "" {
			locationID = *d.ZoneID
		}

		out = append(out, workerConfigResponse{
			ID:       d.ID,
			Name:     deviceName,
			RTSPUrl:  *d.RTSPUrl,
			WorkerID: d.WorkerID,
			Location: map[string]interface{}{
				"id":   locationID,
				"name": zoneName,
			},
			Analytics: analytics,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data":   out,
	})
}

// GetInferenceFocus exposes currently focused device id (if any).
func GetInferenceFocus(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"focusedDeviceId": nil,
	})
}
