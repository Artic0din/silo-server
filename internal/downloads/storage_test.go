package downloads

import (
	"context"
	"fmt"
	"math/rand/v2"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Silo-Server/silo-server/internal/config"
	"github.com/Silo-Server/silo-server/internal/downloadstorage"
	"github.com/Silo-Server/silo-server/internal/nodepool"
)

type fakeStorageNodes struct{ nodes []*nodepool.Node }

func (f fakeStorageNodes) List(context.Context) ([]*nodepool.Node, error) { return f.nodes, nil }

// remoteReadyArtifact stores a ready prepared file on nodeID, last used age ago.
func remoteReadyArtifact(t *testing.T, repo *ArtifactRepository, pool *pgxpool.Pool, fileID, nodeID int, size int64, age time.Duration) *Artifact {
	t.Helper()
	ctx := context.Background()
	a := newArtifact(t, fileID, fmt.Sprintf("hash-storage-%d-%d", time.Now().UnixNano(), rand.Int()))
	row, _, err := repo.EnsureQueued(ctx, a)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx,
		`UPDATE download_artifacts SET status = 'ready', origin_node_id = $2, origin_node_url = 'http://storage-test-node',
		     origin_artifact_id = $1 || '-attempt', file_size = $3, completed_at = now(),
		     last_used_at = now() - make_interval(secs => $4)
		 WHERE id = $1`, row.ID, nodeID, size, age.Seconds()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM download_artifact_orphans WHERE download_artifact_id = $1`, row.ID)
		_, _ = pool.Exec(ctx, `DELETE FROM download_storage_events WHERE artifact_id = $1`, row.ID)
	})
	got, err := repo.GetByID(ctx, row.ID)
	if err != nil {
		t.Fatal(err)
	}
	return got
}

func storageTestManager(repo *ArtifactRepository, cfg *config.Config, nodes ...*nodepool.Node) *ArtifactManager {
	m := NewArtifactManager(repo, nil, nil, nil, "storage-test", func() *config.Config { return cfg }, nil)
	m.SetStorageNodes(fakeStorageNodes{nodes: nodes})
	return m
}

func artifactStatus(t *testing.T, repo *ArtifactRepository, id string) string {
	t.Helper()
	a, err := repo.GetByID(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	return a.Status
}

func eventReasons(t *testing.T, pool *pgxpool.Pool, artifactID string) []string {
	t.Helper()
	rows, err := pool.Query(context.Background(), `SELECT reason FROM download_storage_events WHERE artifact_id = $1 ORDER BY id`, artifactID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var r string
		if err := rows.Scan(&r); err != nil {
			t.Fatal(err)
		}
		out = append(out, r)
	}
	return out
}

func TestEnforceStorageExpiresCachedFilesThenEnforcesBudget(t *testing.T) {
	repo, pool, fileID := newArtifactTestRepo(t)
	ctx := context.Background()
	nodeID := 700000 + rand.IntN(100000)
	old := remoteReadyArtifact(t, repo, pool, fileID, nodeID, 100, 5*24*time.Hour)
	finished := remoteReadyArtifact(t, repo, pool, fileID, nodeID, 100, 2*time.Hour)
	unlinked := remoteReadyArtifact(t, repo, pool, fileID, nodeID, 100, time.Hour)
	inUse := remoteReadyArtifact(t, repo, pool, fileID, nodeID, 100, 4*24*time.Hour)
	linkRecoveryDownload(t, pool, fileID, finished.ID, StatusCompleted)
	linkRecoveryDownload(t, pool, fileID, inUse.ID, StatusReady)

	budget := int64(150)
	cfg := &config.Config{}
	cfg.Download.ArtifactCacheHours = 72
	cfg.Download.ArtifactDiskCeilingPercent = 85
	m := storageTestManager(repo, cfg, &nodepool.Node{ID: nodeID, Name: "storage-test", Type: "transcode", Enabled: true, DownloadArtifactMaxBytesOverride: &budget})

	freed := m.enforceStorage(ctx, NodeLocationKey(nodeID))
	if freed != 300 {
		t.Fatalf("freed = %d, want 300 (one past its cache period, two to meet the budget)", freed)
	}
	for _, a := range []*Artifact{old, finished, unlinked} {
		if got := artifactStatus(t, repo, a.ID); got != ArtifactExpired {
			t.Fatalf("artifact %s status = %s, want expired", a.ID, got)
		}
	}
	if got := artifactStatus(t, repo, inUse.ID); got != ArtifactReady {
		t.Fatalf("a file a download waits on was removed: %s", got)
	}
	if got := eventReasons(t, pool, old.ID); len(got) != 1 || got[0] != StorageReasonCacheExpired {
		t.Fatalf("old file history = %v, want cache_expired", got)
	}
	for _, a := range []*Artifact{finished, unlinked} {
		if got := eventReasons(t, pool, a.ID); len(got) != 1 || got[0] != StorageReasonBudget {
			t.Fatalf("file %s history = %v, want budget", a.ID, got)
		}
	}
	orphans, err := repo.ListRemoteOrphansDue(ctx, 1000)
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range []*Artifact{old, finished, unlinked} {
		if len(remoteOrphansForArtifact(orphans, a.ID)) != 1 {
			t.Fatalf("expired node file %s was not queued for deletion", a.ID)
		}
	}
	if m.NodeStorageFull(nodeID) {
		t.Fatal("node under its budget after clean-up must accept work")
	}

	// A budget below what downloads still need cannot be met: the node is
	// marked full so placement stops sending it work.
	tight := int64(50)
	m.SetStorageNodes(fakeStorageNodes{nodes: []*nodepool.Node{{ID: nodeID, Name: "storage-test", Type: "transcode", Enabled: true, DownloadArtifactMaxBytesOverride: &tight}}})
	if freed := m.enforceStorage(ctx, NodeLocationKey(nodeID)); freed != 0 {
		t.Fatalf("freed = %d with only in-use files left", freed)
	}
	if !m.NodeStorageFull(nodeID) {
		t.Fatal("node over budget with nothing to free must be marked full")
	}
}

func TestOverCeilingIgnoresAMeasurementOlderThanTheLastEviction(t *testing.T) {
	m := &ArtifactManager{lastCeilingEviction: map[int]time.Time{}}
	measured := time.Now().Add(-time.Minute)
	loc := storageLocation{NodeID: 3, Usage: &downloadstorage.Usage{MeasuredAt: measured, FSUsedBytes: 900, FSTotalBytes: 1000}}
	if got := m.overCeiling(loc, 0); got != 50 {
		t.Fatalf("over ceiling = %d, want 50 above 85%%", got)
	}
	if got := m.overCeiling(loc, 100); got != -50 {
		t.Fatalf("over ceiling after freeing 100 = %d, want -50", got)
	}
	m.lastCeilingEviction[3] = time.Now()
	if got := m.overCeiling(loc, 0); got != 0 {
		t.Fatalf("a measurement taken before the last eviction was acted on again: %d", got)
	}
	stale := storageLocation{NodeID: 4, Usage: &downloadstorage.Usage{MeasuredAt: time.Now(), FSUsedBytes: 999, FSTotalBytes: 1000, Stale: true}}
	if got := m.overCeiling(stale, 0); got != 0 {
		t.Fatalf("a stale measurement was acted on: %d", got)
	}
}

func TestFindUntracked(t *testing.T) {
	now := time.Now()
	old, fresh := now.Add(-2*time.Hour), now.Add(-time.Minute)
	files := []downloadstorage.File{
		{Name: "a.mp4", Kind: downloadstorage.KindComplete, Bytes: 10, ModTime: old},              // tracked
		{Name: "a.mp4.receipt.json", Kind: downloadstorage.KindOther, Bytes: 1, ModTime: old},     // belongs to tracked
		{Name: "b.mp4", Kind: downloadstorage.KindComplete, Bytes: 20, ModTime: old},              // untracked
		{Name: "b.mp4.receipt.json", Kind: downloadstorage.KindOther, Bytes: 2, ModTime: old},     // untracked
		{Name: "c.mp4", Kind: downloadstorage.KindComplete, Bytes: 30, ModTime: fresh},            // too new to judge
		{Name: "d.mp4.part", Kind: downloadstorage.KindPartial, Bytes: 40, ModTime: old},          // dead partial
		{Name: "e.mp4.part", Kind: downloadstorage.KindPartial, Bytes: 50, ModTime: fresh},        // encode in progress
		{Name: "a.mp4.receipt.json.123", Kind: downloadstorage.KindOther, Bytes: 3, ModTime: old}, // temp of tracked
	}
	got := findUntracked(files, map[string]bool{"a.mp4": true}, now)
	names := map[string]bool{}
	for _, f := range got {
		names[f.Name] = true
	}
	want := []string{"b.mp4", "b.mp4.receipt.json", "d.mp4.part"}
	if len(got) != len(want) {
		t.Fatalf("untracked = %v, want %v", names, want)
	}
	for _, n := range want {
		if !names[n] {
			t.Fatalf("untracked = %v, missing %s", names, n)
		}
	}
	if s := sumUntracked(got); s.Files != 3 || s.Bytes != 62 {
		t.Fatalf("summary = %+v", s)
	}
}

func TestNodeArtifactIDFromFile(t *testing.T) {
	for name, want := range map[string]string{
		"abc-123.mp4": "abc-123", "abc-123.mp4.part": "abc-123",
		"abc-123.mp4.receipt.json": "abc-123", "abc-123.mp4.receipt.json.99": "abc-123",
	} {
		if got := nodeArtifactIDFromFile(name); got != want {
			t.Errorf("nodeArtifactIDFromFile(%q) = %q, want %q", name, got, want)
		}
	}
}

func TestParseLocationKey(t *testing.T) {
	for key, want := range map[string]int{"server": 0, "node:7": 7} {
		if got, ok := ParseLocationKey(key); !ok || got != want {
			t.Errorf("ParseLocationKey(%q) = (%d, %v)", key, got, ok)
		}
	}
	for _, key := range []string{"", "node:", "node:0", "node:-1", "node:07", "device", "node:x"} {
		if _, ok := ParseLocationKey(key); ok {
			t.Errorf("ParseLocationKey(%q) accepted", key)
		}
	}
}

func TestPrepareDownloadAgainRequeuesAnExpiredFile(t *testing.T) {
	repo, pool, fileID := newArtifactTestRepo(t)
	ctx := context.Background()
	a := remoteReadyArtifact(t, repo, pool, fileID, 700000+rand.IntN(100000), 100, 4*24*time.Hour)
	linkRecoveryDownload(t, pool, fileID, a.ID, StatusCompleted)
	if applied, err := repo.ExpireReady(ctx, a, missingArtifactRetireGrace); err != nil || !applied {
		t.Fatalf("ExpireReady = (%v, %v)", applied, err)
	}
	var d Download
	if err := scanInto(pool.QueryRow(ctx, `SELECT `+downloadColumns+` FROM downloads WHERE artifact_id = $1`, a.ID), &d); err != nil {
		t.Fatal(err)
	}
	updated, requeued, err := repo.PrepareDownloadAgain(ctx, &d)
	if err != nil || !requeued || updated.Status != StatusPreparing || updated.Revision != d.Revision {
		t.Fatalf("PrepareDownloadAgain = (%+v, %v, %v)", updated, requeued, err)
	}
	if got := artifactStatus(t, repo, a.ID); got != ArtifactQueued {
		t.Fatalf("artifact after prepare again = %s, want queued", got)
	}
	// Asking again while it prepares changes nothing.
	again, requeued, err := repo.PrepareDownloadAgain(ctx, updated)
	if err != nil || requeued || again.Status != StatusPreparing {
		t.Fatalf("second PrepareDownloadAgain = (%+v, %v, %v)", again, requeued, err)
	}
}

func TestRevokeManagedExcludesMonitoredEpisodesAndRecordsHistory(t *testing.T) {
	f := seedManagedFixture(t)
	ctx := context.Background()
	subID := fmt.Sprintf("sub-%d", time.Now().UnixNano())
	if _, err := f.pool.Exec(ctx, `INSERT INTO download_subscriptions (id, user_id, profile_id, device_id, series_id, mode, active, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, 'all', true, now(), now())`, subID, f.userID, f.profileA, f.deviceA, f.contentID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = f.pool.Exec(ctx, `DELETE FROM download_subscriptions WHERE id = $1`, subID) })
	now := time.Now()
	episodeID := fmt.Sprintf("ep-%d", now.UnixNano())
	ids := []string{fmt.Sprintf("dl-rev-a-%d", now.UnixNano()), fmt.Sprintf("dl-rev-b-%d", now.UnixNano())}
	for i, id := range ids {
		ep := ""
		if i == 0 {
			ep = episodeID
		}
		if err := f.repo.Create(ctx, &Download{
			ID: id, UserID: f.userID, ProfileID: f.profileA, DeviceID: f.deviceA, MediaFileID: f.fileID,
			ContentID: f.contentID, EpisodeID: ep, Kind: KindQueued, Status: StatusCompleted,
			Format: FormatOriginal, FileSize: 500, CreatedAt: now, UpdatedAt: now,
		}); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		_, _ = f.pool.Exec(ctx, `DELETE FROM download_storage_events WHERE user_id = $1`, f.userID)
		_, _ = f.pool.Exec(ctx, `DELETE FROM download_subscription_exclusions WHERE subscription_id = $1`, subID)
	})
	var actor int
	if err := f.pool.QueryRow(ctx, `INSERT INTO users (username, role) VALUES ($1, 'admin') RETURNING id`, fmt.Sprintf("revoker-%d", now.UnixNano())).Scan(&actor); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = f.pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, actor) })

	result, err := f.repo.RevokeManaged(ctx, RevokeRequest{
		UserID: f.userID, ProfileID: f.profileA, DeviceID: f.deviceA, PauseMonitors: true, Reason: "lost phone", Actor: actor,
	}, newStorageBatchID())
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Revoked) != 2 || result.Bytes != 1000 || result.PausedMonitors != 1 {
		t.Fatalf("revoke result = %+v", result)
	}
	for _, d := range result.Revoked {
		if d.Status != StatusRevoked {
			t.Fatalf("revoked row status = %s", d.Status)
		}
	}
	var excluded, events int
	var reason string
	var revokedBy *int
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM download_subscription_exclusions WHERE subscription_id = $1 AND episode_id = $2`, subID, episodeID).Scan(&excluded); err != nil || excluded != 1 {
		t.Fatalf("monitor exclusions = %d (%v), want the revoked episode", excluded, err)
	}
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM download_storage_events WHERE user_id = $1 AND reason = 'revoked' AND actor_user_id = $2`, f.userID, actor).Scan(&events); err != nil || events != 2 {
		t.Fatalf("revoke history = %d (%v), want one per row", events, err)
	}
	if err := f.pool.QueryRow(ctx, `SELECT revoked_reason, revoked_by FROM downloads WHERE id = $1`, ids[0]).Scan(&reason, &revokedBy); err != nil || reason != "lost phone" || revokedBy == nil || *revokedBy != actor {
		t.Fatalf("revoked row = (%q, %v, %v)", reason, revokedBy, err)
	}
	var active bool
	if err := f.pool.QueryRow(ctx, `SELECT active FROM download_subscriptions WHERE id = $1`, subID).Scan(&active); err != nil || active {
		t.Fatalf("monitor active = %v (%v), want paused", active, err)
	}
	// Revoking again changes nothing.
	again, err := f.repo.RevokeManaged(ctx, RevokeRequest{IDs: ids, Actor: actor}, newStorageBatchID())
	if err != nil || len(again.Revoked) != 0 {
		t.Fatalf("second revoke = (%+v, %v)", again, err)
	}
	// The device confirming its local copy is gone deletes the row and is
	// recorded as removed from the device.
	if err := f.repo.DeleteManaged(ctx, ids[1], f.userID, f.profileA, f.deviceA); err != nil {
		t.Fatal(err)
	}
	var removed int
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM download_storage_events WHERE download_id = $1 AND reason = 'device_removed'`, ids[1]).Scan(&removed); err != nil || removed != 1 {
		t.Fatalf("device removal history = %d (%v)", removed, err)
	}
}

func TestTouchDeviceSeenWritesAtMostHourly(t *testing.T) {
	f := seedManagedFixture(t)
	ctx := context.Background()
	if _, err := f.pool.Exec(ctx, `UPDATE user_devices SET last_seen_at = now() - interval '3 days' WHERE user_id = $1 AND device_id = $2`, f.userID, f.deviceA); err != nil {
		t.Fatal(err)
	}
	if err := f.repo.TouchDeviceSeen(ctx, f.userID, f.profileA, f.deviceA); err != nil {
		t.Fatal(err)
	}
	var seen time.Time
	if err := f.pool.QueryRow(ctx, `SELECT last_seen_at FROM user_devices WHERE user_id = $1 AND device_id = $2`, f.userID, f.deviceA).Scan(&seen); err != nil {
		t.Fatal(err)
	}
	if time.Since(seen) > time.Minute {
		t.Fatalf("last seen = %v, want just now", seen)
	}
	if _, err := f.pool.Exec(ctx, `UPDATE user_devices SET last_seen_at = now() - interval '10 minutes' WHERE user_id = $1 AND device_id = $2`, f.userID, f.deviceA); err != nil {
		t.Fatal(err)
	}
	if err := f.repo.TouchDeviceSeen(ctx, f.userID, f.profileA, f.deviceA); err != nil {
		t.Fatal(err)
	}
	if err := f.pool.QueryRow(ctx, `SELECT last_seen_at FROM user_devices WHERE user_id = $1 AND device_id = $2`, f.userID, f.deviceA).Scan(&seen); err != nil {
		t.Fatal(err)
	}
	if time.Since(seen) < 9*time.Minute {
		t.Fatal("a sync within the hour rewrote last seen")
	}
}

func TestStorageReadModelsReportFilesDevicesAndHistory(t *testing.T) {
	repo, pool, fileID := newArtifactTestRepo(t)
	ctx := context.Background()
	nodeID := 700000 + rand.IntN(100000)
	cached := remoteReadyArtifact(t, repo, pool, fileID, nodeID, 300, 2*time.Hour)
	inUse := remoteReadyArtifact(t, repo, pool, fileID, nodeID, 700, time.Hour)
	linkRecoveryDownload(t, pool, fileID, inUse.ID, StatusReady)
	cfg := &config.Config{}
	cfg.Download.ArtifactCacheHours = 72
	cfg.Download.ArtifactDiskCeilingPercent = 85
	cfg.Download.ArtifactMaxBytes = 5000
	node := &nodepool.Node{ID: nodeID, Name: "read-model-node", Type: "transcode", Enabled: true, Healthy: true,
		LastStats: []byte(`{"artifacts":{"measured_at":"2026-10-08T10:00:00Z","files":2,"bytes":1000,"fs_used_bytes":5000,"fs_total_bytes":10000,"shares_scratch":true}}`)}
	m := storageTestManager(repo, cfg, node)

	overview, err := m.StorageOverview(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var view *StorageLocationView
	for i := range overview.Locations {
		if overview.Locations[i].NodeID == nodeID {
			view = &overview.Locations[i]
		}
	}
	if overview.Locations[0].Key != LocationServer || view == nil {
		t.Fatalf("locations = %+v", overview.Locations)
	}
	if view.InUseBytes != 700 || view.CachedBytes != 300 || view.WaitingDownloads != 1 || view.Budget != 5000 || view.BudgetSource != StorageSourceSetting {
		t.Fatalf("node view = %+v", view)
	}
	if view.Usage == nil || !view.Usage.SharesScratch || view.Usage.FSTotalBytes != 10000 {
		t.Fatalf("node usage = %+v", view.Usage)
	}
	if overview.CacheHours != 72 || overview.DiskCeilingPercent != 85 {
		t.Fatalf("overview settings = %+v", overview)
	}

	for _, sortBy := range []string{StorageSortSize, StorageSortLastUsed, StorageSortCreated} {
		page, err := m.StorageFilesPage(ctx, StorageFileFilter{Location: NodeLocationKey(nodeID), Sort: sortBy}, nil, 1)
		if err != nil || len(page) != 1 {
			t.Fatalf("files page (%s) = (%+v, %v)", sortBy, page, err)
		}
		after := &StorageFilePosition{Bytes: page[0].Bytes, At: page[0].LastUsedAt, ID: page[0].ArtifactID}
		if sortBy == StorageSortCreated {
			after.At = page[0].CreatedAt
		}
		rest, err := m.StorageFilesPage(ctx, StorageFileFilter{Location: NodeLocationKey(nodeID), Sort: sortBy}, after, 10)
		if err != nil || len(rest) != 1 || rest[0].ArtifactID == page[0].ArtifactID {
			t.Fatalf("second files page (%s) = (%+v, %v)", sortBy, rest, err)
		}
	}
	inUsePage, err := m.StorageFilesPage(ctx, StorageFileFilter{Location: NodeLocationKey(nodeID), State: StorageFileInUse}, nil, 10)
	if err != nil || len(inUsePage) != 1 || inUsePage[0].ArtifactID != inUse.ID || inUsePage[0].Waiting != 1 || inUsePage[0].StaleWaiting != 0 {
		t.Fatalf("in-use files = (%+v, %v)", inUsePage, err)
	}
	cachedPage, err := m.StorageFilesPage(ctx, StorageFileFilter{Location: NodeLocationKey(nodeID), State: StorageFileCached}, nil, 10)
	if err != nil || len(cachedPage) != 1 || cachedPage[0].ArtifactID != cached.ID || cachedPage[0].ExpiresAt == nil {
		t.Fatalf("cached files = (%+v, %v)", cachedPage, err)
	}

	results, err := m.DeleteStorageFiles(ctx, []string{cached.ID, inUse.ID, "missing-id"}, false, 0)
	if err != nil {
		t.Fatal(err)
	}
	outcomes := map[string]string{}
	for _, r := range results {
		outcomes[r.ArtifactID] = r.Outcome
	}
	if outcomes[cached.ID] != StorageDeleteDeleted || outcomes[inUse.ID] != StorageDeleteInUse || outcomes["missing-id"] != StorageDeleteNotFound {
		t.Fatalf("delete outcomes = %v", outcomes)
	}
	history, err := m.StorageEventsPage(ctx, StorageEventFilter{Location: NodeLocationKey(nodeID)}, nil, 10)
	if err != nil || len(history) != 1 || history[0].Reason != StorageReasonAdminDelete || history[0].Bytes != 300 || history[0].Count != 1 {
		t.Fatalf("history = (%+v, %v)", history, err)
	}
	more, err := m.StorageEventsPage(ctx, StorageEventFilter{Location: NodeLocationKey(nodeID)}, &StorageEventPosition{At: history[0].OccurredAt, BatchID: history[0].BatchID}, 10)
	if err != nil || len(more) != 0 {
		t.Fatalf("history after the last batch = (%+v, %v)", more, err)
	}
}

func TestAdminDeviceAndEntryPages(t *testing.T) {
	f := seedManagedFixture(t)
	ctx := context.Background()
	f.createManagedEntry(t)
	svc := &Service{repo: f.repo}
	for _, sortBy := range []string{DeviceSortLastSeen, DeviceSortSize} {
		rows, err := svc.AdminListDevicesPage(ctx, AdminDeviceFilter{Query: "Phone A", Sort: sortBy}, nil, 50)
		if err != nil {
			t.Fatalf("devices (%s): %v", sortBy, err)
		}
		var found *AdminDeviceRow
		for i := range rows {
			if rows[i].DeviceID == f.deviceA {
				found = &rows[i]
			}
		}
		if found == nil || found.Copies != 1 || found.Waiting != 1 || found.DeviceName != "Phone A" || found.ProfileName != "A" {
			t.Fatalf("device row (%s) = %+v", sortBy, found)
		}
		after := &AdminDevicePosition{UserID: found.UserID, ProfileID: found.ProfileID, DeviceID: found.DeviceID, Bytes: found.BytesOnDevice}
		if found.LastSeenAt != nil {
			after.LastSeen = *found.LastSeenAt
		}
		if _, err := svc.AdminListDevicesPage(ctx, AdminDeviceFilter{Sort: sortBy}, after, 50); err != nil {
			t.Fatalf("devices after a position (%s): %v", sortBy, err)
		}
	}
	entries, err := svc.AdminListEntriesPage(ctx, AdminEntryFilter{UserID: f.userID, DeviceID: f.deviceA, Status: StatusReady}, nil, 10)
	if err != nil || len(entries) != 1 || entries[0].DeviceName != "Phone A" {
		t.Fatalf("entries = (%+v, %v)", entries, err)
	}
}

func TestUpsertStorageSampleKeepsLargeCountsAndLastReconciliation(t *testing.T) {
	repo, _, _ := newArtifactTestRepo(t)
	ctx := context.Background()
	reporter := fmt.Sprintf("sample-test-%d", time.Now().UnixNano())
	t.Cleanup(func() {
		_, _ = repo.pool.Exec(ctx, `DELETE FROM download_storage_samples WHERE reporter = $1`, reporter)
	})
	at := time.Now().Truncate(time.Second)
	usage := downloadstorage.Usage{Dir: "/srv/a", MeasuredAt: at, Bytes: 5_400_000_000, FSTotalBytes: 2_000_000_000_000}
	untracked := storageSampleUntracked{Files: 6, Bytes: 5_399_999_999, At: at}
	if err := repo.UpsertStorageSample(ctx, 0, reporter, usage, &untracked); err != nil {
		t.Fatalf("record sample with untracked bytes past int4: %v", err)
	}
	// A measurement without reconciliation keeps the last untracked counts.
	usage.Bytes = 6_000_000_000
	if err := repo.UpsertStorageSample(ctx, 0, reporter, usage, nil); err != nil {
		t.Fatal(err)
	}
	samples, err := repo.storageSamples(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range samples[0] {
		if s.reporter != reporter {
			continue
		}
		if s.usage.Bytes != 6_000_000_000 || s.untrackedFiles != 6 || s.untrackedBytes != 5_399_999_999 || s.reconciledAt == nil {
			t.Fatalf("sample = %+v", s)
		}
		return
	}
	t.Fatal("sample not stored")
}
