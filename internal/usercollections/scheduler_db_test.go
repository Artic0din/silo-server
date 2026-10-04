package usercollections

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Silo-Server/silo-server/internal/userstore"
	"github.com/Silo-Server/silo-server/internal/userstore/pgstore"
)

// TestSchedulerFailureKeepsAScheduleEditedDuringTheSyncDB pins the failed
// sync's retry delay: it pushes back only a next_sync_at that is still due,
// so a schedule turned off or changed while the sync ran, on any node, keeps
// what the edit wrote.
func TestSchedulerFailureKeepsAScheduleEditedDuringTheSyncDB(t *testing.T) {
	dsn := os.Getenv("SILO_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("SILO_TEST_DATABASE_URL is not set")
	}
	ctx := t.Context()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	var account int
	if err := pool.QueryRow(ctx, `INSERT INTO users(username,role) VALUES($1,'user') RETURNING id`, fmt.Sprintf("scheduler-failure-%d", time.Now().UnixNano())).Scan(&account); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM users WHERE id=$1`, account)
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM user_collection_revisions WHERE user_id=$1`, account)
	})
	store, err := pgstore.NewPostgresProvider(pool).ForUser(ctx, account)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.CreateProfile(ctx, userstore.Profile{ID: "owner", Name: "owner"}); err != nil {
		t.Fatal(err)
	}
	scheduler := NewScheduler(pool, nil, slog.New(slog.DiscardHandler))
	daily, weekly := AllowedSyncSchedules["daily"], AllowedSyncSchedules["weekly"]
	due := time.Now().Add(-time.Minute).UTC().Truncate(time.Microsecond)

	// failDuring creates a collection that is due on the daily schedule,
	// applies edit as if it landed while the sync ran, then records the
	// failure, and returns the stored collection.
	failDuring := func(t *testing.T, edit *userstore.UpdateCollectionInput) *userstore.Collection {
		t.Helper()
		c, err := store.CreateCollection(ctx, userstore.CreateCollectionInput{
			CreatorProfileID: "owner", Name: "Synced", CollectionType: "mdblist", QueryDefinition: "{}",
			SourceConfig: `{"mode":"mdblist","url":"https://mdblist.com/lists/user/list"}`,
			SyncSchedule: &daily, NextSyncAt: &due,
		})
		if err != nil {
			t.Fatal(err)
		}
		if edit != nil {
			edit.ID, edit.RequestProfileID = c.ID, "owner"
			if err := store.UpdateCollection(ctx, *edit); err != nil {
				t.Fatal(err)
			}
		}
		scheduler.advanceAfterFailure(ctx, dueCollection{UserID: account, CollectionID: c.ID}, time.Now())
		got, err := store.GetCollection(ctx, c.ID)
		if err != nil {
			t.Fatal(err)
		}
		return got
	}

	t.Run("an unchanged schedule retries after the minimum interval", func(t *testing.T) {
		before := time.Now()
		got := failDuring(t, nil)
		interval := time.Duration(MinSyncIntervalHours) * time.Hour
		low, high := before.Add(interval), time.Now().Add(interval)
		if got.NextSyncAt == nil || got.NextSyncAt.Before(low.Add(-time.Second)) || got.NextSyncAt.After(high.Add(time.Second)) {
			t.Fatalf("next_sync_at = %v, want between %v and %v", got.NextSyncAt, low, high)
		}
	})
	t.Run("a schedule turned off during the sync stays off", func(t *testing.T) {
		got := failDuring(t, &userstore.UpdateCollectionInput{ClearSyncSchedule: true, ClearNextSyncAt: true})
		if got.SyncSchedule != nil || got.NextSyncAt != nil {
			t.Fatalf("schedule %v, next_sync_at %v; want both null", got.SyncSchedule, got.NextSyncAt)
		}
	})
	t.Run("a schedule changed during the sync keeps its own next run", func(t *testing.T) {
		weeklyNext := time.Now().Add(6 * 24 * time.Hour).UTC().Truncate(time.Microsecond)
		got := failDuring(t, &userstore.UpdateCollectionInput{SyncSchedule: &weekly, NextSyncAt: &weeklyNext})
		if got.NextSyncAt == nil || !got.NextSyncAt.Equal(weeklyNext) {
			t.Fatalf("next_sync_at = %v, want %v", got.NextSyncAt, weeklyNext)
		}
	})
}
