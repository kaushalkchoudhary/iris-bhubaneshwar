package handlers

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"os"
	"strconv"
	"strings"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
)

type mqttFRSEvent struct {
	DeviceID     string    `json:"device_id"`
	CameraID     string    `json:"camera_id"`
	TimestampUTC string    `json:"timestamp_utc"`
	Embedding    []float64 `json:"embedding"`
	PersonID     *string   `json:"person_id"`
	Confidence   float64   `json:"confidence"`
	BBox         []float64 `json:"bbox"`
	SnapshotPath string    `json:"snapshot_path"`
}

type mqttHeartbeatEvent struct {
	DeviceID     string                 `json:"device_id"`
	TimestampUTC string                 `json:"timestamp_utc"`
	Status       string                 `json:"status"`
	GPUUsage     interface{}            `json:"gpu_usage"`
	MemoryUsage  interface{}            `json:"memory_usage"`
	Metadata     map[string]interface{} `json:"metadata"`
}

// StartMQTTFRSIngest subscribes to edge MQTT topics and forwards into existing backend pipelines.
func StartMQTTFRSIngest() (func(), error) {
	enabled := strings.ToLower(strings.TrimSpace(os.Getenv("MQTT_ENABLED")))
	if enabled != "1" && enabled != "true" && enabled != "yes" {
		log.Printf("MQTT ingest disabled")
		return func() {}, nil
	}

	brokerURL := strings.TrimSpace(os.Getenv("MQTT_BROKER_URL"))
	if brokerURL == "" {
		brokerURL = "tcp://127.0.0.1:1883"
	}
	clientID := strings.TrimSpace(os.Getenv("MQTT_CLIENT_ID"))
	if clientID == "" {
		clientID = fmt.Sprintf("iris-backend-%d", time.Now().UnixNano())
	}
	eventsTopic := strings.TrimSpace(os.Getenv("MQTT_EVENTS_TOPIC"))
	if eventsTopic == "" {
		eventsTopic = "iris/events/+"
	}
	heartbeatTopic := strings.TrimSpace(os.Getenv("MQTT_HEARTBEAT_TOPIC"))
	if heartbeatTopic == "" {
		heartbeatTopic = "iris/heartbeat/+"
	}

	opts := mqtt.NewClientOptions()
	opts.AddBroker(brokerURL)
	opts.SetClientID(clientID)
	opts.SetAutoReconnect(true)
	opts.SetConnectRetry(true)
	opts.SetConnectRetryInterval(3 * time.Second)
	opts.SetKeepAlive(30 * time.Second)
	opts.SetPingTimeout(10 * time.Second)

	if user := strings.TrimSpace(os.Getenv("MQTT_USERNAME")); user != "" {
		opts.SetUsername(user)
	}
	if pass := os.Getenv("MQTT_PASSWORD"); pass != "" {
		opts.SetPassword(pass)
	}

	client := mqtt.NewClient(opts)
	if err := waitMQTTToken(client.Connect(), 4*time.Second, "connect"); err != nil {
		return nil, err
	}

	if err := waitMQTTToken(client.Subscribe(eventsTopic, 1, handleMQTTFRSEvent), 3*time.Second, "subscribe events"); err != nil {
		client.Disconnect(250)
		return nil, err
	}
	if err := waitMQTTToken(client.Subscribe(heartbeatTopic, 0, handleMQTTHeartbeatEvent), 3*time.Second, "subscribe heartbeat"); err != nil {
		client.Disconnect(250)
		return nil, err
	}

	log.Printf("MQTT ingest connected (broker=%s, events=%s, heartbeat=%s)", brokerURL, eventsTopic, heartbeatTopic)
	return func() {
		client.Disconnect(250)
		log.Printf("MQTT ingest disconnected")
	}, nil
}

func waitMQTTToken(token mqtt.Token, timeout time.Duration, op string) error {
	if token.WaitTimeout(timeout) {
		return token.Error()
	}
	return fmt.Errorf("mqtt %s timeout after %s", op, timeout)
}

func handleMQTTFRSEvent(_ mqtt.Client, msg mqtt.Message) {
	var payload mqttFRSEvent
	if err := json.Unmarshal(msg.Payload(), &payload); err != nil {
		log.Printf("WARN: invalid MQTT FRS event payload: %v", err)
		return
	}
	if strings.TrimSpace(payload.DeviceID) == "" {
		log.Printf("WARN: MQTT FRS event missing device_id")
		return
	}

	eventTime := parseUTC(payload.TimestampUTC)

	metadata := map[string]interface{}{
		"source":        "mqtt",
		"mqtt_topic":    msg.Topic(),
		"is_known":      payload.PersonID != nil && strings.TrimSpace(*payload.PersonID) != "",
		"snapshot_path": payload.SnapshotPath,
	}
	if strings.TrimSpace(payload.CameraID) != "" {
		metadata["camera_id"] = strings.TrimSpace(payload.CameraID)
	}

	data := map[string]interface{}{
		"confidence": payload.Confidence,
		"bbox":       payload.BBox,
		"metadata":   metadata,
	}
	if payload.PersonID != nil && strings.TrimSpace(*payload.PersonID) != "" {
		data["person_id"] = strings.TrimSpace(*payload.PersonID)
	}
	if len(payload.Embedding) > 0 {
		data["faceEmbedding"] = encodeFloat32Embedding(payload.Embedding)
	}

	eventType := "face_detected"
	if payload.PersonID != nil && strings.TrimSpace(*payload.PersonID) != "" {
		eventType = "person_match"
	}

	if err := IngestFRSEventFromSystem(payload.DeviceID, eventType, data, eventTime, nil); err != nil {
		log.Printf("WARN: MQTT FRS event ingest failed (topic=%s): %v", msg.Topic(), err)
	}
}

func handleMQTTHeartbeatEvent(_ mqtt.Client, msg mqtt.Message) {
	var payload mqttHeartbeatEvent
	if err := json.Unmarshal(msg.Payload(), &payload); err != nil {
		log.Printf("WARN: invalid MQTT heartbeat payload: %v", err)
		return
	}
	if strings.TrimSpace(payload.DeviceID) == "" {
		log.Printf("WARN: MQTT heartbeat missing device_id")
		return
	}

	cameraStatus := strings.TrimSpace(strings.ToLower(payload.Status))
	if cameraStatus == "" {
		cameraStatus = "online"
	}
	eventTime := parseUTC(payload.TimestampUTC)

	meta := map[string]interface{}{
		"source": "mqtt",
	}
	if payload.Metadata != nil {
		for k, v := range payload.Metadata {
			meta[k] = v
		}
	}
	if payload.GPUUsage != nil {
		meta["gpu_usage"] = payload.GPUUsage
	}
	if payload.MemoryUsage != nil {
		meta["memory_usage"] = payload.MemoryUsage
	}
	meta["mqtt_topic"] = msg.Topic()

	if err := UpsertDeviceHeartbeatFromSystem(payload.DeviceID, cameraStatus, meta, eventTime); err != nil {
		log.Printf("WARN: MQTT heartbeat ingest failed (topic=%s): %v", msg.Topic(), err)
	}
}

func parseUTC(raw string) time.Time {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return time.Now().UTC()
	}
	if t, err := time.Parse(time.RFC3339, trimmed); err == nil {
		return t.UTC()
	}
	if unixVal, err := strconv.ParseInt(trimmed, 10, 64); err == nil {
		return time.Unix(unixVal, 0).UTC()
	}
	return time.Now().UTC()
}

func encodeFloat32Embedding(embedding []float64) string {
	buf := make([]byte, 4*len(embedding))
	for i, v := range embedding {
		binary.LittleEndian.PutUint32(buf[i*4:i*4+4], math.Float32bits(float32(v)))
	}
	return base64.StdEncoding.EncodeToString(buf)
}
