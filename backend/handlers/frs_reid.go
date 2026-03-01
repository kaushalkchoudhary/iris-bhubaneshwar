package handlers

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"math"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/irisdrone/backend/models"
	"gorm.io/gorm"
)

const (
	defaultFRSReIDSimilarityThreshold = 0.68
	defaultFRSUnknownMaxIdleMinutes   = 120
	defaultFRSReIDCandidateLimit      = 2000
)

// frsReIDConfig stores runtime knobs for global identity assignment.
type frsReIDConfig struct {
	SimilarityThreshold float64
	UnknownMaxIdle      time.Duration
	CandidateLimit      int
}

func loadFRSReIDConfig() frsReIDConfig {
	cfg := frsReIDConfig{
		SimilarityThreshold: defaultFRSReIDSimilarityThreshold,
		UnknownMaxIdle:      time.Duration(defaultFRSUnknownMaxIdleMinutes) * time.Minute,
		CandidateLimit:      defaultFRSReIDCandidateLimit,
	}

	if raw := strings.TrimSpace(os.Getenv("FRS_REID_SIMILARITY_THRESHOLD")); raw != "" {
		if v, err := strconv.ParseFloat(raw, 64); err == nil && v > 0 && v <= 1 {
			cfg.SimilarityThreshold = v
		}
	}
	if raw := strings.TrimSpace(os.Getenv("FRS_REID_UNKNOWN_MAX_IDLE_MINUTES")); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v > 0 {
			cfg.UnknownMaxIdle = time.Duration(v) * time.Minute
		}
	}
	if raw := strings.TrimSpace(os.Getenv("FRS_REID_CANDIDATE_LIMIT")); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v > 0 {
			cfg.CandidateLimit = v
		}
	}

	return cfg
}

// decodeFaceEmbedding accepts base64 float32 bytes and converts to float64 vector.
func decodeFaceEmbedding(data map[string]interface{}) ([]float64, error) {
	raw, ok := data["faceEmbedding"].(string)
	if !ok || strings.TrimSpace(raw) == "" {
		if direct, ok := data["embedding"].([]interface{}); ok {
			return jsonEmbeddingToFloat64(direct), nil
		}
		return nil, nil
	}

	decoded, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid faceEmbedding base64: %w", err)
	}
	if len(decoded)%4 != 0 {
		return nil, fmt.Errorf("invalid faceEmbedding byte length: %d", len(decoded))
	}

	out := make([]float64, len(decoded)/4)
	for i := 0; i < len(out); i++ {
		bits := binary.LittleEndian.Uint32(decoded[i*4 : i*4+4])
		out[i] = float64(math.Float32frombits(bits))
	}
	return out, nil
}

func jsonEmbeddingToFloat64(values []interface{}) []float64 {
	out := make([]float64, 0, len(values))
	for _, v := range values {
		switch t := v.(type) {
		case float64:
			out = append(out, t)
		case float32:
			out = append(out, float64(t))
		case int:
			out = append(out, float64(t))
		}
	}
	return out
}

func centroidToFloat64(raw interface{}) []float64 {
	switch t := raw.(type) {
	case []float64:
		return t
	case []interface{}:
		return jsonEmbeddingToFloat64(t)
	default:
		return nil
	}
}

func cosineSimilarity(a, b []float64) float64 {
	if len(a) == 0 || len(a) != len(b) {
		return -1
	}

	var dot, normA, normB float64
	for i := range a {
		dot += a[i] * b[i]
		normA += a[i] * a[i]
		normB += b[i] * b[i]
	}
	if normA == 0 || normB == 0 {
		return -1
	}
	return dot / (math.Sqrt(normA) * math.Sqrt(normB))
}

func extractSampleCount(meta map[string]interface{}) int {
	if meta == nil {
		return 0
	}
	switch v := meta["sample_count"].(type) {
	case float64:
		return int(v)
	case int:
		return v
	default:
		return 0
	}
}

// updateCentroid applies a rolling centroid update for stable clustering.
func updateCentroid(current []float64, sampleCount int, incoming []float64) ([]float64, int) {
	if len(incoming) == 0 {
		return current, sampleCount
	}
	if len(current) == 0 || len(current) != len(incoming) || sampleCount <= 0 {
		copyIncoming := make([]float64, len(incoming))
		copy(copyIncoming, incoming)
		return copyIncoming, 1
	}

	updated := make([]float64, len(current))
	for i := range current {
		updated[i] = ((current[i] * float64(sampleCount)) + incoming[i]) / float64(sampleCount+1)
	}
	return updated, sampleCount + 1
}

func riskLevelForPerson(tx *gorm.DB, personID *string) *string {
	if personID == nil || strings.TrimSpace(*personID) == "" {
		return nil
	}
	var person models.FRSPerson
	if err := tx.Select("threat_level").First(&person, "id = ?", strings.TrimSpace(*personID)).Error; err != nil {
		return nil
	}
	if person.ThreatLevel == nil || strings.TrimSpace(*person.ThreatLevel) == "" {
		defaultRisk := "medium"
		return &defaultRisk
	}
	clean := strings.ToLower(strings.TrimSpace(*person.ThreatLevel))
	return &clean
}

func loadCandidateIdentities(tx *gorm.DB, since time.Time, cfg frsReIDConfig) ([]models.GlobalIdentity, error) {
	var identities []models.GlobalIdentity
	err := tx.Where("last_seen_timestamp >= ?", since).
		Order("last_seen_timestamp DESC").
		Limit(cfg.CandidateLimit).
		Find(&identities).Error
	return identities, err
}

func pickBestIdentity(identities []models.GlobalIdentity, embedding []float64, preferKnown bool) (*models.GlobalIdentity, float64) {
	var best *models.GlobalIdentity
	bestScore := -1.0

	for i := range identities {
		isKnown := identities[i].AssociatedPersonID != nil && strings.TrimSpace(*identities[i].AssociatedPersonID) != ""
		if preferKnown && !isKnown {
			continue
		}
		if !preferKnown && isKnown {
			continue
		}
		centroid := centroidToFloat64(identities[i].ClusterEmbeddingCentroid.Data)
		score := cosineSimilarity(embedding, centroid)
		if score > bestScore {
			bestScore = score
			best = &identities[i]
		}
	}

	return best, bestScore
}

func createGlobalIdentity(tx *gorm.DB, personID *string, embedding []float64, at time.Time, riskLevel *string, matchScore float64) (*models.GlobalIdentity, error) {
	sampleCount := 0
	var centroid interface{}
	if len(embedding) > 0 {
		sampleCount = 1
		centroid = embedding
	}

	meta := map[string]interface{}{
		"sample_count":     sampleCount,
		"last_match_score": matchScore,
		"reid_source":      "frs_event_ingest",
		"last_updated_utc": at.UTC().Format(time.RFC3339),
	}
	identity := models.GlobalIdentity{
		GlobalIdentityID:         newUUID(),
		FirstSeenTimestamp:       at,
		LastSeenTimestamp:        at,
		AssociatedPersonID:       personID,
		ClusterEmbeddingCentroid: models.NewJSONB(centroid),
		RiskLevel:                riskLevel,
		Metadata:                 models.NewJSONB(meta),
	}
	if err := tx.Create(&identity).Error; err != nil {
		return nil, err
	}
	return &identity, nil
}

func updateGlobalIdentity(tx *gorm.DB, identity *models.GlobalIdentity, personID *string, embedding []float64, at time.Time, riskLevel *string, matchScore float64) error {
	if identity == nil {
		return nil
	}
	meta, _ := identity.Metadata.Data.(map[string]interface{})
	if meta == nil {
		meta = map[string]interface{}{}
	}

	count := extractSampleCount(meta)
	currentCentroid := centroidToFloat64(identity.ClusterEmbeddingCentroid.Data)
	updatedCentroid, updatedCount := updateCentroid(currentCentroid, count, embedding)

	meta["sample_count"] = updatedCount
	meta["last_match_score"] = matchScore
	meta["last_updated_utc"] = at.UTC().Format(time.RFC3339)
	if personID != nil && strings.TrimSpace(*personID) != "" {
		meta["person_linked"] = true
	}

	updates := map[string]interface{}{
		"last_seen_timestamp":        at,
		"cluster_embedding_centroid": models.NewJSONB(updatedCentroid),
		"metadata":                   models.NewJSONB(meta),
	}

	if personID != nil && strings.TrimSpace(*personID) != "" {
		updates["associated_person_id"] = strings.TrimSpace(*personID)
	}
	if riskLevel != nil {
		updates["risk_level"] = *riskLevel
	}

	return tx.Model(&models.GlobalIdentity{}).
		Where("global_identity_id = ?", identity.GlobalIdentityID).
		Updates(updates).Error
}

// assignGlobalIdentity resolves/creates a stable global identity for each FRS detection.
func assignGlobalIdentity(tx *gorm.DB, personID *string, embedding []float64, timestamp time.Time) (*models.GlobalIdentity, float64, error) {
	if len(embedding) == 0 {
		if personID == nil || strings.TrimSpace(*personID) == "" {
			return nil, 0, nil
		}
		var existing models.GlobalIdentity
		err := tx.Where("associated_person_id = ?", strings.TrimSpace(*personID)).
			Order("last_seen_timestamp DESC").
			First(&existing).Error
		if err == nil {
			if upErr := tx.Model(&existing).Update("last_seen_timestamp", timestamp).Error; upErr != nil {
				return nil, 0, upErr
			}
			return &existing, 1, nil
		}
		if err != nil && err != gorm.ErrRecordNotFound {
			return nil, 0, err
		}
		riskLevel := riskLevelForPerson(tx, personID)
		identity, createErr := createGlobalIdentity(tx, personID, nil, timestamp, riskLevel, 0)
		return identity, 0, createErr
	}

	cfg := loadFRSReIDConfig()
	since := timestamp.Add(-cfg.UnknownMaxIdle)
	candidates, err := loadCandidateIdentities(tx, since, cfg)
	if err != nil {
		return nil, 0, err
	}

	riskLevel := riskLevelForPerson(tx, personID)

	if personID != nil && strings.TrimSpace(*personID) != "" {
		cleanPersonID := strings.TrimSpace(*personID)
		for i := range candidates {
			if candidates[i].AssociatedPersonID != nil && strings.TrimSpace(*candidates[i].AssociatedPersonID) == cleanPersonID {
				score := cosineSimilarity(embedding, centroidToFloat64(candidates[i].ClusterEmbeddingCentroid.Data))
				if score < 0 {
					score = 1
				}
				if err := updateGlobalIdentity(tx, &candidates[i], &cleanPersonID, embedding, timestamp, riskLevel, score); err != nil {
					return nil, 0, err
				}
				return &candidates[i], score, nil
			}
		}

		// Known watchlist identity overrides unknown cluster if similarity passes threshold.
		unknownBest, unknownScore := pickBestIdentity(candidates, embedding, false)
		if unknownBest != nil && unknownScore >= cfg.SimilarityThreshold {
			if err := updateGlobalIdentity(tx, unknownBest, &cleanPersonID, embedding, timestamp, riskLevel, unknownScore); err != nil {
				return nil, 0, err
			}
			return unknownBest, unknownScore, nil
		}

		identity, createErr := createGlobalIdentity(tx, &cleanPersonID, embedding, timestamp, riskLevel, 1.0)
		return identity, 1.0, createErr
	}

	// Try known identities first, then unknown clusters.
	knownBest, knownScore := pickBestIdentity(candidates, embedding, true)
	if knownBest != nil && knownScore >= cfg.SimilarityThreshold {
		if err := updateGlobalIdentity(tx, knownBest, knownBest.AssociatedPersonID, embedding, timestamp, knownBest.RiskLevel, knownScore); err != nil {
			return nil, 0, err
		}
		return knownBest, knownScore, nil
	}

	unknownBest, unknownScore := pickBestIdentity(candidates, embedding, false)
	if unknownBest != nil && unknownScore >= cfg.SimilarityThreshold {
		if err := updateGlobalIdentity(tx, unknownBest, nil, embedding, timestamp, nil, unknownScore); err != nil {
			return nil, 0, err
		}
		return unknownBest, unknownScore, nil
	}

	identity, createErr := createGlobalIdentity(tx, nil, embedding, timestamp, nil, 0)
	return identity, 0, createErr
}

func newUUID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		// Fall back to deterministic time-seeded bytes if crypto/rand is unavailable.
		now := time.Now().UnixNano()
		for i := range buf {
			shift := uint((i % 8) * 8)
			buf[i] = byte((now >> shift) & 0xff)
			now = now*1664525 + 1013904223
		}
	}

	buf[6] = (buf[6] & 0x0f) | 0x40
	buf[8] = (buf[8] & 0x3f) | 0x80

	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		binary.BigEndian.Uint32(buf[0:4]),
		binary.BigEndian.Uint16(buf[4:6]),
		binary.BigEndian.Uint16(buf[6:8]),
		binary.BigEndian.Uint16(buf[8:10]),
		uint64(buf[10])<<40|uint64(buf[11])<<32|uint64(buf[12])<<24|uint64(buf[13])<<16|uint64(buf[14])<<8|uint64(buf[15]),
	)
}
