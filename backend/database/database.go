package database

import (
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/irisdrone/backend/models"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB
var FRSDB *gorm.DB

// Main returns the primary application DB (auth/devices/workers/etc).
func Main() *gorm.DB {
	return DB
}

// FRS returns the FRS DB when configured, or falls back to primary DB.
func FRS() *gorm.DB {
	if FRSDB != nil {
		return FRSDB
	}
	return DB
}

func getGormLogLevel() logger.LogLevel {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("GORM_LOG_LEVEL"))) {
	case "silent":
		return logger.Silent
	case "error":
		return logger.Error
	case "warn", "warning":
		return logger.Warn
	case "info":
		return logger.Info
	default:
		// Default to warning to keep runtime logs readable.
		return logger.Warn
	}
}

func getGormLogger() logger.Interface {
	return logger.New(
		log.New(os.Stdout, "", log.LstdFlags),
		logger.Config{
			SlowThreshold:             500 * time.Millisecond,
			LogLevel:                  getGormLogLevel(),
			IgnoreRecordNotFoundError: true,
			Colorful:                  false,
		},
	)
}

// Connect initializes the database connection
func Connect() error {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return fmt.Errorf("DATABASE_URL environment variable is not set")
	}

	var err error
	DB, err = gorm.Open(postgres.Open(databaseURL), &gorm.Config{
		Logger: getGormLogger(),
	})

	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}

	log.Println("Database connected successfully")

	// Auto-migrate primary models.
	if err := autoMigratePrimary(DB); err != nil {
		return fmt.Errorf("failed to auto-migrate: %w", err)
	}

	frsDatabaseURL := strings.TrimSpace(os.Getenv("FRS_DATABASE_URL"))
	if frsDatabaseURL == "" || frsDatabaseURL == databaseURL {
		FRSDB = DB
		log.Println("FRS database not separately configured, using primary DB")
		if err := autoMigrateFRS(DB); err != nil {
			return fmt.Errorf("failed to auto-migrate FRS tables on primary DB: %w", err)
		}
		return nil
	}

	FRSDB, err = gorm.Open(postgres.Open(frsDatabaseURL), &gorm.Config{
		Logger:                                   getGormLogger(),
		DisableForeignKeyConstraintWhenMigrating: true,
	})
	if err != nil {
		return fmt.Errorf("failed to connect to FRS database: %w", err)
	}
	log.Println("FRS database connected successfully")

	if err := autoMigrateFRS(FRSDB); err != nil {
		return fmt.Errorf("failed to auto-migrate FRS database: %w", err)
	}

	return nil
}

func autoMigratePrimary(db *gorm.DB) error {
	if err := db.AutoMigrate(
		&models.User{},
		&models.AuthEvent{},
		&models.OperatorActivityEvent{},
		&models.Device{},
		&models.DeviceHeartbeat{},
		&models.Event{},
		&models.Worker{},
		&models.WorkerToken{},
		&models.WorkerCameraAssignment{},
		&models.WorkerApprovalRequest{},
		&models.CrowdAnalysis{},
		&models.CrowdAlert{},
		&models.TrafficViolation{},
		&models.Vehicle{},
		&models.VehicleDetection{},
		&models.Watchlist{},
		&models.WatchlistAlert{},
	); err != nil {
		return err
	}

	return nil
}

func autoMigrateFRS(db *gorm.DB) error {
	if err := db.AutoMigrate(
		&models.FRSPerson{},
		&models.GlobalIdentity{},
		&models.FRSDetection{},
	); err != nil {
		return err
	}

	if err := ensurePGVectorSchema(db); err != nil {
		return err
	}
	if err := ensureFRSForeignKeys(db); err != nil {
		return err
	}

	return nil
}

func ensurePGVectorSchema(db *gorm.DB) error {
	// Enable pgvector extension for high-performance embedding similarity search.
	if err := db.Exec(`CREATE EXTENSION IF NOT EXISTS vector`).Error; err != nil {
		// Local dev machines may run a PostgreSQL build without pgvector installed.
		// Keep startup resilient and run without embeddings in that case.
		if strings.Contains(strings.ToLower(err.Error()), `extension "vector" is not available`) {
			log.Printf("WARN: pgvector extension unavailable; skipping embeddings schema: %v", err)
			return nil
		}
		return err
	}

	if err := db.Exec(`
		CREATE TABLE IF NOT EXISTS embeddings (
			event_id BIGINT PRIMARY KEY REFERENCES frs_detections(id) ON DELETE CASCADE,
			embedding_vector vector(512) NOT NULL
		)
	`).Error; err != nil {
		return err
	}

	if err := db.Exec(`
		CREATE INDEX IF NOT EXISTS idx_embeddings_vector_ivfflat
		ON embeddings
		USING ivfflat (embedding_vector vector_cosine_ops)
		WITH (lists = 100)
	`).Error; err != nil {
		// Index creation can fail on empty/small datasets in some setups; keep startup resilient.
		log.Printf("WARN: pgvector index creation skipped: %v", err)
	}

	return nil
}

func ensureFRSForeignKeys(db *gorm.DB) error {
	// Remove any wrongly directed constraint left by earlier schema attempts.
	if err := db.Exec(`ALTER TABLE IF EXISTS global_identities DROP CONSTRAINT IF EXISTS fk_frs_detections_global_identity`).Error; err != nil {
		return err
	}

	// Create the correct relation:
	// frs_detections.global_identity_id -> global_identities.global_identity_id
	return db.Exec(`
		DO $$
		BEGIN
			IF NOT EXISTS (
				SELECT 1
				FROM pg_constraint
				WHERE conname = 'fk_frs_detections_global_identity'
			) THEN
				ALTER TABLE frs_detections
				ADD CONSTRAINT fk_frs_detections_global_identity
				FOREIGN KEY (global_identity_id)
				REFERENCES global_identities(global_identity_id)
				ON UPDATE CASCADE
				ON DELETE SET NULL;
			END IF;
		END $$;
	`).Error
}

// Close closes the database connection
func Close() error {
	sqlDB, err := DB.DB()
	if err != nil {
		return err
	}
	if err := sqlDB.Close(); err != nil {
		return err
	}

	if FRSDB != nil && FRSDB != DB {
		frsSQL, frsErr := FRSDB.DB()
		if frsErr != nil {
			return frsErr
		}
		return frsSQL.Close()
	}

	return nil
}
