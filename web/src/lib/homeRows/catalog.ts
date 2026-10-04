/**
 * Plain names and picker groups for Home row kinds. The stored `section_type`
 * values never change; this is display only.
 */
export type RowGroup = "keep" | "new" | "popular" | "picked" | "moods" | "collections";

export const ROW_GROUP_LABELS: Record<RowGroup, string> = {
  keep: "Keep watching",
  new: "What's new",
  popular: "Popular",
  picked: "Picked for you",
  moods: "Moods & themes",
  collections: "Collections & rules",
};

interface RowKind {
  group: RowGroup;
  label: string;
}

const ROW_KINDS: Record<string, RowKind> = {
  continue_watching: { group: "keep", label: "Continue watching" },
  next_up: { group: "keep", label: "On deck" },
  next_in_series: { group: "keep", label: "Next in series" },
  watchlist: { group: "keep", label: "Watchlist" },
  favorites: { group: "keep", label: "Favorites" },
  recently_added: { group: "new", label: "Recently added" },
  recently_released: { group: "new", label: "New releases" },
  new_to_library: { group: "new", label: "New this month" },
  returning_shows: { group: "new", label: "Returning shows" },
  trending_on_server: { group: "popular", label: "Trending on this server" },
  most_watched: { group: "popular", label: "Most watched" },
  trending_discover: { group: "popular", label: "Trending worldwide" },
  profile_activity_feed: { group: "popular", label: "What others just watched" },
  recommended_for_you: { group: "picked", label: "Recommended for you" },
  because_you_watched: { group: "picked", label: "Because you watched" },
  similar_users_liked: { group: "picked", label: "Profiles like you enjoyed" },
  taste_match: { group: "picked", label: "Top picks today" },
  mood_collection: { group: "moods", label: "Mood picks" },
  seasonal_themed: { group: "moods", label: "Seasonal picks" },
  editorial_spotlight: { group: "moods", label: "Spotlight" },
  format_showcase: { group: "moods", label: "4K & HDR showcase" },
  hidden_gems: { group: "moods", label: "Hidden gems" },
  critically_acclaimed: { group: "moods", label: "Critically acclaimed" },
  forgotten_favorites: { group: "moods", label: "Forgotten favorites" },
  genre_roulette: { group: "moods", label: "Genre roulette" },
  random: { group: "moods", label: "Surprise me" },
  short_watches: { group: "moods", label: "Short & sweet" },
  anniversaries: { group: "moods", label: "Anniversaries" },
  award_winners: { group: "moods", label: "Award winners (no longer offered)" },
  collection: { group: "collections", label: "A collection" },
  custom_filter: { group: "collections", label: "Titles matching rules" },
  genre: { group: "collections", label: "Genre (no longer offered)" },
  admin_curated_list: { group: "collections", label: "Editor's picks" },
};

/** The plain name of a row kind; unknown kinds read "Row", never a raw type key. */
export function rowKindLabel(sectionType: string): string {
  return ROW_KINDS[sectionType]?.label ?? "Row";
}

export function rowKindGroup(sectionType: string): RowGroup {
  return ROW_KINDS[sectionType]?.group ?? "collections";
}
