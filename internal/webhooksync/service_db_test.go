package webhooksync

import (
	"context"
	"fmt"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Silo-Server/silo-server/internal/historyimport"
	"github.com/Silo-Server/silo-server/internal/secret"
	"github.com/Silo-Server/silo-server/internal/userstore"
)

// removeRecorder records mark-unplayed writes; every other store method is
// unused by the mark-unplayed path.
type removeRecorder struct {
	userstore.UserStore
	removed []string
}

func (r *removeRecorder) RemoveHistoryItems(_ context.Context, _ string, mediaItemIDs []string, _ time.Time) error {
	r.removed = append(r.removed, mediaItemIDs...)
	return nil
}

type recorderProvider struct{ store *removeRecorder }

func (p recorderProvider) ForUser(context.Context, int) (userstore.UserStore, error) {
	return p.store, nil
}

func (recorderProvider) Close() error { return nil }

// A delayed Jellyfin mark-unplayed must not erase Silo progress that is newer
// than the event; one newer than the progress still applies.
func TestProcessWebhookMarkUnplayedRespectsNewerLocalProgressDB(t *testing.T) {
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

	suffix := uuid.NewString()
	var userID int
	if err := pool.QueryRow(ctx, `INSERT INTO users(username,role) VALUES($1,'user') RETURNING id`, "webhook-sync-"+suffix).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	mediaItemID := "webhook-sync-movie-" + suffix
	tmdbID := fmt.Sprintf("webhook-sync-%s", suffix)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM media_items WHERE content_id = $1`, mediaItemID)
	})
	profileID := uuid.NewString()
	connectionID := uuid.NewString()
	localUpdatedAt := time.Date(2026, 4, 7, 12, 0, 0, 0, time.UTC)
	for _, stmt := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO user_profiles(id,user_id,name) VALUES($1,$2,'Viewer')`, []any{profileID, userID}},
		{`INSERT INTO media_items(content_id,type,title,status,tmdb_id) VALUES($1,'movie','Movie','matched',$2)`, []any{mediaItemID, tmdbID}},
		{`INSERT INTO webhook_sync_connections(id,user_id,provider,webhook_secret) VALUES($1,$2,'jellyfin',$3)`, []any{connectionID, userID, suffix}},
		{`INSERT INTO webhook_sync_profile_mappings(connection_id,external_user_id,external_user_name,silo_profile_id) VALUES($1,'jf-user','Viewer',$2)`, []any{connectionID, profileID}},
		{`INSERT INTO user_watch_progress(user_id,profile_id,media_item_id,updated_at) VALUES($1,$2,$3,$4)`, []any{userID, profileID, mediaItemID, localUpdatedAt}},
	} {
		if _, err := pool.Exec(ctx, stmt.sql, stmt.args...); err != nil {
			t.Fatalf("%s: %v", stmt.sql, err)
		}
	}

	cipher, err := secret.New([]byte("synthetic-webhook-sync-test-key-material"))
	if err != nil {
		t.Fatal(err)
	}
	store := &removeRecorder{}
	svc := NewService(NewRepository(pool, cipher), historyimport.NewRepository(pool, cipher), recorderProvider{store: store})
	unplay := func(at time.Time) *ProcessWebhookResult {
		t.Helper()
		body := fmt.Sprintf(`{
			"notification_type": "UserDataSaved",
			"timestamp": %q,
			"user": { "id": "jf-user", "name": "Viewer" },
			"item": { "id": "jf-item", "type": "Movie", "name": "Movie", "provider_ids": { "tmdb": %q } },
			"user_data": { "save_reason": "TogglePlayed", "played": false }
		}`, at.Format(time.RFC3339Nano), tmdbID)
		req := httptest.NewRequest("POST", "/webhook", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		result, err := svc.ProcessWebhookBounded(ctx, suffix, req, 1<<20)
		if err != nil {
			t.Fatalf("ProcessWebhookBounded() error = %v", err)
		}
		return result
	}

	if result := unplay(localUpdatedAt.Add(-time.Hour)); result.Outcome != OutcomeSkipped || len(store.removed) != 0 {
		t.Fatalf("older mark-unplayed: outcome %q (%s), removed %v; want skipped with nothing removed", result.Outcome, result.Summary, store.removed)
	}
	if result := unplay(localUpdatedAt.Add(time.Hour)); result.Outcome != OutcomeApplied || len(store.removed) != 1 || store.removed[0] != mediaItemID {
		t.Fatalf("newer mark-unplayed: outcome %q (%s), removed %v; want applied to %s", result.Outcome, result.Summary, store.removed, mediaItemID)
	}
}
