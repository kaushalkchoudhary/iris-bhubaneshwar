package main

import (
	"fmt"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/irisdrone/backend/database"
	"github.com/irisdrone/backend/handlers"
	"github.com/irisdrone/backend/middleware"
	"github.com/irisdrone/backend/models"
	"github.com/irisdrone/backend/natsserver"
	"github.com/irisdrone/backend/services"
	"github.com/joho/godotenv"
	"github.com/nats-io/nats.go"
)

func parseCorsAllowedOrigins(raw string) []string {
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		out = append(out, p)
	}
	return out
}

func envInt(key string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v <= 0 {
		log.Printf("WARN: invalid %s=%q, using default %d", key, raw, fallback)
		return fallback
	}
	return v
}

func main() {
	// Load environment variables
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using environment variables")
	}

	// Fail fast if auth is misconfigured in production.
	if strings.TrimSpace(os.Getenv("ENV")) == "production" && strings.TrimSpace(os.Getenv("JWT_SECRET")) == "" {
		log.Fatalf("ERROR: JWT_SECRET must be set in production")
	}

	// Connect to database
	if err := database.Connect(); err != nil {
		log.Fatalf("ERROR: failed to start server: %v", err)
	}

	// Auto-migrate models
	log.Println("Running database migrations...")
	if err := database.DB.AutoMigrate(&models.User{}, &models.Worker{}, &models.WorkerToken{}, &models.Device{}, &models.TrafficViolation{}); err != nil {
		log.Printf("WARN: migration warning: %v", err)
	}

	// Optional: bootstrap admin/operator accounts via env so you can't lock yourself out.
	if err := handlers.EnsureBootstrapUsers(); err != nil {
		log.Fatalf("ERROR: bootstrap users failed: %v", err)
	}

	// Optional: sync FRS topology (jetsons + cameras) from YAML into DB for API/UI consistency.
	if err := services.LoadFRSTopologyFromConfig(); err != nil {
		log.Printf("WARN: failed to sync FRS topology: %v", err)
	}

	defer database.Close()

	// Optional: ingest FRS events/heartbeats directly from MQTT edge topics.
	stopMQTTIngest, err := handlers.StartMQTTFRSIngest()
	if err != nil {
		log.Printf("WARN: MQTT ingest not started: %v", err)
	} else {
		defer stopMQTTIngest()
	}

	// Start embedded NATS server for central communication
	// Using port 4233 to avoid conflict with MagicBox local NATS on 4222
	natsPort := envInt("NATS_PORT", 4233)
	natsServer, err := natsserver.New(natsserver.Config{
		Port:       natsPort,
		MaxPayload: 8 * 1024 * 1024, // 8MB for frames
	})
	if err != nil {
		log.Fatalf("ERROR: failed to start NATS server: %v", err)
	}
	defer natsServer.Shutdown()
	log.Printf("Central NATS server started on port %d", natsPort)

	// Connect to NATS for feed hub
	natsConn, err := nats.Connect(fmt.Sprintf("nats://localhost:%d", natsPort))
	if err != nil {
		log.Fatalf("ERROR: failed to connect to NATS: %v", err)
	}
	defer natsConn.Close()

	// Initialize feed hub for WebSocket streaming
	feedHub := services.NewFeedHub(natsConn)
	go feedHub.Run()
	handlers.SetFeedHub(feedHub)
	log.Println("Feed hub initialized")

	// Initialize WireGuard service (optional). This requires privileged operations on many hosts.
	wgEnabled := strings.TrimSpace(strings.ToLower(os.Getenv("WIREGUARD_ENABLED")))
	if wgEnabled == "1" || wgEnabled == "true" || wgEnabled == "yes" {
		wgEndpoint := os.Getenv("WIREGUARD_ENDPOINT")
		if wgEndpoint == "" {
			wgEndpoint = "localhost:51820" // Default for dev
		}
		handlers.InitWireGuard(wgEndpoint)
		log.Printf("WireGuard service initialized (endpoint: %s)", wgEndpoint)
	} else {
		log.Printf("WireGuard service disabled (set WIREGUARD_ENABLED=1 to enable)")
	}

	// Setup Gin router
	if os.Getenv("ENV") == "production" {
		gin.SetMode(gin.ReleaseMode)
	} else {
		// In dev/test, auto-create a default admin user if one doesn't exist
		// This is just a helper for local dev to prevent being locked out
		// We'll run this in a goroutine to not block startup
		go func() {
			time.Sleep(2 * time.Second) // Wait for DB connection
			// handlers.EnsureDefaultAdmin() // TODO: Implement this safely
		}()
	}

	router := gin.Default()
	// Trust only local reverse proxies (nginx on the same host). This prevents spoofed ClientIP via X-Forwarded-For.
	_ = router.SetTrustedProxies([]string{"127.0.0.1", "::1"})
	router.Use(middleware.CSRFMiddleware())

	// CORS middleware
	config := cors.DefaultConfig()
	// In production, do not allow wildcard origins. Default to demo2 domain unless overridden.
	if os.Getenv("ENV") == "production" {
		rawAllowed := os.Getenv("CORS_ALLOWED_ORIGINS")
		if rawAllowed == "" {
			rawAllowed = "https://demo2.magicboxhub.net"
		}
		config.AllowAllOrigins = false
		config.AllowOrigins = parseCorsAllowedOrigins(rawAllowed)
		config.AllowCredentials = false
	} else {
		// Dev convenience. Override via CORS_ALLOWED_ORIGINS if you need a stricter dev setup.
		config.AllowAllOrigins = true
	}
	config.AllowMethods = []string{"GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"}
	config.AllowHeaders = []string{"Origin", "Content-Type", "Accept", "Authorization", "X-Auth-Token", "X-Worker-ID", "X-CSRF-Token"}
	router.Use(cors.New(config))

	// Health check
	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"status":    "ok",
			"timestamp": time.Now().Format(time.RFC3339),
		})
	})

	// Serve heatmaps statically
	usr, err := user.Current()
	if err == nil {
		heatmapsDir := strings.TrimSpace(os.Getenv("HEATMAPS_DIR"))
		if heatmapsDir == "" {
			heatmapsDir = filepath.Join(usr.HomeDir, "heatmaps")
		}
		log.Printf("Serving heatmaps from: %s", heatmapsDir)
		router.Static("/heatmaps", heatmapsDir)

		// Serve uploaded images from ~/itms/data
		uploadsDir := os.Getenv("UPLOAD_DIR")
		if uploadsDir == "" {
			uploadsDir = filepath.Join(usr.HomeDir, "itms", "data")
		}
		log.Printf("Serving uploads from: %s", uploadsDir)
		// Uploads are served without JWT auth so that browser <img> tags can load vehicle
		// detection images directly. Files use randomized timestamped names which prevents
		// enumeration. Directory listing is disabled for safety.
		router.StaticFS("/uploads", gin.Dir(uploadsDir, false))

		// Proxy /media/* to mediamtx HLS server (port 8888)
		mediamtxTarget, _ := url.Parse("http://localhost:8888")
		mediamtxProxy := httputil.NewSingleHostReverseProxy(mediamtxTarget)
		router.Any("/media/*path", func(c *gin.Context) {
			c.Request.URL.Path = c.Param("path")
			mediamtxProxy.ServeHTTP(c.Writer, c.Request)
		})
	}

	// Serve Frontend Static Files (Production Mode)
	// Serve assets under /assets
	router.Static("/assets", "../frontend/dist/assets")

	// Serve other static files (favicon, manifest, etc.) from root
	router.StaticFile("/favicon.ico", "../frontend/dist/favicon.ico")
	router.StaticFile("/manifest.json", "../frontend/dist/manifest.json")

	// SPA Fallback: Serve index.html for unknown routes (except /api)
	router.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path
		// Explicitly block source files and maps to prevent confusion/probing
		if filepath.Ext(path) == ".ts" || filepath.Ext(path) == ".tsx" || filepath.Ext(path) == ".map" || (filepath.Ext(path) == ".json" && path != "/manifest.json") {
			c.AbortWithStatus(404)
			return
		}

		// For API routes, return a consistent JSON 404 (avoid default "404 page not found" text).
		if strings.HasPrefix(path, "/api") {
			c.JSON(http.StatusNotFound, gin.H{"error": "Not found"})
			return
		}

		c.File("../frontend/dist/index.html")
	})

	// Debug route for heatmaps (admin only)
	router.GET("/debug/heatmaps", middleware.AuthMiddleware(), middleware.RequireRoles("admin"), func(c *gin.Context) {
		usr, err := user.Current()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
			return
		}
		heatmapsDir := filepath.Join(usr.HomeDir, "heatmaps")

		files, err := os.ReadDir(heatmapsDir)
		if err != nil {
			log.Printf("ERROR [DEBUG] heatmaps read failed (dir=%s): %v", heatmapsDir, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal server error"})
			return
		}

		fileNames := make([]string, 0, len(files))
		for _, file := range files {
			fileNames = append(fileNames, file.Name())
		}

		sampleFiles := fileNames
		if len(sampleFiles) > 5 {
			sampleFiles = sampleFiles[:5]
		}

		testFile := "185_20251225_193400_469259.jpg"
		testPath := filepath.Join(heatmapsDir, testFile)
		exists := false
		if _, err := os.Stat(testPath); err == nil {
			exists = true
		}

		c.JSON(200, gin.H{
			"heatmapsDir": heatmapsDir,
			"fileCount":   len(fileNames),
			"sampleFiles": sampleFiles,
			"testFile":    testFile,
			"exists":      exists,
		})
	})

	// WebSocket routes for camera feeds (outside /api group)
	router.GET("/ws/feeds", handlers.HandleFeedWebSocket)
	// Jetson publishers push frames to /ws/publish
	router.GET("/ws/publish", handlers.HandleFeedPublish)

	// API Routes
	api := router.Group("/api")
	// Record operator actions server-side for audit (best-effort, no request bodies).
	api.Use(middleware.OperatorAuditMiddleware())
	{
		// Auth routes (public)
		auth := api.Group("/auth")
		{
			auth.GET("/csrf-token", handlers.GetCSRFToken)
			auth.POST("/login", handlers.Login)
			auth.POST("/operator/reset-password", handlers.OperatorSelfResetPassword)
			auth.GET("/me", middleware.AuthMiddleware(), handlers.GetMe)
		}

		// Feed hub stats
		api.GET("/feeds/stats", handlers.GetFeedHubStats)
		api.GET("/analytics/worker-configs", handlers.GetWorkerConfigs)
		api.GET("/inference/focus", handlers.GetInferenceFocus)
		api.GET("/inference/frs/persons", handlers.GetFRSPersonsForInference)
		api.GET("/inference/crowd/analysis", handlers.GetCrowdAnalysis)
		api.POST("/inference/crowd/analysis", handlers.PostCrowdAnalysisIngest)
		api.POST("/inference/crowd/live-frame", handlers.PostCrowdLiveFrame)

		// Device heartbeat ingest for MagicBox watchdog (no human auth).
		api.POST("/devices/beat", handlers.DeviceBeat)

		// Device routes
		devices := api.Group("/devices")
		devices.Use(middleware.AuthMiddleware(), middleware.RequireRoles("admin", "operator"))
		{
			devices.GET("", handlers.GetDevices)
			devices.POST("", middleware.RequireRoles("admin"), handlers.CreateDevice)
			devices.GET("/:id/latest", handlers.GetDeviceLatest)
			devices.GET("/analytics/surges", handlers.GetDeviceSurges)
		}

		// Ingest routes (legacy)
		ingest := api.Group("/ingest")
		{
			// Legacy ingest: keep behind human auth in production to prevent unauthenticated writes.
			// Edge devices should use /api/events/ingest with worker auth.
			ingest.POST("", middleware.AuthMiddleware(), middleware.RequireRoles("admin", "operator"), handlers.PostIngest)
		}

		// Event ingest from edge workers
		events := api.Group("/events")
		{
			events.POST("/ingest", handlers.IngestEvents)
		}

		// Upload endpoint for images and videos
		api.POST("/uploads", middleware.AuthMiddleware(), middleware.RequireRoles("admin", "operator"), handlers.UploadFiles)

		// Worker routes (for edge workers to call)
		workers := api.Group("/workers")
		{
			workers.GET("/ping-status", middleware.AuthMiddleware(), middleware.RequireRoles("admin", "operator"), handlers.GetWorkersPingStatus)
			workers.GET("/fleet-status", middleware.AuthMiddleware(), middleware.RequireRoles("admin", "operator"), handlers.GetJetsonFleetStatus)

			// Registration
			workers.POST("/register", handlers.RegisterWorker)
			workers.POST("/request-approval", handlers.RequestApproval)
			workers.GET("/approval-status/:requestId", handlers.CheckApprovalStatus)

			// Authenticated worker endpoints
			workers.POST("/:id/heartbeat", handlers.WorkerHeartbeat)
			workers.GET("/:id/config", handlers.GetWorkerConfig)

			// Worker camera discovery/management
			workers.POST("/:id/cameras", handlers.ReportCameras)
			workers.GET("/:id/cameras", handlers.GetWorkerDiscoveredCameras)
			workers.DELETE("/:id/cameras/:deviceId", handlers.DeleteWorkerCamera)

			// WireGuard setup
			workers.POST("/:id/wireguard/setup", handlers.SetupWireGuard)
		}

		// Admin routes for worker management
		admin := api.Group("/admin")
		admin.Use(middleware.AuthMiddleware(), middleware.RequireRoles("admin")) // Protect all admin routes
		{
			// Operator console access management (admin only).
			adminAuth := admin.Group("/auth")
			{
				adminAuth.GET("/operators", handlers.ListOperatorAccounts)
				adminAuth.GET("/operators/logins", handlers.ListOperatorLoginEvents)
				adminAuth.GET("/operators/:id/activity", handlers.ListOperatorActivityEvents)
				adminAuth.POST("/operators/:id/unlock", handlers.UnlockOperatorAccount)
				adminAuth.POST("/operators/:id/reset-password", handlers.ResetOperatorPassword)
				adminAuth.POST("/operators/:id/approve-access", handlers.ApproveOperatorAccess)
				adminAuth.POST("/operators/:id/force-logout", handlers.ForceLogoutOperator)
			}

			// Workers
			adminWorkers := admin.Group("/workers")
			{
				adminWorkers.GET("", handlers.GetWorkers)
				adminWorkers.POST("", handlers.CreateWorker)
				adminWorkers.GET("/live-stats", handlers.GetWorkerLiveStats)
				adminWorkers.GET("/:id", handlers.GetWorker)
				adminWorkers.PUT("/:id", handlers.UpdateWorker)
				adminWorkers.POST("/:id/revoke", handlers.RevokeWorker)
				adminWorkers.DELETE("/:id", handlers.DeleteWorker)

				// Camera assignments
				adminWorkers.GET("/:id/cameras", handlers.GetWorkerCameras)
				adminWorkers.POST("/:id/cameras", handlers.AssignCameras)
				adminWorkers.DELETE("/:id/cameras/:deviceId", handlers.UnassignCamera)

				// Approval requests
				adminWorkers.GET("/approval-requests", handlers.GetApprovalRequests)
				adminWorkers.POST("/approval-requests/:id/approve", handlers.ApproveWorkerRequest)
				adminWorkers.POST("/approval-requests/:id/reject", handlers.RejectWorkerRequest)
			}

			// Worker tokens
			tokens := admin.Group("/worker-tokens")
			{
				tokens.POST("", handlers.CreateWorkerToken)
				tokens.POST("/bulk", handlers.BulkCreateWorkerTokens)
				tokens.GET("", handlers.GetWorkerTokens)
				tokens.GET("/:id", handlers.GetWorkerToken)
				tokens.POST("/:id/revoke", handlers.RevokeWorkerToken)
				tokens.DELETE("/:id", handlers.DeleteWorkerToken)
			}

			// WireGuard management
			wg := admin.Group("/wireguard")
			{
				wg.GET("/status", handlers.GetWireGuardStatus)
				wg.DELETE("/peers/:pubkey", handlers.RemoveWireGuardPeer)
			}
		}

		// Crowd routes
		crowd := api.Group("/crowd")
		crowd.Use(middleware.AuthMiddleware(), middleware.RequireRoles("admin", "operator"))
		{
			crowd.POST("/analysis", handlers.PostCrowdAnalysis)
			crowd.GET("/analysis", handlers.GetCrowdAnalysis)
			crowd.GET("/analysis/latest", handlers.GetLatestCrowdAnalysis)
			crowd.POST("/alerts", handlers.PostCrowdAlert)
			crowd.GET("/alerts", handlers.GetCrowdAlerts)
			crowd.GET("/live-frames", handlers.GetCrowdLiveFrames)
			crowd.PATCH("/alerts/:id/resolve", handlers.ResolveCrowdAlert)
			crowd.GET("/hotspots", handlers.GetHotspots)
		}

		// Violations routes (ITMS)
		violations := api.Group("/violations")
		{
			// Ingest from edge worker (or manual admin/operator)
			violations.POST("", middleware.UnifiedAuth("admin", "operator", "worker"), handlers.PostViolation)

			// Other violation routes (admin/operator only)
			violations.Use(middleware.AuthMiddleware(), middleware.RequireRoles("admin", "operator"))
			violations.GET("", handlers.GetViolations)
			violations.GET("/stats", handlers.GetViolationStats)
			violations.GET("/:id", handlers.GetViolation)
			violations.PATCH("/:id/approve", handlers.ApproveViolation)
			violations.PATCH("/:id/reject", handlers.RejectViolation)
			violations.PATCH("/:id/plate", handlers.UpdateViolationPlate)
		}

		// Vehicles routes (ANPR/VCC)
		vehicles := api.Group("/vehicles")
		{
			// Ingest from edge worker (or manual admin/operator)
			vehicles.POST("/detect", middleware.UnifiedAuth("admin", "operator", "worker"), handlers.PostVehicleDetection)

			// Other vehicle routes (admin/operator only)
			vehicles.Use(middleware.AuthMiddleware(), middleware.RequireRoles("admin", "operator"))
			vehicles.GET("", handlers.GetVehicles)
			vehicles.GET("/stats", handlers.GetVehicleStats)
			vehicles.GET("/:id", handlers.GetVehicle)
			vehicles.PATCH("/:id", handlers.UpdateVehicle)
			vehicles.GET("/:id/detections", handlers.GetVehicleDetections)
			vehicles.GET("/:id/violations", handlers.GetVehicleViolations)
			vehicles.POST("/:id/watchlist", handlers.AddToWatchlist)
			vehicles.DELETE("/:id/watchlist", handlers.RemoveFromWatchlist)
		}

		// Watchlist routes
		watchlist := api.Group("/watchlist")
		watchlist.Use(middleware.AuthMiddleware(), middleware.RequireRoles("admin", "operator"))
		{
			watchlist.GET("", handlers.GetWatchlist)
			watchlist.POST("", handlers.PostWatchlistByPlate)
		}

		// Alerts routes
		alerts := api.Group("/alerts")
		alerts.Use(middleware.AuthMiddleware(), middleware.RequireRoles("admin", "operator"))
		{
			alerts.GET("", handlers.GetAlerts)
			alerts.GET("/stats", handlers.GetAlertStats)
			alerts.PATCH("/:id/read", handlers.MarkAlertRead)
			alerts.DELETE("/:id", handlers.DismissAlert)
		}

		// VCC (Vehicle Classification and Counting) routes
		vcc := api.Group("/vcc")
		vcc.Use(middleware.AuthMiddleware(), middleware.RequireRoles("admin", "operator"))
		{
			vcc.GET("/stats", handlers.GetVCCStats)
			vcc.GET("/device/:deviceId", handlers.GetVCCByDevice)
			vcc.GET("/realtime", handlers.GetVCCRealtime)
		}

		// FRS (Face Recognition System) routes
		frs := api.Group("/frs")
		frs.Use(middleware.AuthMiddleware(), middleware.RequireRoles("admin", "operator"))
		{
			frs.GET("/persons", handlers.GetFRSPersons)
			frs.POST("/persons", handlers.CreateFRSPerson)
			frs.PUT("/persons/:id", handlers.UpdateFRSPerson)
			frs.DELETE("/persons/:id", handlers.DeleteFRSPerson)
			frs.POST("/persons/:id/embeddings", handlers.AddFRSPersonEmbeddings)
			frs.GET("/detections", handlers.GetFRSDetections)
			frs.GET("/global-identities", handlers.GetFRSGlobalIdentities)
			frs.GET("/global-identities/:id/detections", handlers.GetFRSGlobalIdentityDetections)
		}

		// Distributed FRS control-plane routes (workers + admin/operator).
		frsDistributed := api.Group("/frs/distributed")
		frsDistributed.Use(middleware.UnifiedAuth("admin", "operator", "worker"))
		{
			frsDistributed.GET("/plan", handlers.GetFRSDistributedPlan)
			frsDistributed.POST("/heartbeat", handlers.PostFRSDistributedHeartbeat)
			frsDistributed.GET("/nodes", handlers.GetFRSDistributedNodes)
		}

		// Analytics routes
		analytics := api.Group("/analytics")
		analytics.Use(middleware.AuthMiddleware(), middleware.RequireRoles("admin", "operator"))
		{
			analytics.GET("/violations/trends", handlers.GetViolationTrends)
			analytics.GET("/devices/performance", handlers.GetDevicePerformance)
			analytics.GET("/hotspots", handlers.GetViolationHotspots)
			analytics.GET("/compare", handlers.ComparePeriods)
		}

		// Extended device routes (query-based routes first for ids with / or = in path)
		devices.GET("/stats", handlers.GetDeviceStats)
		devices.GET("/by-id", handlers.GetDeviceByQuery)
		devices.DELETE("/by-id", middleware.RequireRoles("admin"), handlers.DeleteDeviceByQuery)
		devices.GET("/cameras", handlers.GetDeviceCamerasByQuery)
		devices.GET("/heartbeats", handlers.GetDeviceHeartbeatsByQuery)
		devices.GET("/:id/cameras", handlers.GetDeviceCameras)
		devices.GET("/:id/heartbeats", handlers.GetDeviceHeartbeats)
		devices.GET("/:id", handlers.GetDevice)
		devices.DELETE("/:id", middleware.RequireRoles("admin"), handlers.DeleteDevice)
		devices.POST("/:id/heartbeat", handlers.DeviceHeartbeat)
		devices.PUT("/:id", middleware.RequireRoles("admin"), handlers.UpdateDevice)
		devices.PATCH("/:id/status", middleware.RequireRoles("admin"), handlers.UpdateDeviceStatus)
		devices.GET("/:id/health", handlers.GetDeviceHealth)

		// Extended violation routes
		violations.PATCH("/bulk", middleware.RequireRoles("admin"), handlers.BulkUpdateViolations)
		violations.GET("/export", middleware.RequireRoles("admin", "operator"), handlers.ExportViolations)

		// Extended vehicle routes
		vehicles.GET("/search", handlers.SearchVehicles)
		vehicles.GET("/:id/route", handlers.GetVehicleRoute)
		vehicles.GET("/:id/patterns", handlers.GetVehiclePatterns)
		vehicles.POST("/:id/notes", handlers.AddVehicleNote)
		vehicles.GET("/:id/export", middleware.RequireRoles("admin", "operator"), handlers.ExportVehicleReport)
	}

	// Start server
	// Start server with timeouts to mitigate Slowloris/Request Smuggling
	port := os.Getenv("PORT")
	if port == "" {
		port = "3001"
	}

	bindAddr := strings.TrimSpace(os.Getenv("BIND_ADDR"))
	if bindAddr == "" {
		// Safer default for internet-facing deployments behind nginx.
		bindAddr = "127.0.0.1"
	}

	server := &http.Server{
		Addr:              bindAddr + ":" + port,
		Handler:           router,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		ReadHeaderTimeout: 5 * time.Second, // Mitigate Slowloris/Request Smuggling
		MaxHeaderBytes:    1 << 20,
	}

	log.Printf("Server running on http://%s:%s", bindAddr, port)
	if err := server.ListenAndServe(); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
