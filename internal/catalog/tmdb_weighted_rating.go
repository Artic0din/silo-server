package catalog

import (
	"context"
	"fmt"
)

// TMDBWeightedRatingSQL is the vote-weighted TMDB rating discovery rows rank
// by: the vote average pulled toward 6.5 as if 500 more people had voted 6.5,
// (votes × average + 500 × 6.5) / (votes + 500). A title rated 10 by three
// people ranks near 6.5; one rated 8.4 by 20,000 keeps about 8.4.
//
// Migration 20261008200123_index_tmdb_weighted_rating indexes this exact
// expression; change both together. Order by it DESC NULLS LAST, then
// content_id, and require tmdb_vote_count so the partial index applies.
func TMDBWeightedRatingSQL(alias string) string {
	return fmt.Sprintf("((%[1]s.tmdb_vote_count * %[1]s.tmdb_vote_average + 3250) / (%[1]s.tmdb_vote_count + 500))", alias)
}

// syncTMDBVotes copies the vote count and average (0-10) from the item's
// 'tmdb' rating source onto media_items, where discovery rows filter and index
// them. The pair always comes from one row, so a count is never applied to a
// rating from another refresh. A missing source or a zero count clears both.
func syncTMDBVotes(ctx context.Context, db itemExecer, contentID string) error {
	_, err := db.Exec(ctx, `
		UPDATE media_items
		SET tmdb_vote_count = v.votes, tmdb_vote_average = v.average
		FROM (
			SELECT s.votes, s.score / 10 AS average
			FROM (SELECT 1) AS one
			LEFT JOIN media_item_rating_sources s
				ON s.content_id = $1 AND s.source = 'tmdb' AND s.votes > 0
		) v
		WHERE media_items.content_id = $1
		  AND (media_items.tmdb_vote_count, media_items.tmdb_vote_average) IS DISTINCT FROM (v.votes, v.average)`, contentID)
	if err != nil {
		return fmt.Errorf("sync tmdb vote count: %w", err)
	}
	return nil
}
