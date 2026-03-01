// Package natsserver provides an embedded NATS server for MagicBox
package natsserver

import (
	"fmt"
	"log"
	"net"
	"sync/atomic"
	"time"

	"github.com/nats-io/nats-server/v2/server"
	"github.com/nats-io/nats.go"
)

// EmbeddedNATS wraps an embedded NATS server with a client connection
type EmbeddedNATS struct {
	server          *server.Server
	conn            *nats.Conn
	port            int
	framesPublished uint64
	framesDropped   uint64
}

// Config holds configuration for the embedded NATS server
type Config struct {
	Port            int
	MaxPayload      int32 // Max message size in bytes
	MaxPendingMsgs  int   // Max pending messages per slow consumer (default 64K)
	MaxPendingBytes int64 // Max pending bytes per slow consumer (default 64MB)
}

// DefaultConfig returns sensible defaults
func DefaultConfig() Config {
	return Config{
		Port:            4222,
		MaxPayload:      8 * 1024 * 1024,   // 8MB for frames
		MaxPendingMsgs:  1000,              // Max 1000 pending frames per subscriber
		MaxPendingBytes: 100 * 1024 * 1024, // Max 100MB pending per subscriber
	}
}

// New creates and starts an embedded NATS server
func New(cfg Config) (*EmbeddedNATS, error) {
	// Apply defaults
	if cfg.Port <= 0 {
		cfg.Port = 4222
	}
	if cfg.MaxPendingMsgs <= 0 {
		cfg.MaxPendingMsgs = 1000
	}
	if cfg.MaxPendingBytes <= 0 {
		cfg.MaxPendingBytes = 100 * 1024 * 1024
	}
	// Fail fast with a clear error when another process is already bound.
	if ln, err := net.Listen("tcp", fmt.Sprintf(":%d", cfg.Port)); err != nil {
		return nil, fmt.Errorf("NATS port %d is unavailable: %w", cfg.Port, err)
	} else {
		_ = ln.Close()
	}

	opts := &server.Options{
		Host:          "0.0.0.0",
		Port:          cfg.Port,
		NoLog:         true,
		NoSigs:        true,
		MaxPayload:    cfg.MaxPayload,
		WriteDeadline: 10 * time.Second,
		// Memory protection: disconnect slow consumers
		MaxPending: int64(cfg.MaxPendingBytes),
	}

	ns, err := server.NewServer(opts)
	if err != nil {
		return nil, fmt.Errorf("failed to create NATS server: %w", err)
	}

	// Start server in background
	go ns.Start()

	// Wait for server to be ready
	if !ns.ReadyForConnections(5 * time.Second) {
		ns.Shutdown()
		return nil, fmt.Errorf("NATS server not ready after 5 seconds")
	}

	// Create internal client connection
	nc, err := nats.Connect(
		fmt.Sprintf("nats://localhost:%d", cfg.Port),
		nats.Name("magicbox-internal"),
		nats.ReconnectWait(time.Second),
		nats.MaxReconnects(-1),
	)
	if err != nil {
		ns.Shutdown()
		return nil, fmt.Errorf("failed to connect to embedded NATS: %w", err)
	}

	log.Printf("Embedded NATS server started on port %d", cfg.Port)

	return &EmbeddedNATS{
		server: ns,
		conn:   nc,
		port:   cfg.Port,
	}, nil
}

// Publish publishes a message to a subject
func (e *EmbeddedNATS) Publish(subject string, data []byte) error {
	err := e.conn.Publish(subject, data)
	if err != nil {
		atomic.AddUint64(&e.framesDropped, 1)
		return err
	}
	atomic.AddUint64(&e.framesPublished, 1)
	return nil
}

// PublishIfSubscribers only publishes if there are active subscribers
// Returns true if published, false if skipped (no subscribers)
func (e *EmbeddedNATS) PublishIfSubscribers(subject string, data []byte) (bool, error) {
	// Check if anyone is listening
	if e.server.NumSubscriptions() == 0 {
		atomic.AddUint64(&e.framesDropped, 1)
		return false, nil
	}
	err := e.conn.Publish(subject, data)
	if err != nil {
		atomic.AddUint64(&e.framesDropped, 1)
		return false, err
	}
	atomic.AddUint64(&e.framesPublished, 1)
	return true, nil
}

// Subscribe subscribes to a subject
func (e *EmbeddedNATS) Subscribe(subject string, handler nats.MsgHandler) (*nats.Subscription, error) {
	return e.conn.Subscribe(subject, handler)
}

// QueueSubscribe subscribes to a subject with a queue group
func (e *EmbeddedNATS) QueueSubscribe(subject, queue string, handler nats.MsgHandler) (*nats.Subscription, error) {
	return e.conn.QueueSubscribe(subject, queue, handler)
}

// Request sends a request and waits for a response
func (e *EmbeddedNATS) Request(subject string, data []byte, timeout time.Duration) (*nats.Msg, error) {
	return e.conn.Request(subject, data, timeout)
}

// Conn returns the underlying NATS connection
func (e *EmbeddedNATS) Conn() *nats.Conn {
	return e.conn
}

// Address returns the NATS server address
func (e *EmbeddedNATS) Address() string {
	return fmt.Sprintf("nats://localhost:%d", e.port)
}

// Port returns the NATS server port
func (e *EmbeddedNATS) Port() int {
	return e.port
}

// NumClients returns the number of connected clients
func (e *EmbeddedNATS) NumClients() int {
	return e.server.NumClients()
}

// NumSubscriptions returns total active subscriptions
func (e *EmbeddedNATS) NumSubscriptions() uint32 {
	return e.server.NumSubscriptions()
}

// Stats holds NATS server statistics
type Stats struct {
	Clients         int    `json:"clients"`
	Subscriptions   uint32 `json:"subscriptions"`
	FramesPublished uint64 `json:"framesPublished"`
	FramesDropped   uint64 `json:"framesDropped"`
	InMsgs          int64  `json:"inMsgs"`
	OutMsgs         int64  `json:"outMsgs"`
	InBytes         int64  `json:"inBytes"`
	OutBytes        int64  `json:"outBytes"`
	SlowConsumers   int64  `json:"slowConsumers"`
}

// GetStats returns current server statistics
func (e *EmbeddedNATS) GetStats() Stats {
	varz, _ := e.server.Varz(nil)
	stats := Stats{
		Clients:         e.server.NumClients(),
		Subscriptions:   e.server.NumSubscriptions(),
		FramesPublished: atomic.LoadUint64(&e.framesPublished),
		FramesDropped:   atomic.LoadUint64(&e.framesDropped),
	}
	if varz != nil {
		stats.InMsgs = varz.InMsgs
		stats.OutMsgs = varz.OutMsgs
		stats.InBytes = varz.InBytes
		stats.OutBytes = varz.OutBytes
		stats.SlowConsumers = varz.SlowConsumers
	}
	return stats
}

// Shutdown gracefully shuts down the NATS server
func (e *EmbeddedNATS) Shutdown() {
	if e.conn != nil {
		e.conn.Close()
	}
	if e.server != nil {
		e.server.Shutdown()
	}
	log.Println("NATS server shut down")
}
