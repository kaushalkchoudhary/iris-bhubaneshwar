package middleware

import (
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/irisdrone/backend/database"
	"github.com/irisdrone/backend/models"
)

func jwtTTL() time.Duration {
	// Default is 24h to preserve existing behavior unless configured.
	raw := strings.TrimSpace(os.Getenv("JWT_TTL_HOURS"))
	if raw == "" {
		return 24 * time.Hour
	}

	hours, err := strconv.Atoi(raw)
	if err != nil || hours <= 0 || hours > 24*30 {
		// Clamp obviously invalid values rather than failing auth.
		return 24 * time.Hour
	}
	return time.Duration(hours) * time.Hour
}

func jwtSecret() (string, error) {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		return "", fmt.Errorf("JWT_SECRET is not set")
	}
	return secret, nil
}

// AuthMiddleware validates JWT tokens
func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		var tokenString string

		// 1. Try Authorization Header
		authHeader := c.GetHeader("Authorization")
		if authHeader != "" {
			parts := strings.Split(authHeader, " ")
			if len(parts) == 2 && parts[0] == "Bearer" {
				tokenString = parts[1]
			}
		}

		// 2. Try Cookie (Browser media requests)
		if tokenString == "" {
			if cookie, err := c.Cookie("jwt_token"); err == nil {
				tokenString = cookie
			}
		}

		// 3. Try Query Parameter (Edge cases / Shareable links)
		if tokenString == "" {
			tokenString = c.Query("token")
		}

		if tokenString == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
			c.Abort()
			return
		}

		secret, secretErr := jwtSecret()
		if secretErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Server authentication is not configured"})
			c.Abort()
			return
		}

		// Parse and validate token
		token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
			}

			return []byte(secret), nil
		})

		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired token"})
			c.Abort()
			return
		}

		if claims, ok := token.Claims.(jwt.MapClaims); ok && token.Valid {
			// sub + tv are required for session binding.
			sub, ok := claims["sub"].(string)
			if !ok || sub == "" {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token claims"})
				c.Abort()
				return
			}

			// Token version is encoded as a string to avoid JSON number precision issues.
			tvRaw, ok := claims["tv"].(string)
			if !ok || tvRaw == "" {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired token"})
				c.Abort()
				return
			}
			tokenVersion, tvErr := strconv.ParseInt(tvRaw, 10, 64)
			if tvErr != nil {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired token"})
				c.Abort()
				return
			}

			// Check expiration
			if exp, ok := claims["exp"].(float64); ok {
				if time.Now().Unix() > int64(exp) {
					c.JSON(http.StatusUnauthorized, gin.H{"error": "Token expired"})
					c.Abort()
					return
				}
			}

			// Ensure token is the most recently issued for the user (single active session policy).
			var user models.User
			if err := database.DB.Select("token_version", "email").First(&user, "id = ?", sub).Error; err != nil {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired token"})
				c.Abort()
				return
			}
			if user.TokenVersion != tokenVersion {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired token"})
				c.Abort()
				return
			}

			// Set user context
			c.Set("userID", sub)
			c.Set("userRole", claims["role"])
			// Email is used for server-side audit logging and admin UI; do not trust any client-provided email.
			c.Set("userEmail", user.Email)
			c.Next()
		} else {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token claims"})
			c.Abort()
		}
	}
}

// UnifiedAuth allows both User (JWT) and Worker (Header) authentication.
// If roles are provided, it verifies the entity has at least one of them.
func UnifiedAuth(allowedRoles ...string) gin.HandlerFunc {
	rolesMap := make(map[string]struct{}, len(allowedRoles))
	for _, r := range allowedRoles {
		rolesMap[strings.ToLower(strings.TrimSpace(r))] = struct{}{}
	}

	return func(c *gin.Context) {
		authenticated := false
		var identityID string
		var identityRole string

		// 1. Try Worker Authentication
		workerID := c.GetHeader("X-Worker-ID")
		workerToken := c.GetHeader("X-Auth-Token")

		if workerID != "" {
			var worker models.Worker
			if err := database.DB.First(&worker, "id = ?", workerID).Error; err == nil {
				// Validate token (relaxed for dev/non-production if token is empty in DB)
				if worker.AuthToken == workerToken || (os.Getenv("ENV") != "production" && worker.AuthToken == "") {
					if worker.Status != models.WorkerStatusRevoked {
						identityID = worker.ID
						identityRole = "worker"
						authenticated = true
						c.Set("isWorker", true)
					}
				}
			}
		}

		// 2. Try JWT User Authentication (if not a worker)
		if !authenticated {
			authHeader := c.GetHeader("Authorization")
			if strings.HasPrefix(authHeader, "Bearer ") {
				tokenString := strings.TrimPrefix(authHeader, "Bearer ")
				secret, _ := jwtSecret()
				if secret != "" {
					token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
						return []byte(secret), nil
					})

					if err == nil && token.Valid {
						if claims, ok := token.Claims.(jwt.MapClaims); ok {
							sub, _ := claims["sub"].(string)
							role, _ := claims["role"].(string)
							tvRaw, _ := claims["tv"].(string)
							
							if sub != "" && role != "" && tvRaw != "" {
								tokenVersion, _ := strconv.ParseInt(tvRaw, 10, 64)
								var user models.User
								if err := database.DB.Select("token_version", "email").First(&user, "id = ?", sub).Error; err == nil {
									if user.TokenVersion == tokenVersion {
										identityID = sub
										identityRole = role
										c.Set("userEmail", user.Email)
										authenticated = true
									}
								}
							}
						}
					}
				}
			}
		}

		if !authenticated {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Authentication required"})
			c.Abort()
			return
		}

		// 3. Set Context
		c.Set("userID", identityID)
		c.Set("userRole", identityRole)

		// 4. Role Check
		if len(rolesMap) > 0 {
			if _, ok := rolesMap[strings.ToLower(identityRole)]; !ok {
				c.JSON(http.StatusForbidden, gin.H{"error": "Insufficient privileges"})
				c.Abort()
				return
			}
		}

		c.Next()
	}
}

// RequireRoles blocks requests unless userRole claim matches one of allowed roles.
func RequireRoles(roles ...string) gin.HandlerFunc {
	allowed := make(map[string]struct{}, len(roles))
	for _, role := range roles {
		allowed[strings.ToLower(strings.TrimSpace(role))] = struct{}{}
	}

	return func(c *gin.Context) {
		rawRole, exists := c.Get("userRole")
		if !exists {
			c.JSON(http.StatusForbidden, gin.H{"error": "Insufficient privileges"})
			c.Abort()
			return
		}

		roleStr, ok := rawRole.(string)
		if !ok {
			c.JSON(http.StatusForbidden, gin.H{"error": "Insufficient privileges"})
			c.Abort()
			return
		}

		roleStr = strings.ToLower(strings.TrimSpace(roleStr))
		if _, ok := allowed[roleStr]; !ok {
			c.JSON(http.StatusForbidden, gin.H{"error": "Insufficient privileges"})
			c.Abort()
			return
		}

		c.Next()
	}
}

// GenerateToken creates a new JWT token for a user
func GenerateToken(userID, role string, tokenVersion int64) (string, error) {
	secret, err := jwtSecret()
	if err != nil {
		return "", err
	}

	claims := jwt.MapClaims{
		"sub":  userID,
		"role": role,
		"tv":   strconv.FormatInt(tokenVersion, 10),
		"iat":  time.Now().Unix(),
		"exp":  time.Now().Add(jwtTTL()).Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}
