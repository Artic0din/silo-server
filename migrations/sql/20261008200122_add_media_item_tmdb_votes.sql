-- +goose NO TRANSACTION

-- +goose Up
-- TMDB's vote count and the average those votes give (0-10), kept together on
-- media_items from the item's 'tmdb' row in media_item_rating_sources.
-- Discovery rows require a minimum count and rank by a vote-weighted rating
-- built from this pair; an index can only cover that ranking when the pair
-- lives on media_items. The pair is kept apart from rating_tmdb, which a
-- scheduled refresh never overwrites, so a stale rating is never weighted by a
-- newer count. Both are NULL when no count is known.
--
-- Nullable additions avoid a table rewrite under ACCESS EXCLUSIVE.
ALTER TABLE public.media_items
    ADD COLUMN IF NOT EXISTS tmdb_vote_count BIGINT,
    ADD COLUMN IF NOT EXISTS tmdb_vote_average DOUBLE PRECISION;

-- A trigger keeps the pair in step with every write of a 'tmdb' rating source,
-- in the same statement, so no writer can leave it stale. A missing source or
-- a zero count clears both. It is installed before the backfill so writes made
-- during the backfill are covered.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.sync_media_item_tmdb_votes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    target text;
    vote_count bigint;
    vote_average double precision;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.source <> 'tmdb' THEN
            RETURN NULL;
        END IF;
        target := OLD.content_id;
    ELSE
        IF NEW.source <> 'tmdb' THEN
            RETURN NULL;
        END IF;
        target := NEW.content_id;
        IF NEW.votes > 0 THEN
            vote_count := NEW.votes;
            vote_average := NEW.score / 10;
        END IF;
    END IF;
    -- Check before writing: an UPDATE with nothing to change still fires the
    -- statement-level triggers on media_items, once per source row, which a
    -- bulk delete of items would pay for every cascaded row.
    PERFORM 1 FROM public.media_items
    WHERE content_id = target
      AND (tmdb_vote_count, tmdb_vote_average) IS DISTINCT FROM (vote_count, vote_average);
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    UPDATE public.media_items
    SET tmdb_vote_count = vote_count,
        tmdb_vote_average = vote_average
    WHERE content_id = target;
    RETURN NULL;
END;
$$;
-- +goose StatementEnd

CREATE OR REPLACE TRIGGER trg_media_item_rating_sources_tmdb_votes
AFTER INSERT OR UPDATE OR DELETE ON public.media_item_rating_sources
FOR EACH ROW EXECUTE FUNCTION public.sync_media_item_tmdb_votes();

-- Fill the pair from the counts already stored (MDBList sends TMDB's). Commit
-- each batch to bound row-lock retention and WAL bursts; a resumed migration
-- skips rows already filled. Each batch locks its source rows first, in the
-- trigger's order (source, then item), so a concurrent write to a source waits
-- or is waited for and the pair never takes a value the source no longer has.
-- Called as a top-level statement because transaction control is prohibited
-- in a DO block.
-- +goose StatementBegin
CREATE OR REPLACE PROCEDURE public.backfill_media_item_tmdb_votes()
LANGUAGE plpgsql
AS $$
DECLARE
    last_id text;
    batch_ids text[];
BEGIN
    LOOP
        IF last_id IS NULL THEN
            SELECT array_agg(content_id ORDER BY content_id) INTO batch_ids
            FROM (
                SELECT content_id FROM public.media_item_rating_sources
                WHERE source = 'tmdb' AND votes > 0
                ORDER BY content_id LIMIT 1000
            ) batch;
        ELSE
            SELECT array_agg(content_id ORDER BY content_id) INTO batch_ids
            FROM (
                SELECT content_id FROM public.media_item_rating_sources
                WHERE source = 'tmdb' AND votes > 0 AND content_id > last_id
                ORDER BY content_id LIMIT 1000
            ) batch;
        END IF;
        EXIT WHEN batch_ids IS NULL;
        UPDATE public.media_items mi
        SET tmdb_vote_count = s.votes,
            tmdb_vote_average = s.score / 10
        FROM (
            SELECT content_id, score, votes
            FROM public.media_item_rating_sources
            WHERE source = 'tmdb' AND votes > 0 AND content_id = ANY(batch_ids)
            FOR SHARE
        ) s
        WHERE s.content_id = mi.content_id
          AND mi.tmdb_vote_count IS NULL;
        last_id := batch_ids[array_length(batch_ids, 1)];
        COMMIT;
    END LOOP;
END;
$$;
-- +goose StatementEnd
CALL public.backfill_media_item_tmdb_votes();
DROP PROCEDURE public.backfill_media_item_tmdb_votes();

-- +goose Down
DROP TRIGGER IF EXISTS trg_media_item_rating_sources_tmdb_votes ON public.media_item_rating_sources;
DROP FUNCTION IF EXISTS public.sync_media_item_tmdb_votes();
ALTER TABLE public.media_items
    DROP COLUMN IF EXISTS tmdb_vote_average,
    DROP COLUMN IF EXISTS tmdb_vote_count;
