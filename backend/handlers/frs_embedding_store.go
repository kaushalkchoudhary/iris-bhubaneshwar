package handlers

import (
	"fmt"
	"strings"

	"gorm.io/gorm"
)

// storeFRSEmbedding persists embedding vectors into pgvector-backed embeddings table.
func storeFRSEmbedding(tx *gorm.DB, eventID int64, embedding []float64) error {
	if tx == nil || eventID <= 0 || len(embedding) == 0 {
		return nil
	}
	if len(embedding) != 512 {
		// Keep ingestion resilient if a non-512 embedding arrives.
		return nil
	}

	var b strings.Builder
	b.Grow(8192)
	b.WriteByte('[')
	for i, v := range embedding {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(fmt.Sprintf("%.8f", v))
	}
	b.WriteByte(']')
	vectorLiteral := b.String()

	return tx.Exec(
		`INSERT INTO embeddings (event_id, embedding_vector)
		 VALUES (?, ?::vector)
		 ON CONFLICT (event_id)
		 DO UPDATE SET embedding_vector = EXCLUDED.embedding_vector`,
		eventID,
		vectorLiteral,
	).Error
}
