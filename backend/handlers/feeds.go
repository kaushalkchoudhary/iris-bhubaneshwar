package handlers

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/irisdrone/backend/services"
)

var (
	feedHub  *services.FeedHub
	upgrader = websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024 * 1024, // 1MB for frames
		CheckOrigin: func(r *http.Request) bool {
			return true // Allow all origins for now
		},
	}
)

// SetFeedHub sets the feed hub for the handlers
func SetFeedHub(hub *services.FeedHub) {
	feedHub = hub
}

// HandleFeedWebSocket handles WebSocket connections for camera feeds
func HandleFeedWebSocket(c *gin.Context) {
	if feedHub == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Feed hub not initialized"})
		return
	}

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("⚠️ WebSocket upgrade failed: %v", err)
		return
	}

	// Get user ID from context (if authenticated)
	userID := c.GetString("userID")
	if userID == "" {
		userID = "anonymous"
	}

	client := services.NewFeedClient(feedHub, conn, userID, c.ClientIP())

	feedHub.Register(client)

	// Start goroutines for reading and writing
	go client.WritePump()
	go client.ReadPump()
}

// HandleFeedPublish handles WebSocket connections from Jetsons publishing frames.
// Binary message format: [1 byte subtype][1 byte keyLen]["workerID.cameraID"][payload]
//   subtype 0x01 → JPEG frame
//   subtype 0x02 → JSON detection data
func HandleFeedPublish(c *gin.Context) {
	if feedHub == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Feed hub not initialized"})
		return
	}

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("⚠️ Publish WebSocket upgrade failed: %v", err)
		return
	}
	defer conn.Close()

	remoteAddr := c.ClientIP()
	log.Printf("📡 Jetson publisher connected: %s", remoteAddr)

	conn.SetReadLimit(8 * 1024 * 1024) // 8MB max frame
	for {
		msgType, data, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("⚠️ Publish WebSocket error from %s: %v", remoteAddr, err)
			}
			break
		}
		if msgType != websocket.BinaryMessage || len(data) < 3 {
			continue
		}

		subtype := data[0]
		keyLen := int(data[1])
		if 2+keyLen > len(data) {
			continue
		}
		cameraKey := string(data[2 : 2+keyLen])
		payload := data[2+keyLen:]

		switch subtype {
		case 0x01: // JPEG frame
			feedHub.PublishFrame(cameraKey, payload)
		case 0x02: // JSON detection
			feedHub.PublishDetection(cameraKey, payload)
		}
	}

	log.Printf("📡 Jetson publisher disconnected: %s", remoteAddr)
}

// GetFeedHubStats returns feed hub statistics
func GetFeedHubStats(c *gin.Context) {
	if feedHub == nil {
		c.JSON(http.StatusOK, gin.H{
			"enabled": false,
		})
		return
	}

	stats := feedHub.Stats()
	c.JSON(http.StatusOK, gin.H{
		"enabled":        true,
		"clients":        stats.Clients,
		"subscriptions":  stats.Subscriptions,
		"activeCameras":  stats.ActiveCameras,
		"publishingNow":  stats.PublishingNow,
	})
}

