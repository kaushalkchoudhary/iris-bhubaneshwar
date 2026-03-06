// Package services provides business logic services
package services

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"github.com/nats-io/nats.go"
)

const streamStopGracePeriod = 8 * time.Second

// FeedHub manages camera feed subscriptions and WebSocket connections
type FeedHub struct {
	natsConn *nats.Conn

	// WebSocket connections
	clients   map[*FeedClient]bool
	clientsMu sync.RWMutex

	// Camera subscriptions (cameraKey -> subscription)
	subscriptions   map[string]*cameraSubscription
	subscriptionsMu sync.RWMutex

	// Broadcast channels — buffered so senders never block if Run() is briefly busy
	register   chan *FeedClient
	unregister chan *FeedClient

	// FPS tracking per camera: sync.Map[cameraKey -> *atomic.Int64]
	// Avoids mutex at 500 frames/sec.
	fpsCount sync.Map
	stopFPS  chan struct{}

	// Active publishers: sync.Map[cameraKey -> time.Time]
	activePubs sync.Map

	// lastBroadcasts tracks the last time a detection was broadcast for a person/globalIdentity
	// key: cameraKey + ":" + identityID
	lastBroadcasts sync.Map

	// Delayed stop timers to avoid stream churn on short-lived browser reconnects.
	stopTimers   map[string]*time.Timer
	stopTimersMu sync.Mutex
}

// cameraSubscription tracks a camera feed subscription
type cameraSubscription struct {
	cameraKey string // format: workerID.cameraID
	detectSub *nats.Subscription
	viewers   map[*FeedClient]bool
	viewersMu sync.RWMutex
}

// FeedClient represents a WebSocket client viewing feeds
type FeedClient struct {
	hub        *FeedHub
	conn       *websocket.Conn
	send       chan []byte
	cameras    map[string]bool // cameras this client is viewing
	camerasMu  sync.RWMutex
	userID     string
	remoteAddr string
}

// FeedMessage is a message sent to/from clients
type FeedMessage struct {
	Type     string          `json:"type"`   // subscribe, unsubscribe, frame, detection
	Camera   string          `json:"camera"` // workerID.cameraID
	Data     json.RawMessage `json:"data,omitempty"`
	Binary   bool            `json:"-"` // True if this is binary frame data
	RawBytes []byte          `json:"-"` // Raw binary data
}

// NewFeedHub creates a new feed hub
func NewFeedHub(natsConn *nats.Conn) *FeedHub {
	h := &FeedHub{
		natsConn:      natsConn,
		clients:       make(map[*FeedClient]bool),
		subscriptions: make(map[string]*cameraSubscription),
		// Buffered so ReadPump's "unregister <- c" never blocks if Run() is briefly busy.
		register:   make(chan *FeedClient, 64),
		unregister: make(chan *FeedClient, 64),
		stopFPS:    make(chan struct{}),
		stopTimers: make(map[string]*time.Timer),
	}
	go h.logFPS()
	return h
}

func (h *FeedHub) cancelPendingStop(cameraKey string) {
	h.stopTimersMu.Lock()
	if t, ok := h.stopTimers[cameraKey]; ok {
		t.Stop()
		delete(h.stopTimers, cameraKey)
	}
	h.stopTimersMu.Unlock()
}

func (h *FeedHub) scheduleStopIfIdle(cameraKey string) {
	h.stopTimersMu.Lock()
	if existing, ok := h.stopTimers[cameraKey]; ok {
		existing.Stop()
	}
	h.stopTimers[cameraKey] = time.AfterFunc(streamStopGracePeriod, func() {
		h.subscriptionsMu.Lock()
		sub, exists := h.subscriptions[cameraKey]
		if !exists {
			h.subscriptionsMu.Unlock()
			h.stopTimersMu.Lock()
			delete(h.stopTimers, cameraKey)
			h.stopTimersMu.Unlock()
			return
		}

		sub.viewersMu.RLock()
		viewerCount := len(sub.viewers)
		sub.viewersMu.RUnlock()
		if viewerCount > 0 {
			h.subscriptionsMu.Unlock()
			h.stopTimersMu.Lock()
			delete(h.stopTimers, cameraKey)
			h.stopTimersMu.Unlock()
			return
		}

		if sub.detectSub != nil {
			sub.detectSub.Unsubscribe()
		}
		delete(h.subscriptions, cameraKey)
		h.subscriptionsMu.Unlock()

		workerID, cameraID, _ := parseCameraKey(cameraKey)
		h.sendStopStreamCommand(workerID, cameraID)
		log.Printf("Removed subscription for camera %s after %s idle grace (no viewers)", cameraKey, streamStopGracePeriod)

		h.stopTimersMu.Lock()
		delete(h.stopTimers, cameraKey)
		h.stopTimersMu.Unlock()
	})
	h.stopTimersMu.Unlock()
}

// logFPS logs FPS every second for frames broadcast to WebSocket clients
func (h *FeedHub) logFPS() {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-h.stopFPS:
			return
		case <-ticker.C:
			h.fpsCount.Range(func(k, v interface{}) bool {
				count := v.(*atomic.Int64).Swap(0)
				if count > 0 {
					log.Printf("📊 [FEEDHUB] %s: %d fps to WebSocket clients", k.(string), count)
				}
				return true
			})
		}
	}
}

// Register adds a client to the hub
func (h *FeedHub) Register(client *FeedClient) {
	h.register <- client
}

// Run starts the hub's main loop
func (h *FeedHub) Run() {
	log.Println("Feed hub started")

	for {
		select {
		case client := <-h.register:
			h.clientsMu.Lock()
			h.clients[client] = true
			h.clientsMu.Unlock()
			log.Printf("Client connected: %s", client.remoteAddr)

		case client := <-h.unregister:
			h.clientsMu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
			h.clientsMu.Unlock()

			// Snapshot the camera list and release camerasMu BEFORE calling
			// unsubscribeClient. This prevents an AB-BA deadlock:
			//
			//   Subscribe()         holds subscriptionsMu → tries camerasMu
			//   Run() (old code)    held camerasMu        → tried subscriptionsMu (via unsubscribeClient)
			//
			// Lock order is now consistently: subscriptionsMu → camerasMu everywhere.
			client.camerasMu.Lock()
			cameras := make([]string, 0, len(client.cameras))
			for cameraKey := range client.cameras {
				cameras = append(cameras, cameraKey)
			}
			client.camerasMu.Unlock() // release BEFORE unsubscribeClient acquires subscriptionsMu

			for _, cameraKey := range cameras {
				h.unsubscribeClient(client, cameraKey)
			}

			log.Printf("Client disconnected: %s", client.remoteAddr)
		}
	}
}

// Subscribe subscribes a client to a camera feed
func (h *FeedHub) Subscribe(client *FeedClient, cameraKey string) error {
	workerID, cameraID, err := parseCameraKey(cameraKey)
	if err != nil {
		return err
	}

	h.subscriptionsMu.Lock()
	defer h.subscriptionsMu.Unlock()
	h.cancelPendingStop(cameraKey)

	sub, exists := h.subscriptions[cameraKey]
	if !exists {
		// Create new subscription — frames are delivered directly (no NATS roundtrip).
		// Only detection events use NATS (low-frequency JSON payloads).
		sub = &cameraSubscription{
			cameraKey: cameraKey,
			viewers:   make(map[*FeedClient]bool),
		}

		detectSubject := fmt.Sprintf("detections.%s.%s", workerID, cameraID)
		sub.detectSub, err = h.natsConn.Subscribe(detectSubject, func(msg *nats.Msg) {
			h.broadcastDetection(cameraKey, msg.Data)
		})
		if err != nil {
			return fmt.Errorf("failed to subscribe to detections: %w", err)
		}

		h.subscriptions[cameraKey] = sub
		h.sendStartStreamCommand(workerID, cameraID)
		log.Printf("Created subscription for camera %s", cameraKey)
	}

	sub.viewersMu.Lock()
	sub.viewers[client] = true
	sub.viewersMu.Unlock()

	// Lock order: subscriptionsMu (held above) → camerasMu.
	// unsubscribeClient uses the same order, so no deadlock.
	client.camerasMu.Lock()
	client.cameras[cameraKey] = true
	client.camerasMu.Unlock()

	log.Printf("Client %s subscribed to %s", client.remoteAddr, cameraKey)
	return nil
}

// Unsubscribe removes a client from a camera feed
func (h *FeedHub) Unsubscribe(client *FeedClient, cameraKey string) {
	h.unsubscribeClient(client, cameraKey)
}

func (h *FeedHub) unsubscribeClient(client *FeedClient, cameraKey string) {
	h.subscriptionsMu.Lock()
	defer h.subscriptionsMu.Unlock()

	sub, exists := h.subscriptions[cameraKey]
	if !exists {
		return
	}

	sub.viewersMu.Lock()
	delete(sub.viewers, client)
	viewerCount := len(sub.viewers)
	sub.viewersMu.Unlock()

	// Lock order: subscriptionsMu (held above) → camerasMu. Consistent with Subscribe().
	client.camerasMu.Lock()
	delete(client.cameras, cameraKey)
	client.camerasMu.Unlock()

	if viewerCount == 0 {
		h.scheduleStopIfIdle(cameraKey)
	}

	log.Printf("Client %s unsubscribed from %s", client.remoteAddr, cameraKey)
}

// broadcastDetection sends detection data to all viewers of a camera
func (h *FeedHub) broadcastDetection(cameraKey string, detectData []byte) {
	h.subscriptionsMu.RLock()
	sub, exists := h.subscriptions[cameraKey]
	h.subscriptionsMu.RUnlock()

	if !exists {
		return
	}

	msg := FeedMessage{
		Type:   "detection",
		Camera: cameraKey,
		Data:   detectData,
	}
	msgBytes, _ := json.Marshal(msg)

	sub.viewersMu.RLock()
	for client := range sub.viewers {
		select {
		case client.send <- msgBytes:
		default:
		}
	}
	sub.viewersMu.RUnlock()
}

// sendStartStreamCommand tells MagicBox to start streaming a camera
func (h *FeedHub) sendStartStreamCommand(workerID, cameraID string) {
	cmd := map[string]string{"action": "start_stream", "cameraId": cameraID}
	cmdBytes, _ := json.Marshal(cmd)
	subject := fmt.Sprintf("command.%s", workerID)
	if err := h.natsConn.Publish(subject, cmdBytes); err != nil {
		log.Printf("⚠️ Failed to send start_stream command: %v", err)
	} else {
		log.Printf("📤 Sent start_stream command to %s for camera %s", workerID, cameraID)
	}
}

// sendStopStreamCommand tells MagicBox to stop streaming a camera
func (h *FeedHub) sendStopStreamCommand(workerID, cameraID string) {
	cmd := map[string]string{"action": "stop_stream", "cameraId": cameraID}
	cmdBytes, _ := json.Marshal(cmd)
	subject := fmt.Sprintf("command.%s", workerID)
	if err := h.natsConn.Publish(subject, cmdBytes); err != nil {
		log.Printf("⚠️ Failed to send stop_stream command: %v", err)
	} else {
		log.Printf("📤 Sent stop_stream command to %s for camera %s", workerID, cameraID)
	}
}

// parseCameraKey splits workerID.cameraID
func parseCameraKey(key string) (workerID, cameraID string, err error) {
	for i, c := range key {
		if c == '.' {
			return key[:i], key[i+1:], nil
		}
	}
	return "", "", fmt.Errorf("invalid camera key format: %s (expected workerID.cameraID)", key)
}

// PublishFrame accepts a raw JPEG frame from a Jetson publisher and directly
// broadcasts it to subscribed browser WebSocket clients. No NATS roundtrip —
// avoids base64/JSON overhead at 500 frames/sec across 20 cameras.
func (h *FeedHub) PublishFrame(cameraKey string, jpegData []byte) {
	if _, _, err := parseCameraKey(cameraKey); err != nil {
		log.Printf("⚠️ PublishFrame: invalid camera key %q: %v", cameraKey, err)
		return
	}

	// Track active publisher — sync.Map.Store has no mutex at 500/sec.
	h.activePubs.Store(cameraKey, time.Now())

	h.subscriptionsMu.RLock()
	sub, exists := h.subscriptions[cameraKey]
	h.subscriptionsMu.RUnlock()

	if !exists {
		return // No browser clients subscribed, drop the frame
	}

	// Build binary message: [0x01][keyLen][cameraKey][JPEG]
	keyBytes := []byte(cameraKey)
	msg := make([]byte, 2+len(keyBytes)+len(jpegData))
	msg[0] = 0x01
	msg[1] = byte(len(keyBytes))
	copy(msg[2:], keyBytes)
	copy(msg[2+len(keyBytes):], jpegData)

	sub.viewersMu.RLock()
	viewerCount := len(sub.viewers)
	for client := range sub.viewers {
		select {
		case client.send <- msg:
		default:
			// Client buffer full, drop frame (best-effort delivery)
		}
	}
	sub.viewersMu.RUnlock()

	if viewerCount > 0 {
		// Atomic per-camera counter — no mutex at 500/sec.
		counter, _ := h.fpsCount.LoadOrStore(cameraKey, new(atomic.Int64))
		counter.(*atomic.Int64).Add(1)
	}
}

// PublishDetection accepts JSON detection data from a Jetson publisher and broadcasts it to viewers.
func (h *FeedHub) PublishDetection(cameraKey string, detectionJSON []byte) {
	workerID, cameraID, err := parseCameraKey(cameraKey)
	if err != nil {
		return
	}

	// Debounce check: skip broadcasting if similar detection seen on this camera recently
	var det struct {
		PersonID         *string `json:"person_id"`
		GlobalIdentityID *string `json:"global_identity_id"`
	}
	if err := json.Unmarshal(detectionJSON, &det); err == nil {
		id := ""
		if det.PersonID != nil && *det.PersonID != "" {
			id = *det.PersonID
		} else if det.GlobalIdentityID != nil && *det.GlobalIdentityID != "" {
			id = *det.GlobalIdentityID
		}

		if id != "" {
			debounceKey := cameraKey + ":" + id
			now := time.Now()
			if last, ok := h.lastBroadcasts.Load(debounceKey); ok {
				if now.Sub(last.(time.Time)) < 5*time.Second {
					// Suppress redundant real-time broadcast
					return
				}
			}
			h.lastBroadcasts.Store(debounceKey, now)
		}
	}

	subject := fmt.Sprintf("detections.%s.%s", workerID, cameraID)
	if err := h.natsConn.Publish(subject, detectionJSON); err != nil {
		log.Printf("⚠️ PublishDetection NATS error for %s: %v", cameraKey, err)
	}
}

// HubStats holds feed hub statistics
type HubStats struct {
	Clients       int      `json:"clients"`
	Subscriptions int      `json:"subscriptions"`
	ActiveCameras []string `json:"activeCameras"`
	PublishingNow []string `json:"publishingNow"`
}

// Stats returns hub statistics
func (h *FeedHub) Stats() HubStats {
	h.clientsMu.RLock()
	clientCount := len(h.clients)
	h.clientsMu.RUnlock()

	h.subscriptionsMu.RLock()
	cameras := make([]string, 0, len(h.subscriptions))
	for key := range h.subscriptions {
		cameras = append(cameras, key)
	}
	h.subscriptionsMu.RUnlock()

	// Cameras that published a frame in the last 5 seconds — no mutex via sync.Map.
	cutoff := time.Now().Add(-5 * time.Second)
	publishing := make([]string, 0)
	h.activePubs.Range(func(k, v interface{}) bool {
		t := v.(time.Time)
		if t.After(cutoff) {
			publishing = append(publishing, k.(string))
		} else {
			h.activePubs.Delete(k) // prune stale entries
		}
		return true
	})

	return HubStats{
		Clients:       clientCount,
		Subscriptions: len(cameras),
		ActiveCameras: cameras,
		PublishingNow: publishing,
	}
}
