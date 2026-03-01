package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/irisdrone/backend/middleware"
)

// GetCSRFToken returns the CSRF token and ensures the matching cookie is set.
func GetCSRFToken(c *gin.Context) {
	token, err := middleware.EnsureCSRFCookie(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate CSRF token"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"csrfToken": token})
}
