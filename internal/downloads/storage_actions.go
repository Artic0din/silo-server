package downloads

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/Silo-Server/silo-server/internal/nodepool"
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
			if err := removeExpiredLocalBytes(a); err != nil {
				return results, err
			}
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
// uses: the waiting downloads return to preparing in that transaction. A node
// file is queued for deletion in the same transaction. A server file is
// removed after the row has moved on, so a failed removal leaves a file no
// ready row names, never a ready row without its file.
func (m *ArtifactManager) deleteInUse(ctx context.Context, a *Artifact) (string, error) {
	var linked []*Download
	var result artifactRecovery
	var err error
	if a.OriginArtifactID != "" {
		linked, result, err = m.repo.RequeueRemote(ctx, a)
	} else {
		linked, result, err = m.repo.RecoverMissing(ctx, a.ID, 0)
	}
	if err != nil {
		return "", err
	}
	if result != artifactUnchanged && a.OriginArtifactID == "" && a.OutputPath != "" {
		// Only the finished file: a requeued job's next attempt writes its own
		// partial file beside it.
		if err := os.Remove(a.OutputPath); err != nil && !errors.Is(err, os.ErrNotExist) {
			return "", fmt.Errorf("removing prepared file: %w", err)
		}
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
// through the remote cleanup queue its expiry wrote. A file it cannot remove
// has no ready row left, so reconciliation reports it as untracked.
func removeExpiredLocalBytes(a *Artifact) error {
	if a.OriginArtifactID != "" || a.OutputPath == "" {
		return nil
	}
	for _, path := range []string{a.OutputPath, a.OutputPath + ".part"} {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("removing prepared file: %w", err)
		}
	}
	return nil
}

func (m *ArtifactManager) recordAdminDelete(ctx context.Context, batch string, a *Artifact, actor int, detail string) {
	recordStorageFreed(locationKeyForNode(a.OriginNodeID), StorageReasonAdminDelete, a.FileSize)
	if err := m.repo.RecordArtifactEvent(ctx, batch, StorageReasonAdminDelete, locationKeyForNode(a.OriginNodeID), a.ID, a.FileSize, &actor, detail); err != nil {
		slog.WarnContext(ctx, "recording prepared-file delete failed", "component", "downloads", "artifact_id", a.ID, "error", err)
	}
}

// ErrStorageLocationNotFound reports a location key that names no location.
var ErrStorageLocationNotFound = errors.New("storage location not found")

// ErrStorageListingUnavailable reports that a location's directory could not
// be listed: the node is unreachable, refused, or the directory unreadable.
var ErrStorageListingUnavailable = errors.New("storage location could not be listed")

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
		n, findErr := m.storageNode(ctx, nodeID)
		if findErr != nil {
			return 0, 0, findErr
		}
		summary, err = m.reconcileNode(ctx, n, true, &actor)
	}
	if summary.Files > 0 {
		m.notifyStorageChanged(ctx)
	}
	return summary.Files, summary.Bytes, err
}

// storageNode returns the node a location key names, or
// ErrStorageLocationNotFound.
func (m *ArtifactManager) storageNode(ctx context.Context, nodeID int) (*nodepool.Node, error) {
	source := m.nodeSource()
	if source == nil {
		return nil, ErrStorageLocationNotFound
	}
	nodes, err := source.List(ctx)
	if err != nil {
		return nil, err
	}
	for _, n := range nodes {
		if n.ID == nodeID {
			return n, nil
		}
	}
	return nil, ErrStorageLocationNotFound
}
