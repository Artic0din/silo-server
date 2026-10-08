# Discovery row ranking

The rating-led Home rows (Critically Acclaimed, Hidden Gems, Forgotten
Favorites, Short & Sweet and the mood rows) choose titles by TMDB rating. A
rating alone is not enough on a large library: thousands of titles carry a
perfect 10 from one to three votes, and they would fill every row. These rows
therefore require a minimum TMDB vote count and rank by a vote-weighted rating.

## Vote counts

Metadata providers report TMDB's score and vote count as the `tmdb` rating
source, which the server stores in `media_item_rating_sources`. The TMDB plugin
sends it from silo.tmdb 1.2.25; MDBList sends it too. Every write of an item's
rating sources (`catalog.RatingSourceRepository`, both `Upsert` and `Replace`)
copies that row's count and average (score / 10) onto
`media_items.tmdb_vote_count` and `tmdb_vote_average`, so the rows can filter
and index them without a join. A missing source or a zero count leaves both
NULL, and a NULL count never qualifies: an item without a known count is left
out until a refresh supplies one.

The pair always comes from one row. `rating_tmdb` is not used for ranking: a
scheduled refresh never overwrites it, so it can predate the stored count, and
a stale 10.0 weighted by a newer count would rank as acclaimed.

A scheduled refresh updates the rating sources the same provider stored
earlier, so counts keep moving after release; it never overwrites a source
another provider stored, so MDBList's bulk pass and the TMDB plugin cannot
undo each other's `tmdb` row.

## Weighted rating

Rows order by `(votes × average + 500 × 6.5) / (votes + 500)`: the average pulled
toward 6.5 as if 500 more people had voted 6.5. A title rated 10 by three people
ranks near 6.5; one rated 8.4 by 20,000 keeps about 8.4.

`catalog.TMDBWeightedRatingSQL` builds the expression and
`catalog.DiscoveryRatingOrder` the full order (`DESC NULLS LAST`, then
`content_id`). The partial index `idx_media_items_tmdb_weighted_rating` covers
that exact expression and order; queries require `tmdb_vote_count` so the
partial index applies. Change the expression, the index migration and
`TestTMDBWeightedRatingMatchesItsIndex` together.

Rows that sort by rating without requiring a vote count (format showcases,
anniversaries, seasonal keyword picks) use `catalog.RatedOrder`: the weighted
rating first, then titles with no known count by `rating_tmdb`, so a perfect
score from a few votes never leads them either.

## Minimums

`recipes.AcclaimedMinVotes` (500) applies to Critically Acclaimed and
`recipes.DiscoveryMinVotes` (100) to the other rows. Each row's own TMDB rating
floor (for example 8.0 for Critically Acclaimed) applies to the unweighted
`tmdb_vote_average`. Preset descriptions state both numbers, and the web's Add row preview
shows the description when nothing matches.

## Daily mix

Each row fetches five times its item limit by weighted rating and shows a
deterministic daily pick from that pool, in pool order
(`sections.dailyBestOf`). The pick is keyed by row kind (and mood) and the UTC
day, so every viewer of the same pool sees the same titles all day and every
node serves the same set. Shared rows sit in the resolved-list cache for up to
15 minutes, so a new day's mix appears within that window after midnight UTC.
