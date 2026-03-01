package middleware

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

const (
	csrfCookieName   = "csrf_token"
	csrfHeaderName   = "X-CSRF-Token"
	csrfCookieMaxAge = 7200 // 2 hours
)

func isSafeMethod(method string) bool {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return true
	default:
		return false
	}
}

func shouldEnforceCSRF(c *gin.Context) bool {
	path := c.Request.URL.Path
	if !strings.HasPrefix(path, "/api/") {
		return false
	}
	if isSafeMethod(c.Request.Method) {
		return false
	}

	// Exempt machine-to-machine requests that use Worker ID/Token headers.
	// These are typically Edge devices/Workers and do not use browser sessions.
	if c.GetHeader("X-Worker-ID") != "" {
		return false
	}

	// Exempt other specific paths.
	if isCSRFExemptPath(path) {
		return false
	}
	return true
}

func isCSRFExemptPath(path string) bool {
	switch path {
	case "/api/devices/beat", "/api/events/ingest", "/api/workers/register", "/api/workers/request-approval":
		return true
	case "/api/inference/crowd/analysis", "/api/inference/crowd/live-frame":
		return true
	// Login and password-reset establish sessions – CSRF on these endpoints provides
	// no meaningful protection and breaks clients whose CSRF cookie/cache has expired.
	case "/api/auth/login", "/api/auth/operator/reset-password":
		return true
	}

	if strings.HasPrefix(path, "/api/workers/") {
		if strings.HasSuffix(path, "/heartbeat") || strings.HasSuffix(path, "/cameras") || strings.Contains(path, "/cameras/") || strings.HasSuffix(path, "/wireguard/setup") {
			return true
		}
	}

	return false
}

func generateCSRFToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func setCSRFCookie(c *gin.Context, token string) {
	secure := strings.EqualFold(strings.TrimSpace(os.Getenv("ENV")), "production")
	c.SetSameSite(http.SameSiteStrictMode)
	c.SetCookie(csrfCookieName, token, csrfCookieMaxAge, "/", "", secure, true)
}

// EnsureCSRFCookie guarantees a CSRF token cookie exists and returns its token value.
func EnsureCSRFCookie(c *gin.Context) (string, error) {
	if token, err := c.Cookie(csrfCookieName); err == nil && strings.TrimSpace(token) != "" {
		return token, nil
	}

	token, err := generateCSRFToken()
	if err != nil {
		return "", err
	}
	setCSRFCookie(c, token)
	return token, nil
}

func validateCSRF(c *gin.Context) error {
	cookieToken, err := c.Cookie(csrfCookieName)
	if err != nil || strings.TrimSpace(cookieToken) == "" {
		return errors.New("Missing CSRF cookie")
	}

	headerToken := strings.TrimSpace(c.GetHeader(csrfHeaderName))
	if headerToken == "" {
		return errors.New("Missing CSRF token")
	}

	if subtle.ConstantTimeCompare([]byte(cookieToken), []byte(headerToken)) != 1 {
		return errors.New("Invalid CSRF token")
	}
	return nil
}

// CSRFMiddleware issues CSRF cookies on safe requests and enforces token checks on unsafe API requests.
func CSRFMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if _, err := EnsureCSRFCookie(c); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to initialize CSRF token"})
			c.Abort()
			return
		}

		if shouldEnforceCSRF(c) {
			if err := validateCSRF(c); err != nil {
				c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
				c.Abort()
				return
			}
		}

		c.Next()
	}
}
