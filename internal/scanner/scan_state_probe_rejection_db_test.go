package scanner

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Silo-Server/silo-server/internal/models"
)

// TestScanStateCarriesProbeRejectionDB checks the scan state a library scan
// reads: a file ffprobe rejected keeps its mark there, so a rescan of the
// unchanged file skips the probe repair.
func TestScanStateCarriesProbeRejectionDB(t *testing.T) {
	dsn := os.Getenv("SILO_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("SILO_TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect test database: %v", err)
	}
	t.Cleanup(pool.Close)

	suffix := time.Now().UnixNano()
	var folderID int
	if err := pool.QueryRow(ctx, `INSERT INTO media_folders (type, name, enabled) VALUES ('movies', $1, true) RETURNING id`,
		fmt.Sprintf("probe-rejection-%d", suffix)).Scan(&folderID); err != nil {
		t.Fatalf("seed folder: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM media_files WHERE media_folder_id = $1`, folderID)
		_, _ = pool.Exec(ctx, `DELETE FROM media_folders WHERE id = $1`, folderID)
	})

	modifiedAt := time.Now().UTC().Truncate(time.Microsecond)
	rejectedAt := modifiedAt.Add(time.Minute)
	repo := NewFileRepository(pool)
	if _, err := repo.Upsert(ctx, models.MediaFile{
		MediaFolderID:  folderID,
		FilePath:       fmt.Sprintf("/tmp/probe-rejection-%d.mkv", suffix),
		FileSize:       1_000,
		FileModifiedAt: &modifiedAt,
		ProbeFailedAt:  &rejectedAt,
	}); err != nil {
		t.Fatalf("seed rejected file: %v", err)
	}

	states, err := repo.GetScanStateByFolder(ctx, folderID)
	if err != nil {
		t.Fatalf("GetScanStateByFolder: %v", err)
	}
	if len(states) != 1 {
		t.Fatalf("scan state rows = %d, want 1", len(states))
	}
	state := states[0]
	if state.ProbeFailedAt == nil || state.ProbeUpdatedAt != nil {
		t.Fatalf("scan state probe_failed_at = %v, probe_updated_at = %v, want a rejection and no probe", state.ProbeFailedAt, state.ProbeUpdatedAt)
	}
	reasons := scanStateUpdateReasons(state, 1_000, modifiedAt, nil, false, fileRootAssignment{}, fileGroupAssignment{}, "movies", true)
	if testStringSliceContains(reasons, "probe_repair") {
		t.Fatalf("rescan reasons = %#v, want no probe_repair for the unchanged rejected file", reasons)
	}
}
