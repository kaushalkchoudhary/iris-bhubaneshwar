package handlers

import (
	"crypto/rand"
	"encoding/base32"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/irisdrone/backend/database"
	"github.com/irisdrone/backend/models"
	"github.com/irisdrone/backend/services"
	"golang.org/x/crypto/bcrypt"
)

type OperatorAccount struct {
	ID                    string     `json:"id"`
	Email                 string     `json:"email"`
	Role                  string     `json:"role"`
	LastLogin             *time.Time `json:"lastLogin,omitempty"`
	LastLoginIP           string     `json:"lastLoginIP,omitempty"`
	LastLoginUserAgent    string     `json:"lastLoginUserAgent,omitempty"`
	GeoIPCountry          string     `json:"geoipCountry,omitempty"`
	GeoIPRegion           string     `json:"geoipRegion,omitempty"`
	GeoIPCity             string     `json:"geoipCity,omitempty"`
	GeoIPLatitude         *float64   `json:"geoipLatitude,omitempty"`
	GeoIPLongitude        *float64   `json:"geoipLongitude,omitempty"`
	GeoIPTimezone         string     `json:"geoipTimezone,omitempty"`
	TokenVersion          int64      `json:"tokenVersion"`
	FailedLoginCount      int        `json:"failedLoginCount"`
	LastFailedLoginAt     *time.Time `json:"lastFailedLoginAt,omitempty"`
	LastFailedLoginIP     string     `json:"lastFailedLoginIP,omitempty"`
	LastFailedLoginUA     string     `json:"lastFailedLoginUserAgent,omitempty"`
	LockoutUntil          *time.Time `json:"lockoutUntil,omitempty"`
	PasswordResetRequired bool       `json:"passwordResetRequired"`
	PendingAdminApproval  bool       `json:"pendingAdminApproval"`
	Active                bool       `json:"active"`
	ActiveUntil           *time.Time `json:"activeUntil,omitempty"`
	CreatedAt             time.Time  `json:"createdAt"`
	UpdatedAt             time.Time  `json:"updatedAt"`
}

func jwtTTLHours() int {
	raw := strings.TrimSpace(os.Getenv("JWT_TTL_HOURS"))
	if raw == "" {
		return 24
	}
	h, err := strconv.Atoi(raw)
	if err != nil || h <= 0 || h > 24*30 {
		return 24
	}
	return h
}

// Admin: list operator console accounts (for lockout/unlock support).
func ListOperatorAccounts(c *gin.Context) {
	var users []models.User
	if err := database.DB.Where("LOWER(role) = ?", "operator").Find(&users).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load operators"})
		return
	}

	ttl := time.Duration(jwtTTLHours()) * time.Hour
	now := time.Now()

	out := make([]OperatorAccount, 0, len(users))
	pendingCount := 0
	for _, u := range users {
		var activeUntil *time.Time
		active := false
		if u.LastLogin != nil {
			t := u.LastLogin.Add(ttl)
			activeUntil = &t
			active = now.Before(t)
		}

		// GeoIP derived from last login IP (server-side, approximate).
		var g *services.GeoIPResult
		if strings.TrimSpace(u.LastLoginIP) != "" {
			if geo, err := services.LookupGeoIP(u.LastLoginIP); err == nil {
				g = geo
			}
		}

		out = append(out, OperatorAccount{
			ID:                 u.ID,
			Email:              u.Email,
			Role:               u.Role,
			LastLogin:          u.LastLogin,
			LastLoginIP:        u.LastLoginIP,
			LastLoginUserAgent: u.LastLoginUserAgent,
			GeoIPCountry: func() string {
				if g == nil {
					return ""
				}
				return g.Country
			}(),
			GeoIPRegion: func() string {
				if g == nil {
					return ""
				}
				return g.Region
			}(),
			GeoIPCity: func() string {
				if g == nil {
					return ""
				}
				return g.City
			}(),
			GeoIPLatitude: func() *float64 {
				if g == nil {
					return nil
				}
				return g.Latitude
			}(),
			GeoIPLongitude: func() *float64 {
				if g == nil {
					return nil
				}
				return g.Longitude
			}(),
			GeoIPTimezone: func() string {
				if g == nil {
					return ""
				}
				return g.Timezone
			}(),
			TokenVersion:          u.TokenVersion,
			FailedLoginCount:      u.FailedLoginCount,
			LastFailedLoginAt:     u.LastFailedLoginAt,
			LastFailedLoginIP:     u.LastFailedLoginIP,
			LastFailedLoginUA:     u.LastFailedLoginUA,
			LockoutUntil:          u.LockoutUntil,
			PasswordResetRequired: u.PasswordResetRequired,
			PendingAdminApproval:  u.PendingAdminApproval,
			Active:                active,
			ActiveUntil:           activeUntil,
			CreatedAt:             u.CreatedAt,
			UpdatedAt:             u.UpdatedAt,
		})
		if u.PendingAdminApproval {
			pendingCount++
		}
	}

	c.JSON(http.StatusOK, gin.H{"operators": out, "pendingApprovals": pendingCount})
}

// Admin: list recent operator login events.
func ListOperatorLoginEvents(c *gin.Context) {
	limit := 200
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v > 0 && v <= 1000 {
			limit = v
		}
	}

	// Optional filters for audit usage.
	eventType := strings.TrimSpace(strings.ToLower(c.Query("eventType")))
	email := strings.TrimSpace(strings.ToLower(c.Query("email")))
	fromRaw := strings.TrimSpace(c.Query("from"))
	toRaw := strings.TrimSpace(c.Query("to"))

	q := database.DB.Model(&models.AuthEvent{}).Where("LOWER(role) = ?", "operator")
	if eventType != "" {
		q = q.Where("LOWER(event_type) = ?", eventType)
	}
	if email != "" {
		q = q.Where("LOWER(email) = ?", email)
	}
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

	var events []models.AuthEvent
	if err := q.Order("occurred_at desc").Limit(limit).Find(&events).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load operator login events"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"events": events})
}

// Admin: force-logout an operator by rotating token_version (single-session binding).
func ForceLogoutOperator(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing operator id"})
		return
	}

	tv, err := newTokenVersion()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to rotate session"})
		return
	}

	res := database.DB.Model(&models.User{}).Where("id = ? AND LOWER(role) = ?", id, "operator").Updates(map[string]any{
		"token_version": tv,
	})
	if res.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to force logout"})
		return
	}
	if res.RowsAffected != 1 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Operator not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Operator session revoked"})
}

// Admin: unlock operator early (clears lockout + counters).
func UnlockOperatorAccount(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing operator id"})
		return
	}

	res := database.DB.Model(&models.User{}).Where("id = ? AND LOWER(role) = ?", id, "operator").Updates(map[string]any{
		"failed_login_count":           0,
		"last_failed_login_at":         nil,
		"last_failed_login_ip":         "",
		"last_failed_login_user_agent": "",
		"lockout_until":                nil,
	})
	if res.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to unlock operator"})
		return
	}
	if res.RowsAffected != 1 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Operator not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Operator unlocked"})
}

type ResetOperatorPasswordRequest struct {
	Password string `json:"password,omitempty"`
}

func randomTempPassword() (string, error) {
	// 20 chars, upper-case base32, no padding.
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return strings.TrimRight(base32.StdEncoding.EncodeToString(b), "="), nil
}

// Admin: reset operator password (returns the new password once).
func ResetOperatorPassword(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing operator id"})
		return
	}

	var req ResetOperatorPasswordRequest
	_ = c.ShouldBindJSON(&req)

	pw := strings.TrimSpace(req.Password)
	if pw == "" {
		tmp, err := randomTempPassword()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate password"})
			return
		}
		pw = tmp
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
		return
	}

	// Reset password + unlock.
	res := database.DB.Model(&models.User{}).Where("id = ? AND LOWER(role) = ?", id, "operator").Updates(map[string]any{
		"password_hash":                string(hashed),
		"password_reset_required":      true,
		"pending_admin_approval":       true,
		"failed_login_count":           0,
		"last_failed_login_at":         nil,
		"last_failed_login_ip":         "",
		"last_failed_login_user_agent": "",
		"lockout_until":                nil,
	})
	if res.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to reset password"})
		return
	}
	if res.RowsAffected != 1 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Operator not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":         "Operator password reset",
		"password":        pw,
		"note":            "Share this temporary password securely. Operator must set a new password, then wait for admin approval.",
		"unlocked":        true,
		"pendingApproval": true,
	})
}

// Admin: approve operator access after reset workflow.
func ApproveOperatorAccess(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Missing operator id"})
		return
	}

	res := database.DB.Model(&models.User{}).Where("id = ? AND LOWER(role) = ?", id, "operator").Updates(map[string]any{
		"pending_admin_approval":       false,
		"failed_login_count":           0,
		"last_failed_login_at":         nil,
		"last_failed_login_ip":         "",
		"last_failed_login_user_agent": "",
		"lockout_until":                nil,
	})
	if res.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to approve operator"})
		return
	}
	if res.RowsAffected != 1 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Operator not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Operator access approved"})
}
