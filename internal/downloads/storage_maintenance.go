package downloads

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/Silo-Server/silo-server/internal/config"
	"github.com/Silo-Server/silo-server/internal/downloadprepare"
	"github.com/Silo-Server/silo-server/internal/downloadstorage"
	"github.com/Silo-Server/silo-server/internal/nodepool"
)

const (
	// storageMaintenanceInterval spaces cache expiry and budget enforcement.
	// Prepared files come and go on the scale of minutes; checking every 30 s
	// task tick would only re-read the same rows.
	storageMaintenanceInterval = 5 * time.Minute
	// storageReconcileInterval spaces the directory listings that find files
	// no row accounts for. A listing reads every file at a location.
	storageReconcileInterval = time.Hour
	// untrackedMinAge keeps a file out of the untracked count until it is old
	// enough that no encode can still be writing or committing it.
	untrackedMinAge = time.Hour
	// expireBatchLimit bounds one query's candidates; a pass keeps paging until
	// it has freed what it needs or runs out.
	expireBatchLimit = 200
	// expirePassBudget bounds one maintenance pass, so a large backlog after an
	// upgrade drains over several ticks instead of stalling the task.
	expirePassBudget = 30 * time.Second
	// revokedDownloadRetention is how long a revoked row waits for its device to
	// confirm the local copy is gone before it is pruned anyway.
	revokedDownloadRetention = 90 * 24 * time.Hour
	// staleDeviceAge is when a device that still has downloads waiting is
	// flagged to an administrator as not seen recently.
	staleDeviceAge = 14 * 24 * time.Hour
)

// StorageNodes lists transcode nodes with their stored health sample, which
// carries each node's measurement of its artifact directory.
type StorageNodes interface {
	List(ctx context.Context) ([]*nodepool.Node, error)
}

// SetStorageNodes supplies the node list storage maintenance reads budgets,
// measurements, and node addresses from.
func (m *ArtifactManager) SetStorageNodes(nodes StorageNodes) {
	m.mu.Lock()
	m.storageNodes = nodes
	m.mu.Unlock()
}

func (m *ArtifactManager) nodeSource() StorageNodes {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.storageNodes
}

// cacheTTL is how long a prepared file nothing is waiting on stays after its
// last use. It never drops below the grace that protects a download create
// linking a ready file.
func (m *ArtifactManager) cacheTTL() time.Duration {
	return max(time.Duration(m.cacheHours())*time.Hour, missingArtifactRetireGrace)
}

// cacheHours is download.artifact_cache_hours, or its default without a
// live configuration.
func (m *ArtifactManager) cacheHours() int {
	if m.liveCfg == nil {
		return config.DefaultDownloadArtifactCacheHours
	}
	return m.downloadConfig().ArtifactCacheHours
}

func (m *ArtifactManager) diskCeilingPercent() int {
	if p := m.downloadConfig().ArtifactDiskCeilingPercent; p > 0 {
		return p
	}
	return config.DefaultDownloadArtifactDiskCeilingPercent
}

// transcodeDir is the API server's own transcode working directory.
func (m *ArtifactManager) transcodeDir() string {
	if m.liveCfg != nil {
		if c := m.liveCfg(); c != nil {
			return c.Playback.TranscodeDir
		}
	}
	return ""
}

// ServerStorageUsage is this replica's latest measurement of the API server's
// artifact directory. The second result is false until one has finished.
func (m *ArtifactManager) ServerStorageUsage() (downloadstorage.Usage, bool) {
	if m == nil || m.serverProber == nil {
		return downloadstorage.Usage{}, false
	}
	return m.serverProber.Current(m.artifactDir(), m.transcodeDir())
}

// storageLocation is one place prepared files live, as maintenance sees it.
type storageLocation struct {
	NodeID int // 0 is the API server
	Name   string
	Budget int64 // 0 means none
	Usage  *downloadstorage.Usage
	// Node is the node row, nil for the server.
	Node *nodepool.Node
}

func (l storageLocation) key() string { return locationKeyForNode(l.NodeID) }

// nodeArtifactUsage reads the artifacts block a node reported on its last
// health check.
func nodeArtifactUsage(n *nodepool.Node) *downloadstorage.Usage {
	if n == nil || len(n.LastStats) == 0 {
		return nil
	}
	var view struct {
		Artifacts *downloadstorage.Usage `json:"artifacts"`
	}
	if err := json.Unmarshal(n.LastStats, &view); err != nil {
		return nil
	}
	return view.Artifacts
}

// nodeBudget is a node's effective prepared-file budget.
func nodeBudget(n *nodepool.Node, defaultBudget int64) int64 {
	if n != nil && n.DownloadArtifactMaxBytesOverride != nil {
		return *n.DownloadArtifactMaxBytesOverride
	}
	return defaultBudget
}

// storageLocations lists the server and every transcode node, plus any other
// node that still holds ready files.
func (m *ArtifactManager) storageLocations(ctx context.Context, readyByNode map[int]int64) ([]storageLocation, error) {
	cfg := m.downloadConfig()
	locations := []storageLocation{{NodeID: 0, Name: serverLocationName, Budget: cfg.ArtifactMaxBytes}}
	if usage, ok := m.ServerStorageUsage(); ok {
		locations[0].Usage = &usage
	}
	source := m.nodeSource()
	if source == nil {
		return locations, nil
	}
	nodes, err := source.List(ctx)
	if err != nil {
		return locations, err
	}
	for _, n := range nodes {
		if n.Type != nodepool.NodeTypeTranscode && readyByNode[n.ID] == 0 {
			continue
		}
		locations = append(locations, storageLocation{
			NodeID: n.ID, Name: n.Name, Budget: nodeBudget(n, cfg.ArtifactMaxBytes),
			Usage: nodeArtifactUsage(n), Node: n,
		})
	}
	return locations, nil
}

// maintainStorage measures the server's directory, expires cached files past
// their cache period, enforces each location's budget and disk ceiling, and
// reconciles directories against the database. force skips the interval
// gates (an administrator asked for clean-up now); only limits enforcement to
// one location ("" for all). It returns the bytes it freed.
func (m *ArtifactManager) maintainStorage(ctx context.Context, force bool, only string) int64 {
	if m.repo == nil {
		return 0
	}
	m.recordServerSample(ctx)
	if !force && !m.maintenanceDueEvery(&m.lastStorageSweep, storageMaintenanceInterval) {
		return 0
	}
	var freed int64
	ran, err := m.repo.WithMaintenanceLock(ctx, func(ctx context.Context) error {
		freed = m.enforceStorage(ctx, only)
		return nil
	})
	if err != nil {
		slog.WarnContext(ctx, "download storage maintenance failed", "component", "downloads", "error", err)
	} else if !ran && force {
		slog.InfoContext(ctx, "download storage maintenance is running on another replica", "component", "downloads")
	}
	if force || m.maintenanceDueEvery(&m.lastReconcile, storageReconcileInterval) {
		m.reconcileStorage(ctx, only)
	}
	if freed > 0 {
		m.cleanupRemoteOrphans(ctx)
		m.notifyStorageChanged(ctx)
	}
	return freed
}

// maintenanceDueEvery is maintenanceDue with its own interval.
func (m *ArtifactManager) maintenanceDueEvery(last *time.Time, every time.Duration) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !last.IsZero() && time.Since(*last) < every {
		return false
	}
	*last = time.Now()
	return true
}

// recordServerSample stores this replica's measurement of the server's
// directory whenever a new one has finished, so every replica serves it.
func (m *ArtifactManager) recordServerSample(ctx context.Context) {
	usage, ok := m.ServerStorageUsage()
	if !ok {
		return
	}
	m.mu.Lock()
	fresh := usage.MeasuredAt.After(m.lastServerSampleAt)
	if fresh {
		m.lastServerSampleAt = usage.MeasuredAt
	}
	m.mu.Unlock()
	if !fresh {
		return
	}
	if err := m.repo.UpsertStorageSample(ctx, 0, m.owner, usage, nil); err != nil {
		slog.WarnContext(ctx, "recording server download storage sample failed", "component", "downloads", "error", err)
	}
}

// enforceStorage runs cache expiry, then budgets and ceilings, at every
// location (or the one named). It runs under the maintenance lock.
func (m *ArtifactManager) enforceStorage(ctx context.Context, only string) int64 {
	ctx, cancel := context.WithTimeout(ctx, expirePassBudget)
	defer cancel()
	readyByNode, err := m.repo.ReadyBytesByLocation(ctx)
	if err != nil {
		slog.WarnContext(ctx, "reading prepared-file totals failed", "component", "downloads", "error", err)
		return 0
	}
	locations, err := m.storageLocations(ctx, readyByNode)
	if err != nil {
		slog.WarnContext(ctx, "listing download storage locations failed", "component", "downloads", "error", err)
	}
	var freed int64
	cacheCutoff := time.Now().Add(-m.cacheTTL())
	graceCutoff := time.Now().Add(-missingArtifactRetireGrace)
	for _, loc := range locations {
		if only != "" && loc.key() != only {
			continue
		}
		// Past their cache period: nothing waits on them and nobody used them.
		expired := m.expireAtLocation(ctx, loc, cacheCutoff, -1, StorageReasonCacheExpired)
		freed += expired
		ready := readyByNode[loc.NodeID] - expired
		need, reason := int64(0), ""
		if loc.Budget > 0 && ready > loc.Budget {
			need, reason = ready-loc.Budget, StorageReasonBudget
		}
		if over := m.overCeiling(loc, expired); over > need {
			need, reason = over, StorageReasonDiskCeiling
		}
		full := false
		if need > 0 {
			got := m.expireAtLocation(ctx, loc, graceCutoff, need, reason)
			freed += got
			full = got < need
			if reason == StorageReasonDiskCeiling {
				m.mu.Lock()
				if m.lastCeilingEviction == nil {
					m.lastCeilingEviction = make(map[int]time.Time)
				}
				m.lastCeilingEviction[loc.NodeID] = time.Now()
				m.mu.Unlock()
			}
		}
		if loc.NodeID > 0 {
			m.setNodeStorageFull(loc.NodeID, full)
		}
	}
	m.publishStorageGauges(ctx, locations)
	return freed
}

// publishStorageGauges refreshes the storage metrics after a pass.
func (m *ArtifactManager) publishStorageGauges(ctx context.Context, locations []storageLocation) {
	totals, err := m.repo.storageTotalsByLocation(ctx, staleDeviceAge)
	if err != nil {
		return
	}
	samples, err := m.repo.storageSamples(ctx)
	if err != nil {
		return
	}
	for _, loc := range locations {
		var untracked int64
		if rows := samples[loc.NodeID]; len(rows) > 0 {
			untracked = rows[0].untrackedBytes
		}
		recordStorageGauges(loc, totals[loc.NodeID], untracked)
	}
}

// overCeiling is how many bytes a location must free to get back under the
// disk ceiling, judged from its latest measurement less what was just freed.
// A measurement taken before the last ceiling eviction still counts the bytes
// that eviction removed, so it is not acted on twice.
func (m *ArtifactManager) overCeiling(loc storageLocation, justFreed int64) int64 {
	u := loc.Usage
	if u == nil || u.Stale || u.Error != "" || u.FSTotalBytes <= 0 {
		return 0
	}
	m.mu.Lock()
	last := m.lastCeilingEviction[loc.NodeID]
	m.mu.Unlock()
	if !last.IsZero() && !u.MeasuredAt.After(last) {
		return 0
	}
	limit := u.FSTotalBytes / 100 * int64(m.diskCeilingPercent())
	return u.FSUsedBytes - justFreed - limit
}

// expireAtLocation expires least recently used files at one location that no
// in-flight download needs and nothing used since cutoff, until need bytes are
// freed (need < 0 means every such file). It returns the bytes freed.
func (m *ArtifactManager) expireAtLocation(ctx context.Context, loc storageLocation, cutoff time.Time, need int64, reason string) int64 {
	var freed int64
	batch := newStorageBatchID()
	for need < 0 || freed < need {
		candidates, err := m.repo.ListExpirable(ctx, loc.NodeID, cutoff, expireBatchLimit)
		if err != nil {
			if ctx.Err() == nil {
				slog.WarnContext(ctx, "listing expirable prepared files failed", "component", "downloads", "location", loc.key(), "error", err)
			}
			return freed
		}
		progressed := false
		for _, a := range candidates {
			if need >= 0 && freed >= need {
				break
			}
			if m.expireArtifact(ctx, a, reason, batch, nil) {
				freed += a.FileSize
				progressed = true
			}
		}
		if len(candidates) < expireBatchLimit || !progressed {
			break
		}
	}
	return freed
}

// expireArtifact expires one ready file and removes its bytes: a local file
// directly, a node file through the remote cleanup queue the expiry wrote.
// It returns false when the row changed first.
func (m *ArtifactManager) expireArtifact(ctx context.Context, a *Artifact, reason, batch string, actor *int) bool {
	applied, err := m.repo.ExpireReady(ctx, a, missingArtifactRetireGrace)
	if err != nil {
		slog.WarnContext(ctx, "expiring prepared file failed", "component", "downloads", "artifact_id", a.ID, "error", err)
		return false
	}
	if !applied {
		return false
	}
	// A failed local removal leaves a file no ready row names, which the next
	// reconciliation reports as untracked.
	m.removeExpiredLocalBytes(ctx, a)
	recordStorageFreed(locationKeyForNode(a.OriginNodeID), reason, a.FileSize)
	if err := m.repo.RecordArtifactEvent(ctx, batch, reason, locationKeyForNode(a.OriginNodeID), a.ID, a.FileSize, actor, ""); err != nil {
		slog.WarnContext(ctx, "recording prepared-file clean-up failed", "component", "downloads", "artifact_id", a.ID, "error", err)
	}
	slog.InfoContext(ctx, "expired prepared download file", "component", "downloads", "artifact_id", a.ID, "reason", reason, "bytes", a.FileSize)
	return true
}

// setNodeStorageFull records whether a node is over its budget or ceiling with
// nothing left to free, so placement stops sending it new preparations.
func (m *ArtifactManager) setNodeStorageFull(nodeID int, full bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if full {
		if m.storageFull == nil {
			m.storageFull = make(map[int]bool)
		}
		m.storageFull[nodeID] = true
	} else {
		delete(m.storageFull, nodeID)
	}
}

// NodeStorageFull reports whether the last maintenance pass found a node over
// its storage budget or disk ceiling with nothing left to free.
func (m *ArtifactManager) NodeStorageFull(nodeID int) bool {
	if m == nil {
		return false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.storageFull[nodeID]
}

// findUntracked returns the files in a listing that no row accounts for and
// that are old enough that no encode can still be writing or committing them.
// A partial file is untracked once nothing has written to it for that long:
// an encode in progress keeps its .part file's modification time current.
func findUntracked(files []downloadstorage.File, tracked map[string]bool, now time.Time) []downloadstorage.File {
	var out []downloadstorage.File
	for _, f := range files {
		if now.Sub(f.ModTime) < untrackedMinAge {
			continue
		}
		switch f.Kind {
		case downloadstorage.KindComplete:
			if tracked[f.Name] {
				continue
			}
		case downloadstorage.KindPartial:
			// Old enough means nothing is writing it: untracked.
		default:
			// A receipt belongs to the finished file it describes.
			if base, _, ok := strings.Cut(f.Name, ".mp4"); ok && tracked[base+".mp4"] {
				continue
			}
		}
		out = append(out, f)
	}
	return out
}

func sumUntracked(files []downloadstorage.File) storageSampleUntracked {
	out := storageSampleUntracked{Files: len(files), At: time.Now()}
	for _, f := range files {
		out.Bytes += f.Bytes
	}
	return out
}

// reconcileStorage lists the server's directory and every enabled transcode
// node's, and records how many untracked files each holds.
func (m *ArtifactManager) reconcileStorage(ctx context.Context, only string) {
	if only == "" || only == LocationServer {
		if _, err := m.reconcileServer(ctx, false, nil); err != nil {
			slog.WarnContext(ctx, "reconciling server download storage failed", "component", "downloads", "error", err)
		}
	}
	source := m.nodeSource()
	if source == nil {
		return
	}
	nodes, err := source.List(ctx)
	if err != nil {
		slog.WarnContext(ctx, "listing nodes for download storage reconciliation failed", "component", "downloads", "error", err)
		return
	}
	for _, n := range nodes {
		if n.Type != nodepool.NodeTypeTranscode || !n.Enabled || (only != "" && only != NodeLocationKey(n.ID)) {
			continue
		}
		if _, err := m.reconcileNode(ctx, n, false, nil); err != nil && !errors.Is(err, downloadprepare.ErrArtifactListingUnsupported) {
			slog.WarnContext(ctx, "reconciling node download storage failed", "component", "downloads", "node", n.Name, "error", err)
		}
	}
}

// reconcileServer lists the server's artifact directory and records its
// untracked files; with remove it also deletes them and returns what it
// removed.
func (m *ArtifactManager) reconcileServer(ctx context.Context, remove bool, actor *int) (storageSampleUntracked, error) {
	dir := m.artifactDir()
	listing := downloadstorage.Inspect(dir, m.transcodeDir(), time.Now())
	if listing.Usage.Error != "" && len(listing.Files) == 0 {
		return storageSampleUntracked{}, errors.New(listing.Usage.Error)
	}
	tracked, err := m.repo.trackedArtifactFiles(ctx, 0)
	if err != nil {
		return storageSampleUntracked{}, err
	}
	untracked := findUntracked(listing.Files, tracked, time.Now())
	if remove {
		var removed, left []downloadstorage.File
		for _, f := range untracked {
			if err := os.Remove(filepath.Join(dir, f.Name)); err != nil && !errors.Is(err, os.ErrNotExist) {
				slog.WarnContext(ctx, "removing untracked prepared file failed", "component", "downloads", "file", f.Name, "error", err)
				left = append(left, f)
				continue
			}
			removed = append(removed, f)
		}
		summary := sumUntracked(removed)
		m.recordUntrackedRemoval(ctx, LocationServer, summary, actor)
		if m.serverProber != nil {
			m.serverProber.Refresh(dir, m.transcodeDir())
		}
		remaining := sumUntracked(left)
		return summary, m.repo.UpsertStorageSample(ctx, 0, m.owner, listing.Usage, &remaining)
	}
	summary := sumUntracked(untracked)
	return summary, m.repo.UpsertStorageSample(ctx, 0, m.owner, listing.Usage, &summary)
}

// reconcileNode lists one node's artifact directory and records its untracked
// files; with remove it also deletes them through the node's delete route.
func (m *ArtifactManager) reconcileNode(ctx context.Context, n *nodepool.Node, remove bool, actor *int) (storageSampleUntracked, error) {
	secret := m.nodeSecret()
	if secret == "" {
		return storageSampleUntracked{}, errors.New("node credentials unavailable")
	}
	listCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	client := downloadprepare.HTTPPreparer{}
	listing, err := client.ListArtifacts(listCtx, n.URL, secret)
	if err != nil {
		return storageSampleUntracked{}, err
	}
	tracked, err := m.repo.trackedArtifactFiles(ctx, n.ID)
	if err != nil {
		return storageSampleUntracked{}, err
	}
	untracked := findUntracked(listing.Files, tracked, time.Now())
	if !remove {
		summary := sumUntracked(untracked)
		return summary, m.repo.UpsertStorageSample(ctx, n.ID, "", listing.Usage, &summary)
	}
	var removed, left []downloadstorage.File
	deleted := make(map[string]bool)
	for _, f := range untracked {
		id := nodeArtifactIDFromFile(f.Name)
		if !downloadprepare.ValidArtifactID(id) {
			left = append(left, f)
			continue
		}
		if !deleted[id] {
			// The node's delete removes the file, its partial and its receipt.
			if err := client.Delete(ctx, n.URL, secret, id); err != nil {
				slog.WarnContext(ctx, "removing untracked node file failed", "component", "downloads", "node", n.Name, "file", f.Name, "error", err)
				left = append(left, f)
				continue
			}
			deleted[id] = true
		}
		removed = append(removed, f)
	}
	summary := sumUntracked(removed)
	m.recordUntrackedRemoval(ctx, NodeLocationKey(n.ID), summary, actor)
	remaining := sumUntracked(left)
	return summary, m.repo.UpsertStorageSample(ctx, n.ID, "", listing.Usage, &remaining)
}

// nodeArtifactIDFromFile recovers the node artifact id a file belongs to:
// <id>.mp4, <id>.mp4.part, <id>.mp4.receipt.json[.<temp>].
func nodeArtifactIDFromFile(name string) string {
	id, _, _ := strings.Cut(name, ".mp4")
	return id
}

func (m *ArtifactManager) recordUntrackedRemoval(ctx context.Context, location string, summary storageSampleUntracked, actor *int) {
	if summary.Files == 0 {
		return
	}
	recordStorageFreed(location, StorageReasonUntracked, summary.Bytes)
	detail := "1 file"
	if summary.Files != 1 {
		detail = strconv.Itoa(summary.Files) + " files"
	}
	if err := m.repo.RecordFileEvent(ctx, newStorageBatchID(), StorageReasonUntracked, location, summary.Bytes, actor, detail); err != nil {
		slog.WarnContext(ctx, "recording untracked file removal failed", "component", "downloads", "error", err)
	}
}

func (m *ArtifactManager) nodeSecret() string {
	if m.liveCfg != nil {
		if cfg := m.liveCfg(); cfg != nil {
			return strings.TrimSpace(cfg.Auth.JWTSecret)
		}
	}
	return ""
}

// SetStorageNotifier wires a callback that announces a storage change (files
// expired or removed) to administrators watching the storage view.
func (m *ArtifactManager) SetStorageNotifier(notify func(context.Context)) {
	m.mu.Lock()
	m.storageNotify = notify
	m.mu.Unlock()
}

func (m *ArtifactManager) notifyStorageChanged(ctx context.Context) {
	m.mu.Lock()
	notify := m.storageNotify
	m.mu.Unlock()
	if notify != nil {
		notify(ctx)
	}
}

// recordMissing records that a prepared file's bytes were found gone (a node
// lost them, or the directory was wiped) in the clean-up history.
func (m *ArtifactManager) recordMissing(ctx context.Context, a *Artifact) {
	if m.repo == nil || a == nil {
		return
	}
	if err := m.repo.RecordArtifactEvent(ctx, newStorageBatchID(), StorageReasonMissing, locationKeyForNode(a.OriginNodeID), a.ID, a.FileSize, nil, ""); err != nil {
		slog.WarnContext(ctx, "recording missing prepared file failed", "component", "downloads", "artifact_id", a.ID, "error", err)
	}
}
