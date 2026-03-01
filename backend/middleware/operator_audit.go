package middleware

import (
	"crypto/rand"
	"encoding/hex"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/irisdrone/backend/database"
	"github.com/irisdrone/backend/models"
)

func auditID(prefix string) string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return prefix + "_" + hex.EncodeToString(b)[:16]
}

func auditIgnorePrefixes() []string {
	// Keep this conservative; noisy endpoints can be added via env if needed.
	// Comma-separated prefixes.
	raw := strings.TrimSpace(os.Getenv("AUDIT_IGNORE_PREFIXES"))
	if raw == "" {
		return []string{
			"/api/auth/me",
			"/api/devices/beat",
			"/api/workers/",
			"/ws/",
		}
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func shouldAuditPath(path string, ignore []string) bool {
	for _, p := range ignore {
		if p == "" {
			continue
		}
		if strings.HasPrefix(path, p) {
			return false
		}
	}
	return true
}

// OperatorAuditMiddleware records operator actions (routes accessed) server-side.
// It relies on AuthMiddleware having set userID/userRole/userEmail on the context.
func OperatorAuditMiddleware() gin.HandlerFunc {
	ignore := auditIgnorePrefixes()

	return func(c *gin.Context) {
		start := time.Now()
		c.Next()

		rawRole, ok := c.Get("userRole")
		if !ok {
			return
		}
		role, ok := rawRole.(string)
		if !ok {
			return
		}
		role = strings.ToLower(strings.TrimSpace(role))
		if role != "operator" {
			return
		}

		rawID, ok := c.Get("userID")
		if !ok {
			return
		}
		userID, ok := rawID.(string)
		if !ok || strings.TrimSpace(userID) == "" {
			return
		}

		email := ""
		if rawEmail, ok := c.Get("userEmail"); ok {
			if e, ok := rawEmail.(string); ok {
				email = strings.TrimSpace(e)
			}
		}

		path := c.Request.URL.Path
		if !shouldAuditPath(path, ignore) {
			return
		}

		route := c.FullPath()
		// FullPath is empty when no route matched; keep a safe placeholder.
		if strings.TrimSpace(route) == "" {
			route = "-"
		}

		ev := &models.OperatorActivityEvent{
			ID:         auditID("opact"),
			UserID:     userID,
			Email:      email,
			Role:       role,
			OccurredAt: time.Now(),
			IP:         c.ClientIP(),
			UserAgent:  c.GetHeader("User-Agent"),
			Method:     c.Request.Method,
			Path:       path,
			Route:      route,
			Status:     c.Writer.Status(),
			LatencyMs:  time.Since(start).Milliseconds(),
		}

		// Best-effort: audit should never break the request path.
		_ = database.DB.Create(ev).Error
	}
}
