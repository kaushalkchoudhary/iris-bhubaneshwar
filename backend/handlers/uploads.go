package handlers

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/gin-gonic/gin"
)

// UploadFiles handles POST /api/uploads - Upload images and videos
// Accepts multipart form data with files and optional metadata
func UploadFiles(c *gin.Context) {
	startTime := time.Now()
	clientIP := c.ClientIP()
	
	log.Printf("📤 [UPLOAD] Request received - IP: %s", clientIP)

	// Parse multipart form (max 100MB for videos)
	if err := c.Request.ParseMultipartForm(100 << 20); err != nil {
		log.Printf("❌ [UPLOAD] Failed to parse multipart form - IP: %s, Error: %v", clientIP, err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to parse multipart form"})
		return
	}

	form := c.Request.MultipartForm
	if form == nil || form.File == nil {
		log.Printf("❌ [UPLOAD] No files found - IP: %s", clientIP)
		c.JSON(http.StatusBadRequest, gin.H{"error": "No files provided"})
		return
	}

	// Get optional metadata from form
	deviceID := c.PostForm("device_id")
	if deviceID == "" {
		deviceID = "unknown"
	}
	workerID := c.PostForm("worker_id")
	if workerID == "" {
		workerID = "unknown"
	}
	fileType := c.PostForm("type") // "image", "video", or empty (auto-detect)
	if fileType == "" {
		fileType = "upload"
	}

	// Log all file keys
	fileKeys := make([]string, 0, len(form.File))
	for key := range form.File {
		fileKeys = append(fileKeys, key)
	}
	log.Printf("📎 [UPLOAD] Files found - Keys: %v, DeviceID: %s, WorkerID: %s", fileKeys, deviceID, workerID)

	fileURLs := make(map[string]string)
	errors := make(map[string]string)

	// Process each file
	for key, files := range form.File {
		for _, file := range files {
			// Open file
			src, err := file.Open()
			if err != nil {
				log.Printf("⚠️ [UPLOAD] Failed to open file - Key: %s, Filename: %s, Error: %v", 
					key, file.Filename, err)
				errors[key] = fmt.Sprintf("Failed to open file: %v", err)
				continue
			}

			// Generate storage path using same logic as ingest endpoint
			storagePath := generateImagePath(workerID, deviceID, fileType, file.Filename)
			
			// Ensure directory exists
			dir := filepath.Dir(storagePath)
			if err := os.MkdirAll(dir, 0755); err != nil {
				log.Printf("⚠️ [UPLOAD] Failed to create directory - Path: %s, Error: %v", dir, err)
				src.Close()
				errors[key] = fmt.Sprintf("Failed to create directory: %v", err)
				continue
			}
			
			// Save file
			dst, err := os.Create(storagePath)
			if err != nil {
				log.Printf("⚠️ [UPLOAD] Failed to create file - Path: %s, Error: %v", storagePath, err)
				src.Close()
				errors[key] = fmt.Sprintf("Failed to create file: %v", err)
				continue
			}
			
			if _, err := io.Copy(dst, src); err != nil {
				log.Printf("⚠️ [UPLOAD] Failed to copy file - Path: %s, Error: %v", storagePath, err)
				src.Close()
				dst.Close()
				errors[key] = fmt.Sprintf("Failed to save file: %v", err)
				continue
			}

			src.Close()
			dst.Close()

			// Generate URL - get relative path from base directory
			baseDir := getUploadBaseDir()
			
			// Get relative path from base directory
			relPath, err := filepath.Rel(baseDir, storagePath)
			if err != nil {
				// Fallback to just filename if relative path fails
				relPath = filepath.Base(storagePath)
			}
			
			// Convert to forward slashes for URL (Windows compatibility)
			relPath = filepath.ToSlash(relPath)
			url := "/uploads/" + relPath
			
			// If multiple files with same key, append index
			if existingURL, exists := fileURLs[key]; exists {
				// Handle multiple files with same key by appending index
				fileURLs[key+"_1"] = existingURL
				fileURLs[key] = url
			} else {
				fileURLs[key] = url
			}
			
			log.Printf("💾 [UPLOAD] File saved - Key: %s, Filename: %s, Path: %s, URL: %s", 
				key, file.Filename, storagePath, url)
		}
	}

	duration := time.Since(startTime)
	fileCount := len(fileURLs)
	log.Printf("✅ [UPLOAD] Upload completed - IP: %s, Files: %d, Errors: %d, Duration: %v", 
		clientIP, fileCount, len(errors), duration)

	response := gin.H{
		"status": "ok",
		"files":  fileURLs,
	}
	
	if len(errors) > 0 {
		response["errors"] = errors
	}

	c.JSON(http.StatusOK, response)
}
