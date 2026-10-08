-- +goose NO TRANSACTION

-- +goose Up
-- Discovery rows (Critically Acclaimed, Hidden Gems, Forgotten Favorites,
-- Short & Sweet, moods) rank titles by TMDB vote average pulled toward 6.5 by
-- their vote count: (votes × average + 500 × 6.5) / (votes + 500). This indexes that
-- exact expression, which catalog.TMDBWeightedRatingSQL must keep matching, so
-- a row walks the best-ranked titles instead of sorting every candidate.
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_index i ON i.indexrelid=c.oid
        WHERE n.nspname='public' AND c.relname='idx_media_items_tmdb_weighted_rating'
          AND NOT i.indisvalid
    ) THEN
        DROP INDEX public.idx_media_items_tmdb_weighted_rating;
    END IF;
END;
$$;
-- +goose StatementEnd

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_media_items_tmdb_weighted_rating
    ON public.media_items (((tmdb_vote_count * tmdb_vote_average + 3250) / (tmdb_vote_count + 500)) DESC NULLS LAST, content_id)
    WHERE tmdb_vote_count IS NOT NULL AND tmdb_vote_average IS NOT NULL;

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS public.idx_media_items_tmdb_weighted_rating;
