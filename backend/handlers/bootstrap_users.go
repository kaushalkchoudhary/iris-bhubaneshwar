package handlers

import (
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/irisdrone/backend/database"
	"github.com/irisdrone/backend/models"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

func envBool(name string) bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv(name)))
	return v == "1" || v == "true" || v == "yes" || v == "y"
}

func ensureUser(email, password, role string, force bool) error {
	email = strings.TrimSpace(strings.ToLower(email))
	if email == "" || password == "" || role == "" {
		return nil
	}

	var user models.User
	err := database.DB.Where("email = ?", email).First(&user).Error
	if err != nil && err != gorm.ErrRecordNotFound {
		return fmt.Errorf("lookup user (email=%s): %w", email, err)
	}

	// Only overwrite the hash if forced, missing, or clearly not a bcrypt hash.
	needPw := force || strings.TrimSpace(user.PasswordHash) == "" || !strings.HasPrefix(user.PasswordHash, "$2")
	var hashed string
	if needPw {
		h, hErr := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
		if hErr != nil {
			return fmt.Errorf("hash password (email=%s): %w", email, hErr)
		}
		hashed = string(h)
	}

	if err == gorm.ErrRecordNotFound {
		newUser := models.User{
			ID:           generateID("usr"),
			Email:        email,
			PasswordHash: hashed,
			Role:         role,
		}
		if newUser.PasswordHash == "" {
			return fmt.Errorf("bootstrap user (email=%s): password hash not set", email)
		}
		if cErr := database.DB.Create(&newUser).Error; cErr != nil {
			return fmt.Errorf("create user (email=%s): %w", email, cErr)
		}
		log.Printf("Bootstrapped user created (email=%s, role=%s)", email, role)
		return nil
	}

	updates := map[string]any{}

	// For explicit bootstrap emails, keep role aligned unless you deliberately turn this off.
	if force || strings.TrimSpace(user.Role) == "" || strings.ToLower(strings.TrimSpace(user.Role)) != role {
		updates["role"] = role
	}
	if needPw {
		updates["password_hash"] = hashed
	}

	// Always clear lockout, since bootstrap is used to recover access.
	updates["failed_login_count"] = 0
	updates["last_failed_login_at"] = nil
	updates["lockout_until"] = nil

	if len(updates) == 0 {
		return nil
	}
	if uErr := database.DB.Model(&models.User{}).Where("id = ?", user.ID).Updates(updates).Error; uErr != nil {
		return fmt.Errorf("update user (email=%s): %w", email, uErr)
	}

	log.Printf("Bootstrapped user updated (email=%s, role=%s, pw_reset=%v)", email, role, needPw)
	return nil
}

// EnsureBootstrapUsers creates/repairs the console accounts from env vars so you can't get locked out.
//
// Env:
// - BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD
// - BOOTSTRAP_OPERATOR_EMAIL / BOOTSTRAP_OPERATOR_PASSWORD
// - BOOTSTRAP_FORCE=1 (optional) force password + role reset
func EnsureBootstrapUsers() error {
	force := envBool("BOOTSTRAP_FORCE")

	adminEmail := os.Getenv("BOOTSTRAP_ADMIN_EMAIL")
	adminPass := os.Getenv("BOOTSTRAP_ADMIN_PASSWORD")
	if strings.TrimSpace(adminEmail) != "" || strings.TrimSpace(adminPass) != "" {
		if strings.TrimSpace(adminEmail) == "" || strings.TrimSpace(adminPass) == "" {
			log.Printf("WARN: bootstrap admin skipped: set both BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD")
		} else if err := ensureUser(adminEmail, adminPass, "admin", force); err != nil {
			return err
		}
	}

	opEmail := os.Getenv("BOOTSTRAP_OPERATOR_EMAIL")
	opPass := os.Getenv("BOOTSTRAP_OPERATOR_PASSWORD")
	if strings.TrimSpace(opEmail) != "" || strings.TrimSpace(opPass) != "" {
		if strings.TrimSpace(opEmail) == "" || strings.TrimSpace(opPass) == "" {
			log.Printf("WARN: bootstrap operator skipped: set both BOOTSTRAP_OPERATOR_EMAIL and BOOTSTRAP_OPERATOR_PASSWORD")
		} else if err := ensureUser(opEmail, opPass, "operator", force); err != nil {
			return err
		}
	}

	return nil
}
