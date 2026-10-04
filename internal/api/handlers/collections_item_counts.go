package handlers

import (
	"context"
	"log/slog"
	"maps"
	"strings"

	"github.com/Silo-Server/silo-server/internal/catalog"
)

// visiblePersonalCollectionCounts answers how many items each personal
// collection shows the viewer, the total of its catalog view: its visible
// members, or its smart definition's matches, narrowed by its display filter.
// The stored item_count column is written only by import syncs, so it cannot
// answer this. A collection whose count cannot be read is absent from the
// result and keeps its stored count.
//
// Membership is read from the Postgres user store; callers skip stores that
// keep collections elsewhere.
func visiblePersonalCollectionCounts(ctx context.Context, executor *catalog.QueryExecutor, userID int, collections []catalog.PersonalCollectionDefinition, filter catalog.AccessFilter) map[string]int {
	counts := make(map[string]int, len(collections))
	if executor == nil || executor.Pool == nil || len(collections) == 0 {
		return counts
	}
	// Hand-picked and imported collections without a display filter share one
	// grouped count; dynamic definitions are deduplicated and batched.
	var memberIDs []string
	var dynamic []catalog.PersonalCollectionDefinition
	for _, c := range collections {
		if !catalog.IsLiveQueryType(c.CollectionType) && strings.TrimSpace(c.DisplayQueryDefinition) == "" {
			memberIDs = append(memberIDs, c.ID)
			continue
		}
		dynamic = append(dynamic, c)
	}
	if len(dynamic) > 0 {
		var err error
		counts, err = catalog.CountPersonalCollections(ctx, executor.Pool, userID, dynamic, filter)
		if err != nil {
			slog.WarnContext(ctx, "counting personal collections failed", "component", "collections", "error", err)
		}
	}
	if len(memberIDs) == 0 {
		return counts
	}
	visible, err := catalog.NewItemRepository(executor.Pool).CountVisiblePersonalCollectionMembers(ctx, userID, memberIDs, filter)
	if err != nil {
		slog.WarnContext(ctx, "counting personal collection members failed", "component", "collections", "error", err)
		return counts
	}
	for _, id := range memberIDs {
		counts[id] = visible[id]
	}
	return counts
}

// ownedCollectionDefinition is a personal collection's count definition and
// the profile that owns it.
type ownedCollectionDefinition struct {
	catalog.PersonalCollectionDefinition
	CreatorProfileID string
}

// ownerScopedCollectionCounts counts each collection as viewerProfileID sees
// it: under the viewer's filter, limited further to its owner's access when
// another profile owns it (catalog.PersonalCollectionFilter). Collections are
// counted per owner, so each owner is resolved once per call. A collection
// whose owner cannot be resolved has no count and is listed in unavailable;
// callers drop it rather than count it under the viewer's access alone.
func ownerScopedCollectionCounts(ctx context.Context, executor *catalog.QueryExecutor, owners catalog.PersonalCollectionAccess, userID int, viewerProfileID string, collections []ownedCollectionDefinition, viewer catalog.AccessFilter) (counts map[string]int, unavailable map[string]bool) {
	counts = make(map[string]int, len(collections))
	unavailable = make(map[string]bool)
	if executor == nil || executor.Pool == nil {
		return counts, unavailable
	}
	byOwner := make(map[string][]catalog.PersonalCollectionDefinition)
	var order []string
	for _, c := range collections {
		if _, ok := byOwner[c.CreatorProfileID]; !ok {
			order = append(order, c.CreatorProfileID)
		}
		byOwner[c.CreatorProfileID] = append(byOwner[c.CreatorProfileID], c.PersonalCollectionDefinition)
	}
	for _, owner := range order {
		definitions := byOwner[owner]
		filter, err := catalog.PersonalCollectionFilter(ctx, owners, viewer, userID, viewerProfileID, owner)
		if err != nil {
			slog.WarnContext(ctx, "resolving personal collection owner access failed", "component", "collections", "owner_profile_id", owner, "error", err)
			for _, d := range definitions {
				unavailable[d.ID] = true
			}
			continue
		}
		maps.Copy(counts, visiblePersonalCollectionCounts(ctx, executor, userID, definitions, filter))
	}
	return counts, unavailable
}
