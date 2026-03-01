package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/irisdrone/backend/database"
	"github.com/irisdrone/backend/models"
)

// Admin: list recent operator activity events (routes accessed in the console).
// GET /api/admin/auth/operators/:id/activity?limit=200&from=...&to=...&path=...&route=...&method=...&status=...
func ListOperatorActivityEvents(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing operator id"})
		return
	}

	limit := 200
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v > 0 && v <= 1000 {
			limit = v
		}
	}

	fromRaw := strings.TrimSpace(c.Query("from"))
	toRaw := strings.TrimSpace(c.Query("to"))
	pathLike := strings.TrimSpace(c.Query("path"))
	routeLike := strings.TrimSpace(c.Query("route"))
	method := strings.TrimSpace(strings.ToUpper(c.Query("method")))
	statusRaw := strings.TrimSpace(c.Query("status"))

	q := database.DB.Model(&models.OperatorActivityEvent{}).Where("user_id = ? AND LOWER(role) = ?", id, "operator")

	if fromRaw != "" {
		if t, err := time.Parse(time.RFC3339, fromRaw); err == nil {
			q = q.Where("occurred_at >= ?", t)
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Invalid from (RFC3339): %s", fromRaw)})
			return
		}
	}
	if toRaw != "" {
		if t, err := time.Parse(time.RFC3339, toRaw); err == nil {
			q = q.Where("occurred_at <= ?", t)
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Invalid to (RFC3339): %s", toRaw)})
			return
		}
	}
	if pathLike != "" {
		q = q.Where("path ILIKE ?", "%"+pathLike+"%")
	}
	if routeLike != "" {
		q = q.Where("route ILIKE ?", "%"+routeLike+"%")
	}
	if method != "" {
		q = q.Where("method = ?", method)
	}
	if statusRaw != "" {
		if v, err := strconv.Atoi(statusRaw); err == nil && v >= 100 && v <= 599 {
			q = q.Where("status = ?", v)
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid status"})
			return
		}
	}

	var events []models.OperatorActivityEvent
	if err := q.Order("occurred_at desc").Limit(limit).Find(&events).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load operator activity"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"events": events})
}

