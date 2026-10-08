-- +goose Up
-- TMDB's vote count and the average those votes give (0-10), copied together
-- from the item's 'tmdb' row in media_item_rating_sources whenever rating
-- sources are written (catalog.RatingSourceRepository). Discovery rows require
-- a minimum count and rank by a vote-weighted rating built from this pair; an
-- index can only cover that ranking when the pair lives on media_items. The
-- pair is kept apart from rating_tmdb, which a scheduled refresh never
-- overwrites, so a stale rating is never weighted by a newer count. Both are
-- NULL when no count is known.
ALTER TABLE media_items
    ADD COLUMN IF NOT EXISTS tmdb_vote_count BIGINT,
    ADD COLUMN IF NOT EXISTS tmdb_vote_average DOUBLE PRECISION;

-- Fill the pair from the counts already stored (MDBList sends TMDB's).
-- No row-level trigger on media_items watches these columns.
UPDATE media_items mi
SET tmdb_vote_count = s.votes,
    tmdb_vote_average = s.score / 10
FROM media_item_rating_sources s
WHERE s.content_id = mi.content_id
  AND s.source = 'tmdb'
  AND s.votes > 0;

-- +goose Down
ALTER TABLE media_items
    DROP COLUMN IF EXISTS tmdb_vote_average,
    DROP COLUMN IF EXISTS tmdb_vote_count;
