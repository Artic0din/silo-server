package downloads

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"time"
)

// adminDeleteGrace protects a prepared file a download create is linking at
// this moment from an administrator's delete. It is shorter than the cache
// grace: the link takes milliseconds, and the administrator asked for this file.
const adminDeleteGrace = time.Minute

// Outcomes of deleting one prepared file.
const (
	StorageDeleteDeleted  = "deleted"   // the file is gone; finished devices keep their copies
	StorageDeleteRequeued = "requeued"  // the file was in use: deleted, and queued to be prepared again
	StorageDeleteInUse    = "in_use"    // refused: a download is waiting on or fetching it
	StorageDeleteNotFound = "not_found" // no such prepared file
	StorageDeleteNotReady = "not_ready" // still being prepared, failed, or already expired
)

// StorageDeleteResult is one prepared file's outcome.
type StorageDeleteResult struct {
	ArtifactID string
	Outcome    string
	Bytes      int64
}

// DeleteStorageFiles deletes prepared files for an administrator. A file a
// download is still waiting on or fetching is refused unless includeInUse is
// set; then its bytes are deleted and it is queued to be prepared again, so
// those downloads wait for the new copy. Finished devices keep their copies
// either way.
func (m *ArtifactManager) DeleteStorageFiles(ctx context.Context, ids []string, includeInUse bool, actor int) ([]StorageDeleteResult, error) {
	if m == nil || m.repo == nil {
		return nil, ErrFormatUnavailable
	}
	batch := newStorageBatchID()
	results := make([]StorageDeleteResult, 0, len(ids))
	freed := false
	for _, id := range uniqueIDs(ids) {
		a, err := m.repo.GetByID(ctx, id)
		if errors.Is(err, ErrNotFound) {
			results = append(results, StorageDeleteResult{ArtifactID: id, Outcome: StorageDeleteNotFound})
			continue
		}
		if err != nil {
			return results, err
		}
		if !artifactReady(a) {
			results = append(results, StorageDeleteResult{ArtifactID: id, Outcome: StorageDeleteNotReady})
			continue
		}
		applied, err := m.repo.ExpireReady(ctx, a, adminDeleteGrace)
		if err != nil {
			return results, err
		}
		if applied {
			m.removeExpiredLocalBytes(ctx, a)
			m.recordAdminDelete(ctx, batch, a, actor, "")
			results = append(results, StorageDeleteResult{ArtifactID: id, Outcome: StorageDeleteDeleted, Bytes: a.FileSize})
			freed = true
			continue
		}
		if !includeInUse {
			results = append(results, StorageDeleteResult{ArtifactID: id, Outcome: StorageDeleteInUse})
			continue
		}
		outcome, err := m.deleteInUse(ctx, a)
		if err != nil {
			return results, err
		}
		if outcome != StorageDeleteNotReady {
			m.recordAdminDelete(ctx, batch, a, actor, "prepared again for waiting downloads")
			freed = true
		}
		results = append(results, StorageDeleteResult{ArtifactID: id, Outcome: outcome, Bytes: a.FileSize})
	}
	if freed {
		m.cleanupRemoteOrphans(ctx)
		m.notifyStorageChanged(ctx)
	}
	return results, nil
}

// deleteInUse deletes the bytes of a file downloads still need and queues it
// to be prepared again, through the same transitions missing-output recovery
// uses: the waiting downloads return to preparing in that transaction.
func (m *ArtifactManager) deleteInUse(ctx context.Context, a *Artifact) (string, error) {
	if a.OriginArtifactID != "" {
		result, err := m.requeueRemoteArtifactNow(ctx, a, "deleted by an administrator")
		if err != nil {
			return "", err
		}
		return recoveryOutcome(result), nil
	}
	if a.OutputPath != "" {
		for _, path := range []string{a.OutputPath, a.OutputPath + ".part"} {
			if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
				return "", fmt.Errorf("removing prepared file: %w", err)
			}
		}
	}
	linked, result, err := m.repo.RecoverMissing(ctx, a.ID, 0)
	if err != nil {
		return "", err
	}
	if result == artifactRequeued {
		for _, d := range linked {
			m.publish(ctx, d)
		}
		m.notifyPreparationChanged(ctx, a.ID)
		m.triggerDrain()
	}
	return recoveryOutcome(result), nil
}

func recoveryOutcome(result artifactRecovery) string {
	switch result {
	case artifactRequeued:
		return StorageDeleteRequeued
	case artifactRetired:
		return StorageDeleteDeleted
	default:
		return StorageDeleteNotReady
	}
}

// removeExpiredLocalBytes deletes an expired server file. A node file goes
// through the remote cleanup queue its expiry wrote.
func (m *ArtifactManager) removeExpiredLocalBytes(ctx context.Context, a *Artifact) {
	if a.OriginArtifactID != "" || a.OutputPath == "" {
		return
	}
	for _, path := range []string{a.OutputPath, a.OutputPath + ".part"} {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			slog.WarnContext(ctx, "removing deleted prepared file failed", "component", "downloads", "artifact_id", a.ID, "error", err)
		}
	}
}

func (m *ArtifactManager) recordAdminDelete(ctx context.Context, batch string, a *Artifact, actor int, detail string) {
	recordStorageFreed(locationKeyForNode(a.OriginNodeID), StorageReasonAdminDelete, a.FileSize)
	if err := m.repo.RecordArtifactEvent(ctx, batch, StorageReasonAdminDelete, locationKeyForNode(a.OriginNodeID), a.ID, a.FileSize, &actor, detail); err != nil {
		slog.WarnContext(ctx, "recording prepared-file delete failed", "component", "downloads", "artifact_id", a.ID, "error", err)
	}
}

// ErrStorageLocationNotFound reports a location key that names no location.
var ErrStorageLocationNotFound = errors.New("storage location not found")

// DeleteUntrackedFiles lists one location's directory now and deletes the
// files no row accounts for. It returns how many files and bytes it removed.
func (m *ArtifactManager) DeleteUntrackedFiles(ctx context.Context, location string, actor int) (files int, bytes int64, err error) {
	if m == nil || m.repo == nil {
		return 0, 0, ErrFormatUnavailable
	}
	nodeID, ok := ParseLocationKey(location)
	if !ok {
		return 0, 0, ErrStorageLocationNotFound
	}
	var summary storageSampleUntracked
	if nodeID == 0 {
		summary, err = m.reconcileServer(ctx, true, &actor)
	} else {
		source := m.nodeSource()
		if source == nil {
			return 0, 0, ErrStorageLocationNotFound
		}
		nodes, listErr := source.List(ctx)
		if listErr != nil {
			return 0, 0, listErr
		}
		found := false
		for _, n := range nodes {
			if n.ID == nodeID {
				found = true
				summary, err = m.reconcileNode(ctx, n, true, &actor)
				break
			}
		}
		if !found {
			return 0, 0, ErrStorageLocationNotFound
		}
	}
	if summary.Files > 0 {
		m.notifyStorageChanged(ctx)
	}
	return summary.Files, summary.Bytes, err
}
