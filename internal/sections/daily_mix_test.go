package sections

import (
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/Silo-Server/silo-server/internal/models"
)

func mixPool(n int) []*models.MediaItem {
	pool := make([]*models.MediaItem, n)
	for i := range pool {
		pool[i] = &models.MediaItem{ContentID: fmt.Sprintf("movie:%03d", i)}
	}
	return pool
}

func mixIDs(items []*models.MediaItem) []string {
	ids := make([]string, len(items))
	for i, item := range items {
		ids[i] = item.ContentID
	}
	return ids
}

func TestDailyBestOfKeepsASmallPoolWhole(t *testing.T) {
	pool := mixPool(15)
	got := dailyBestOf(pool, 20, "critically_acclaimed", time.Now())
	if !reflect.DeepEqual(mixIDs(got), mixIDs(pool)) {
		t.Fatalf("pool smaller than the limit changed: %v", mixIDs(got))
	}
}

func TestDailyBestOfIsStableForADayAndKeepsRatingOrder(t *testing.T) {
	pool := mixPool(100)
	morning := time.Date(2026, 10, 8, 1, 0, 0, 0, time.UTC)
	evening := time.Date(2026, 10, 8, 23, 0, 0, 0, time.UTC)

	first := dailyBestOf(pool, 20, "critically_acclaimed", morning)
	if len(first) != 20 {
		t.Fatalf("got %d items, want 20", len(first))
	}
	if !reflect.DeepEqual(mixIDs(first), mixIDs(dailyBestOf(pool, 20, "critically_acclaimed", evening))) {
		t.Fatal("the mix changed within one UTC day")
	}
	// The pool arrives best first; the mix must keep that order.
	for i := 1; i < len(first); i++ {
		if first[i-1].ContentID >= first[i].ContentID {
			t.Fatalf("mix is out of pool order at %d: %v", i, mixIDs(first))
		}
	}
}

func TestDailyBestOfChangesByDayAndKey(t *testing.T) {
	pool := mixPool(100)
	today := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	ids := mixIDs(dailyBestOf(pool, 20, "critically_acclaimed", today))

	if reflect.DeepEqual(ids, mixIDs(dailyBestOf(pool, 20, "critically_acclaimed", today.AddDate(0, 0, 1)))) {
		t.Error("the next day shows the same mix")
	}
	if reflect.DeepEqual(ids, mixIDs(dailyBestOf(pool, 20, "mood_collection|feel_good", today))) {
		t.Error("two different rows show the same mix")
	}
}

func TestDiscoveryLimitsDefaultsAndPool(t *testing.T) {
	if limit, pool := discoveryLimits(ResolvedSection{}); limit != 20 || pool != 100 {
		t.Errorf("unset limit = (%d, %d), want (20, 100)", limit, pool)
	}
	if limit, pool := discoveryLimits(ResolvedSection{ItemLimit: 12}); limit != 12 || pool != 60 {
		t.Errorf("limit 12 = (%d, %d), want (12, 60)", limit, pool)
	}
}
