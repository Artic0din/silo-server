package sections

import (
	"crypto/sha256"
	"encoding/binary"
	"sort"
	"strconv"
	"time"

	"github.com/Silo-Server/silo-server/internal/models"
)

// discoveryPoolFactor sets how deep a discovery row's daily mix reaches: each
// day the row shows its item limit drawn from the best-rated limit×factor
// qualifying titles, so about four in five of them appear within a week.
const discoveryPoolFactor = 5

// discoveryLimits returns a discovery row's display limit (20 when unset) and
// the pool size its query should fetch.
func discoveryLimits(s ResolvedSection) (limit, pool int) {
	limit = s.ItemLimit
	if limit <= 0 {
		limit = 20
	}
	return limit, limit * discoveryPoolFactor
}

// dailyBestOf picks limit items from pool, which is ordered best first, and
// returns them in pool order. The pick is deterministic for a key and UTC
// day, so a row is stable all day, the same for every viewer of the same
// pool, and different the next day.
func dailyBestOf(pool []*models.MediaItem, limit int, key string, now time.Time) []*models.MediaItem {
	if limit <= 0 || len(pool) <= limit {
		return pool
	}
	day := now.UTC().Unix() / 86400
	type ranked struct {
		index int
		score uint64
	}
	ranks := make([]ranked, len(pool))
	// SHA-256 rather than FNV: content IDs differ only in their last bytes,
	// which FNV mixes too weakly for different keys to give different picks.
	prefix := key + "|" + strconv.FormatInt(day, 10) + "|"
	for i, item := range pool {
		sum := sha256.Sum256([]byte(prefix + item.ContentID))
		ranks[i] = ranked{index: i, score: binary.BigEndian.Uint64(sum[:8])}
	}
	sort.Slice(ranks, func(a, b int) bool { return ranks[a].score < ranks[b].score })
	picked := make([]bool, len(pool))
	for _, r := range ranks[:limit] {
		picked[r.index] = true
	}
	out := make([]*models.MediaItem, 0, limit)
	for i, item := range pool {
		if picked[i] {
			out = append(out, item)
		}
	}
	return out
}
