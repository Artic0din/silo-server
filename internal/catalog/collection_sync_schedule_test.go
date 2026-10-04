package catalog

import (
	"testing"
	"time"
)

// TestComputeNextSyncAtFromUsesLocalWallTime checks that a cron expression is
// evaluated on the node's local clock whatever zone the reference time is in,
// and that the result keeps the reference time's location.
func TestComputeNextSyncAtFromUsesLocalWallTime(t *testing.T) {
	local := time.FixedZone("UTC-5", -5*60*60)
	saved := time.Local
	time.Local = local
	t.Cleanup(func() { time.Local = saved })

	after := time.Date(2026, time.July, 1, 12, 0, 0, 0, time.UTC) // 07:00 local
	next := ComputeNextSyncAtFrom("30 4 * * *", after)
	if next == nil {
		t.Fatal("ComputeNextSyncAtFrom returned nil")
	}
	if next.Location() != time.UTC {
		t.Errorf("location = %s, want UTC", next.Location())
	}
	earliest := time.Date(2026, time.July, 2, 4, 30, 0, 0, local)
	if next.Before(earliest) || !next.Before(earliest.Add(15*time.Minute)) {
		t.Errorf("next = %s, want within 15 minutes after %s", next, earliest)
	}
}

// TestParseCronExpressionRejectsZonePrefix checks that a schedule cannot pick
// its own zone: every cron schedule runs on the node's local clock, the zone
// the collection capability documents report as schedule_time_zone.
func TestParseCronExpressionRejectsZonePrefix(t *testing.T) {
	for _, expr := range []string{"CRON_TZ=UTC 30 4 * * *", "TZ=America/Chicago 30 4 * * *", " CRON_TZ=UTC 30 4 * * *"} {
		if err := ParseCronExpression(expr); err == nil {
			t.Errorf("ParseCronExpression(%q) accepted a zone prefix", expr)
		}
	}
	if err := ParseCronExpression("30 4 * * *"); err != nil {
		t.Errorf("ParseCronExpression(30 4 * * *) = %v", err)
	}
}
