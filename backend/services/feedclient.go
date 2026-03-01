package services

import (
	"encoding/json"
	"log"
	"time"

	"github.com/gorilla/websocket"
)

const (
	// Time allowed to write a message to the peer
	writeWait = 10 * time.Second

	// Time allowed to read the next pong message from the peer
	pongWait = 60 * time.Second

	// Send pings to peer with this period. Must be less than pongWait
	pingPeriod = (pongWait * 9) / 10

	// Maximum message size allowed from peer
	maxMessageSize = 512 * 1024 // 512KB for control messages

	// Send buffer size
	sendBufferSize = 256
)

// NewFeedClient creates a new feed client
func NewFeedClient(hub *FeedHub, conn *websocket.Conn, userID, remoteAddr string) *FeedClient {
	return &FeedClient{
		hub:        hub,
		conn:       conn,
		send:       make(chan []byte, sendBufferSize),
		cameras:    make(map[string]bool),
		userID:     userID,
		remoteAddr: remoteAddr,
	}
}

// ReadPump pumps messages from the WebSocket connection to the hub
func (c *FeedClient) ReadPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("⚠️ WebSocket error: %v", err)
			}
			break
		}

		// Parse message
		var msg FeedMessage
		if err := json.Unmarshal(message, &msg); err != nil {
			log.Printf("⚠️ Invalid message from %s: %v", c.remoteAddr, err)
			continue
		}

		// Handle message
		switch msg.Type {
		case "subscribe":
			if msg.Camera != "" {
				if err := c.hub.Subscribe(c, msg.Camera); err != nil {
					log.Printf("⚠️ Subscribe failed: %v", err)
					c.sendError(err.Error())
				}
			}

		case "unsubscribe":
			if msg.Camera != "" {
				c.hub.Unsubscribe(c, msg.Camera)
			}

		case "ping":
			c.sendPong()

		default:
			log.Printf("⚠️ Unknown message type: %s", msg.Type)
		}
	}
}

// WritePump pumps messages from the hub to the WebSocket connection
func (c *FeedClient) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// Hub closed the channel
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			// Check if binary (frame) or text (JSON)
			if len(message) > 0 && message[0] == 0x01 {
				// Binary frame message
				if err := c.conn.WriteMessage(websocket.BinaryMessage, message); err != nil {
					return
				}
			} else {
				// Text JSON message
				if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
					return
				}
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (c *FeedClient) sendError(errMsg string) {
	msg := map[string]string{
		"type":  "error",
		"error": errMsg,
	}
	msgBytes, _ := json.Marshal(msg)
	select {
	case c.send <- msgBytes:
	default:
	}
}

func (c *FeedClient) sendPong() {
	msg := map[string]string{
		"type": "pong",
	}
	msgBytes, _ := json.Marshal(msg)
	select {
	case c.send <- msgBytes:
	default:
	}
}

