package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/irisdrone/backend/database"
	"github.com/irisdrone/backend/models"
)

// CreateTokenRequest - Request to create a new worker token
type CreateTokenRequest struct {
	Name       string `json:"name" binding:"required"`       // Description
	ExpiresIn  int    `json:"expires_in"`                    // Hours until expiry (0 = no expiry)
	CreatedBy  string `json:"created_by,omitempty"`          // User ID
}

// CreateWorkerToken generates a new registration token (admin)
// POST /api/admin/worker-tokens
func CreateWorkerToken(c *gin.Context) {
	var req CreateTokenRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Generate token
	token := models.WorkerToken{
		ID:        generateID("wkt"),
		Token:     "wkt_" + generateAuthToken(), // Prefix for easy identification
		Name:      req.Name,
		CreatedBy: req.CreatedBy,
	}

	if token.CreatedBy == "" {
		token.CreatedBy = "admin" // Default
	}

	// Set expiry if specified
	if req.ExpiresIn > 0 {
		expiry := time.Now().Add(time.Duration(req.ExpiresIn) * time.Hour)
		token.ExpiresAt = &expiry
	}

	if err := database.DB.Create(&token).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create token"})
		return
	}

	c.JSON(http.StatusCreated, token)
}

// GetWorkerTokens lists all worker tokens (admin)
// GET /api/admin/worker-tokens
func GetWorkerTokens(c *gin.Context) {
	showUsed := c.Query("show_used") == "true"
	showRevoked := c.Query("show_revoked") == "true"

	query := database.DB.Model(&models.WorkerToken{})

	if !showUsed {
		query = query.Where("used_by IS NULL")
	}
	if !showRevoked {
		query = query.Where("is_revoked = false")
	}

	var tokens []models.WorkerToken
	query.Order("created_at DESC").Find(&tokens)

	// Add status field for UI
	type TokenWithStatus struct {
		models.WorkerToken
		Status string `json:"status"`
	}

	result := make([]TokenWithStatus, len(tokens))
	for i, t := range tokens {
		status := "active"
		if t.IsRevoked {
			status = "revoked"
		} else if t.UsedBy != nil {
			status = "used"
		} else if t.ExpiresAt != nil && t.ExpiresAt.Before(time.Now()) {
			status = "expired"
		}
		result[i] = TokenWithStatus{
			WorkerToken: t,
			Status:      status,
		}
	}

	c.JSON(http.StatusOK, result)
}

// GetWorkerToken returns a single token details (admin)
// GET /api/admin/worker-tokens/:id
func GetWorkerToken(c *gin.Context) {
	tokenID := c.Param("id")

	var token models.WorkerToken
	if err := database.DB.First(&token, "id = ?", tokenID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Token not found"})
		return
	}

	// Add status
	status := "active"
	if token.IsRevoked {
		status = "revoked"
	} else if token.UsedBy != nil {
		status = "used"
	} else if token.ExpiresAt != nil && token.ExpiresAt.Before(time.Now()) {
		status = "expired"
	}

	c.JSON(http.StatusOK, gin.H{
		"id":         token.ID,
		"token":      token.Token,
		"name":       token.Name,
		"status":     status,
		"used_by":    token.UsedBy,
		"used_at":    token.UsedAt,
		"expires_at": token.ExpiresAt,
		"is_revoked": token.IsRevoked,
		"created_by": token.CreatedBy,
		"created_at": token.CreatedAt,
	})
}

// RevokeWorkerToken revokes a token (admin)
// POST /api/admin/worker-tokens/:id/revoke
func RevokeWorkerToken(c *gin.Context) {
	tokenID := c.Param("id")

	var token models.WorkerToken
	if err := database.DB.First(&token, "id = ?", tokenID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Token not found"})
		return
	}

	if token.IsRevoked {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Token is already revoked"})
		return
	}

	token.IsRevoked = true
	database.DB.Save(&token)

	c.JSON(http.StatusOK, gin.H{"message": "Token revoked successfully"})
}

// DeleteWorkerToken deletes a token (admin)
// DELETE /api/admin/worker-tokens/:id
func DeleteWorkerToken(c *gin.Context) {
	tokenID := c.Param("id")

	result := database.DB.Delete(&models.WorkerToken{}, "id = ?", tokenID)
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Token not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Token deleted successfully"})
}

// BulkCreateTokensRequest - Request to create multiple tokens
type BulkCreateTokensRequest struct {
	Count     int    `json:"count" binding:"required,min=1,max=100"`
	Prefix    string `json:"prefix"`             // Name prefix
	ExpiresIn int    `json:"expires_in"`         // Hours
	CreatedBy string `json:"created_by,omitempty"`
}

// BulkCreateWorkerTokens creates multiple tokens at once (admin)
// POST /api/admin/worker-tokens/bulk
func BulkCreateWorkerTokens(c *gin.Context) {
	var req BulkCreateTokensRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	prefix := req.Prefix
	if prefix == "" {
		prefix = "Worker"
	}

	createdBy := req.CreatedBy
	if createdBy == "" {
		createdBy = "admin"
	}

	var expiry *time.Time
	if req.ExpiresIn > 0 {
		exp := time.Now().Add(time.Duration(req.ExpiresIn) * time.Hour)
		expiry = &exp
	}

	tokens := make([]models.WorkerToken, req.Count)
	for i := 0; i < req.Count; i++ {
		tokens[i] = models.WorkerToken{
			ID:        generateID("wkt"),
			Token:     "wkt_" + generateAuthToken(),
			Name:      prefix + " " + string(rune('A'+i%26)), // A, B, C, ...
			ExpiresAt: expiry,
			CreatedBy: createdBy,
		}
	}

	if err := database.DB.Create(&tokens).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create tokens"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "Tokens created successfully",
		"count":   len(tokens),
		"tokens":  tokens,
	})
}

