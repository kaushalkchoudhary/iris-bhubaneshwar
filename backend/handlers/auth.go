package handlers

import (
	"crypto/rand"
	"encoding/binary"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/irisdrone/backend/database"
	"github.com/irisdrone/backend/middleware"
	"github.com/irisdrone/backend/models"
	"github.com/irisdrone/backend/services"
	"golang.org/x/crypto/bcrypt"
)

func enrichAuthEventFromIP(ev *models.AuthEvent, ip string) {
	geo, err := services.LookupGeoIP(ip)
	if err != nil || geo == nil {
		return
	}
	ev.GeoIPCountry = geo.Country
	ev.GeoIPRegion = geo.Region
	ev.GeoIPCity = geo.City
	ev.GeoIPLatitude = geo.Latitude
	ev.GeoIPLongitude = geo.Longitude
	ev.GeoIPTimezone = geo.Timezone
}

func firstIPFromHeader(raw string) string {
	if raw == "" {
		return ""
	}
	for _, p := range strings.Split(raw, ",") {
		candidate := strings.TrimSpace(p)
		if net.ParseIP(candidate) != nil {
			return candidate
		}
	}
	return ""
}

func effectiveClientIP(c *gin.Context) string {
	// Behind Cloudflare + nginx, prefer CF-Connecting-IP if present.
	if ip := firstIPFromHeader(c.GetHeader("CF-Connecting-IP")); ip != "" {
		return ip
	}
	if ip := firstIPFromHeader(c.GetHeader("True-Client-IP")); ip != "" {
		return ip
	}
	if ip := firstIPFromHeader(c.GetHeader("X-Forwarded-For")); ip != "" {
		return ip
	}
	return c.ClientIP()
}

func newTokenVersion() (int64, error) {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return 0, err
	}
	// Ensure it fits into Postgres BIGINT (signed int64).
	v := binary.BigEndian.Uint64(b[:]) & ((1 << 63) - 1) // 63-bit positive
	if v == 0 {
		v = 1
	}
	return int64(v), nil
}

func authIntEnv(name string, def int) int {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return def
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v <= 0 {
		return def
	}
	return v
}

func lockoutPolicyForRole(role string) (enforce bool, maxAttempts int, window time.Duration, lockout time.Duration) {
	role = strings.ToLower(strings.TrimSpace(role))

	// Admin should never be locked out.
	if role == "admin" {
		return false, 0, 0, 0
	}

	// Operator lockout: 3 attempts -> 10 minutes.
	// Window is just for grouping consecutive failures; keep it conservative.
	if role == "operator" {
		maxAttempts = authIntEnv("AUTH_OPERATOR_MAX_FAILED_ATTEMPTS", 3)
		windowMinutes := authIntEnv("AUTH_OPERATOR_FAIL_WINDOW_MINUTES", 15)
		lockoutMinutes := authIntEnv("AUTH_OPERATOR_LOCKOUT_MINUTES", 10)
		return true, maxAttempts, time.Duration(windowMinutes) * time.Minute, time.Duration(lockoutMinutes) * time.Minute
	}

	// Default: do not enforce (non-console roles shouldn't be able to log in anyway).
	return false, 0, 0, 0
}

// Dummy hash to reduce user-enumeration timing signals when email does not exist.
var dummyBcryptHash = []byte("$2a$10$7rE8Xl3u0Lk8gYcXj0uX0eQxgBvJ3Q2o0mVn7o9o3N4d2b0m1y9xW")

type LoginRequest struct {
	Email    string   `json:"email" binding:"required"`
	Password string   `json:"password" binding:"required"`
	Timezone string   `json:"timezone,omitempty"`
	NodeID   string   `json:"nodeId,omitempty"`
	Lat      *float64 `json:"lat,omitempty"`
	Lng      *float64 `json:"lng,omitempty"`
}

type RegisterRequest struct {
	Email     string `json:"email" binding:"required"`
	Password  string `json:"password" binding:"required"`
	FirstName string `json:"firstName"`
	LastName  string `json:"lastName"`
}

type OperatorSelfResetRequest struct {
	Email        string `json:"email" binding:"required"`
	TempPassword string `json:"tempPassword" binding:"required"`
	NewPassword  string `json:"newPassword" binding:"required"`
}

func isAllowedHumanRole(role string) bool {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "admin", "operator":
		return true
	default:
		return false
	}
}

// Login handles user authentication
func Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request parameters"})
		return
	}

	var user models.User
	if err := database.DB.Where("email = ?", req.Email).First(&user).Error; err != nil {
		_ = bcrypt.CompareHashAndPassword(dummyBcryptHash, []byte(req.Password))
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email or password"})
		return
	}

	now := time.Now()
	ip := effectiveClientIP(c)
	ua := c.GetHeader("User-Agent")

	enforceLockout, maxAttempts, window, lockout := lockoutPolicyForRole(user.Role)
	if enforceLockout && user.LockoutUntil != nil && user.LockoutUntil.After(now) {
		remainingSeconds := int64(user.LockoutUntil.Sub(now).Seconds())
		if remainingSeconds < 0 {
			remainingSeconds = 0
		}
		c.JSON(http.StatusLocked, gin.H{
			"error":            "Operator account locked for 10 minutes due to failed login attempts. Contact admin to unlock early.",
			"lockoutUntil":     user.LockoutUntil.UTC().Format(time.RFC3339),
			"remainingSeconds": remainingSeconds,
			"lockoutMinutes":   int(lockout.Minutes()),
		})
		return
	}

	// Calculate and verify password hash
	// In a real app we would use bcrypt.CompareHashAndPassword here
	// For this fix, since we are moving from hardcoded to DB, we need to handle initial users differently
	// or ensure we register them with hashed passwords.
	// Assuming new users are registered via Register endpoint which hashes password.
	err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password))
	if err != nil {
		if enforceLockout {
			newCount := 1
			if user.LastFailedLoginAt != nil && now.Sub(*user.LastFailedLoginAt) <= window {
				newCount = user.FailedLoginCount + 1
			}
			var lockoutUntil *time.Time
			if newCount >= maxAttempts {
				until := now.Add(lockout)
				lockoutUntil = &until
			}

			_ = database.DB.Model(&models.User{}).Where("id = ?", user.ID).Updates(map[string]any{
				"failed_login_count":           newCount,
				"last_failed_login_at":         &now,
				"last_failed_login_ip":         ip,
				"last_failed_login_user_agent": ua,
				"lockout_until":                lockoutUntil,
			}).Error

			if lockoutUntil != nil {
				// Audit: operator lockout.
				ev := &models.AuthEvent{
					ID:         generateID("auth"),
					UserID:     user.ID,
					Email:      user.Email,
					Role:       user.Role,
					EventType:  "lockout",
					OccurredAt: now,
					IP:         ip,
					UserAgent:  ua,
				}
				enrichAuthEventFromIP(ev, ip)
				_ = database.DB.Create(ev).Error

				c.JSON(http.StatusLocked, gin.H{
					"error":            "Operator account locked for 10 minutes due to failed login attempts. Contact admin to unlock early.",
					"lockoutUntil":     lockoutUntil.UTC().Format(time.RFC3339),
					"remainingSeconds": int64(lockout.Seconds()),
					"lockoutMinutes":   int(lockout.Minutes()),
				})
				return
			}
		} else {
			// Admin (or non-enforced roles): record last failed attempt for audit, but never lock out.
			_ = database.DB.Model(&models.User{}).Where("id = ?", user.ID).Updates(map[string]any{
				"last_failed_login_at":         &now,
				"last_failed_login_ip":         ip,
				"last_failed_login_user_agent": ua,
			}).Error
		}

		// Audit: login failure for known users (operators/admins).
		if isAllowedHumanRole(user.Role) {
			ev := &models.AuthEvent{
				ID:         generateID("auth"),
				UserID:     user.ID,
				Email:      user.Email,
				Role:       user.Role,
				EventType:  "login_failure",
				OccurredAt: now,
				IP:         ip,
				UserAgent:  ua,
			}
			enrichAuthEventFromIP(ev, ip)
			_ = database.DB.Create(ev).Error
		}

		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid email or password"})
		return
	}

	if !isAllowedHumanRole(user.Role) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Account role is not permitted for console login"})
		return
	}
	if strings.EqualFold(user.Role, "operator") && user.PasswordResetRequired {
		c.JSON(http.StatusForbidden, gin.H{
			"error": "Password reset required. Complete operator password reset to continue.",
			"code":  "password_reset_required",
		})
		return
	}
	if strings.EqualFold(user.Role, "operator") && user.PendingAdminApproval {
		c.JSON(http.StatusForbidden, gin.H{
			"error": "Operator access pending admin approval.",
			"code":  "pending_admin_approval",
		})
		return
	}

	// Update last login and reset lockout counters on success.
	user.LastLogin = &now

	// Invalidate prior sessions by rotating token version.
	tv, tvErr := newTokenVersion()
	if tvErr != nil {
		log.Printf("❌ Failed to generate token version (email=%s): %v", user.Email, tvErr)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}
	user.TokenVersion = tv

	// Persist login state before minting the JWT; otherwise tokens can be rejected.
	res := database.DB.Model(&models.User{}).Where("id = ?", user.ID).Updates(map[string]any{
		"last_login":                   &now,
		"last_login_ip":                ip,
		"last_login_user_agent":        ua,
		"token_version":                tv,
		"failed_login_count":           0,
		"last_failed_login_at":         nil,
		"last_failed_login_ip":         "",
		"last_failed_login_user_agent": "",
		"lockout_until":                nil,
	})
	if res.Error != nil || res.RowsAffected != 1 {
		log.Printf("❌ Failed to update user login state (email=%s, rows=%d): %v", user.Email, res.RowsAffected, res.Error)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

	// Generate JWT
	token, err := middleware.GenerateToken(user.ID, user.Role, user.TokenVersion)
	if err != nil {
		log.Printf("❌ Failed to generate JWT (email=%s): %v", user.Email, err)
		if strings.Contains(err.Error(), "JWT_SECRET") {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Server authentication is not configured"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		}
		return
	}

	// Audit: successful login.
	ev := &models.AuthEvent{
		ID:         generateID("auth"),
		UserID:     user.ID,
		Email:      user.Email,
		Role:       user.Role,
		EventType:  "login_success",
		OccurredAt: now,
		IP:         ip,
		UserAgent:  ua,
	}
	enrichAuthEventFromIP(ev, ip)
	_ = database.DB.Create(ev).Error

	// Set JWT cookie for browser media access
	secure := strings.EqualFold(strings.TrimSpace(os.Getenv("ENV")), "production")
	// Max age in seconds (match JWT TTL if possible, here using 24h as default safely)
	maxAge := 86400 
	c.SetSameSite(http.SameSiteStrictMode)
	c.SetCookie("jwt_token", token, maxAge, "/", "", secure, true)

	c.JSON(http.StatusOK, gin.H{
		"token": token,
		"user": gin.H{
			"id":        user.ID,
			"email":     user.Email,
			"role":      user.Role,
			"firstName": user.FirstName,
			"lastName":  user.LastName,
		},
	})
}

// Register creates a new user (Admin only or Public depending on policy - here we make it open for initial setup or restricted later)
func Register(c *gin.Context) {
	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Check if user exists
	var existing models.User
	if err := database.DB.Where("email = ?", req.Email).First(&existing).Error; err == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Email already registered"})
		return
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
		return
	}

	// Create user
	user := models.User{
		ID:           generateID("usr"), // Reusing generateID from workers.go if visible, else need to duplicate or move to utils
		Email:        req.Email,
		PasswordHash: string(hashedPassword),
		Role:         "user", // Default role
		FirstName:    req.FirstName,
		LastName:     req.LastName,
	}

	// Use existing ID generator or create simple UUID
	if user.ID == "" {
		// Fallback if generateID is not exported/available from here.
		// Ideally we should move generateID to a shared util package.
		// For now, assuming we can access it or duplicate simple logic.
		user.ID = "usr_" + req.Email // Temporary simple ID if needed, but better to use UUID
	}

	if err := database.DB.Create(&user).Error; err != nil {
		log.Printf("❌ Failed to create user (email=%s): %v", req.Email, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create user"})
		return
	}

	// Auto-login after register? Or just return success.
	c.JSON(http.StatusCreated, gin.H{
		"message": "User registered successfully",
		"id":      user.ID,
	})
}

// OperatorSelfResetPassword allows operators to set a new password after admin-issued reset.
// Account remains blocked until admin explicitly approves access.
func OperatorSelfResetPassword(c *gin.Context) {
	var req OperatorSelfResetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request parameters"})
		return
	}

	email := strings.TrimSpace(strings.ToLower(req.Email))
	newPw := strings.TrimSpace(req.NewPassword)
	if len(newPw) < 8 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "New password must be at least 8 characters"})
		return
	}

	var user models.User
	if err := database.DB.Where("email = ? AND LOWER(role) = ?", email, "operator").First(&user).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid reset credentials"})
		return
	}

	if !user.PasswordResetRequired {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Password reset is not required for this account"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.TempPassword)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid reset credentials"})
		return
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(newPw), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
		return
	}

	tv, tvErr := newTokenVersion()
	if tvErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to rotate session"})
		return
	}

	res := database.DB.Model(&models.User{}).Where("id = ? AND LOWER(role) = ?", user.ID, "operator").Updates(map[string]any{
		"password_hash":                string(hashed),
		"password_reset_required":      false,
		"pending_admin_approval":       true,
		"token_version":                tv,
		"failed_login_count":           0,
		"last_failed_login_at":         nil,
		"last_failed_login_ip":         "",
		"last_failed_login_user_agent": "",
		"lockout_until":                nil,
	})
	if res.Error != nil || res.RowsAffected != 1 {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to reset password"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Password updated. Account is pending admin approval before login is enabled.",
	})
}

// GetMe returns current user info
func GetMe(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var user models.User
	if err := database.DB.First(&user, "id = ?", userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":        user.ID,
		"email":     user.Email,
		"role":      user.Role,
		"firstName": user.FirstName,
		"lastName":  user.LastName,
	})
}
