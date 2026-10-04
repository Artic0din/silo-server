import type { DraftField } from "./draft";
import type { ArtworkSlot, ScopeKind } from "./scope";
import { COLLECTION_KIND_LABEL, type CollectionKind } from "./types";

/**
 * Words every collections surface shares, so the editor, lists and dialogs
 * say the same thing. "Collections tab" is where a library's collections are
 * browsed; "library page" is the rows above a library's grid.
 */

/** "Movies", "Movies and Kids", "Movies, Kids and 4K Movies". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// --- New collection ---------------------------------------------------------

export const NEW_COLLECTION = "New collection";

/** The type picker's subtitle: what the type decides, and what the editor asks next. */
export const NEW_COLLECTION_HELP: Readonly<Record<ScopeKind, string>> = {
  server: "What decides what's in it? Next you'll name it, fill it and choose where it shows.",
  personal:
    "What decides what's in it? Only you can change it. Next you'll name it, fill it and choose who sees it.",
};

export const NEW_COLLECTION_NEXT = "Next: name it and fill it in, on its own page.";
export const STARTER_PACK_PROMPT = "Want a whole set at once?";
export const ADD_A_STARTER_PACK = "Add a starter pack";

/** What each type does, under its name on the type picker. */
export const KIND_SENTENCE: Readonly<Record<CollectionKind, string>> = {
  manual: "You pick the titles and put them in order.",
  smart: "Titles that match your rules. It fills itself and keeps up as titles are added.",
  synced: "Follows a list from MDBList or TMDB and updates on a schedule.",
};

/** Examples for each type on the type picker; a profile has no staff. */
export const KIND_GOOD_FOR: Readonly<Record<ScopeKind, Readonly<Record<CollectionKind, string>>>> =
  {
    server: {
      manual: "staff picks, a director's best, movie night.",
      smart: "90s comedies, unwatched 4K, Christmas movies.",
      synced: "IMDb Top 250, Netflix Originals, trending this week.",
    },
    personal: {
      manual: "a director's best, movie night, a watch order.",
      smart: "90s comedies, unwatched 4K, Christmas movies.",
      synced: "IMDb Top 250, Netflix Originals, trending this week.",
    },
  };

export const SYNCED_CHECKING = "Checking Synced lists…";
export const SYNCED_CHECK_FAILED = "Couldn't check whether Synced lists are on.";

// --- Where it shows ---------------------------------------------------------

export const SHOW_ON_TAB_LABEL = "Show on the Collections tab";

/** The server switch's help: where viewers find the collection. */
export function serverTabHelp(libraryNames: readonly string[]): string {
  if (libraryNames.length === 0) return "Viewers find it on its libraries' Collections tabs.";
  return `Viewers find it under ${joinNames(libraryNames.map((name) => `${name} › Collections`))}.`;
}

/**
 * The personal switch's help. Profiles the collection is shared with see it
 * on their Collections tabs too, so the label can't say "my".
 */
export const PERSONAL_TAB_HELP = "For you and anyone you share it with";

export const SHOW_TO_OTHER_PROFILES_LABEL = "Show to other profiles";
export const SHOW_TO_OTHER_PROFILES_HELP =
  "Every profile on this account sees it, minus titles it can't access. Nobody else on the server can see it.";

/** Shown when sharing is turned off on a saved collection. */
export function unshareWarning(profileNames: readonly string[]): string {
  const who = profileNames.length > 0 ? joinNames(profileNames) : "Other profiles";
  return `When you save, ${who} lose it, including Home rows they made from it.`;
}

// --- Titles -----------------------------------------------------------------

export const TITLES_CAPTION = {
  server: "In the order viewers see them. Titles save as you add, remove or drag them.",
  personal: "In the order you see them. Titles save as you add, remove or drag them.",
  create: "Pick titles now. They're added when you press Create collection.",
} as const;
export const TITLES_SAVED = "Saved";
export const TITLES_EMPTY = "No titles yet. Search above to add the first.";
export const IN_THIS_COLLECTION = "In this collection";
export const ALL_YOUR_LIBRARIES = "All your libraries";
export const MANUAL_ORDER_LINE = "Your order. Drag titles to change it.";

export function removedTitle(title: string): string {
  return `Removed ${title}`;
}

export function createdButNotAdded(count: number): string {
  return `Created, but couldn't add ${plural(count, "title")}`;
}

// --- Rules (Smart) ----------------------------------------------------------

export const RULES_CAPTION =
  "Titles that match are in the collection. New matches join on their own.";
/** Under a personal Smart collection's rules. */
export const PERSONAL_RULES_NOTE =
  "“All my libraries” follows the libraries this profile can see. Rules about you, like Watched, are offered only here.";
export const ALL_MY_LIBRARIES = "all my libraries";
/** A personal list's libraries when none is ticked, as the library menu reads. */
export const ALL_MY_LIBRARIES_LABEL = "All my libraries";
/** The meta line's last part on a Smart collection. */
export const SMART_UPDATES_ITSELF = "Updates itself as titles are added";
/** After "Rules not saved" in the save bar. */
export const PREVIEW_SHOWS_UNSAVED = "The preview already shows them.";

export const PREVIEW_LIVE = "Live preview";
export const PREVIEW_EMPTY = "No titles match yet";
export const PREVIEW_EMPTY_HELP = "You can still save. Titles that match later join on their own.";
export const PREVIEW_FAILED = "The preview didn't load. You can still save.";

export function previewMatches(total: number): string {
  return total === 1 ? "1 title matches" : `${total.toLocaleString()} titles match`;
}

// --- Order ------------------------------------------------------------------

export const ORDER_HELP = "A profile that picks its own sort while browsing keeps that choice.";
export const NO_LIMIT = "No limit";

/** A smart collection's stored default sort, which wins over Order until cleared. */
export function storedSortLine(sortLabel: string): string {
  return `A saved default sort, ${sortLabel}, wins over this Order.`;
}

// --- Synced list ------------------------------------------------------------

export const SYNCED_HEADING = "The list it follows";
export const SYNCED_CAPTION = "Titles come from this list and update on its schedule.";
export const SYNCED_CREATE_SUBTITLE =
  "Pick the list, check the details, then press Create collection.";
export const SYNCED_OFF = "Synced lists are off on this server.";
export const POPULAR_PICKS = "Popular picks";
export const POPULAR_PICKS_HELP = "Ready-made lists that work well here";
export const FROM_MDBLIST = "From MDBList";
export const FROM_MDBLIST_HELP = "Public lists by other people";
export const PASTE_MDBLIST_LINK = "Or paste any MDBList link";
export const MDBLIST_LINK_INVALID =
  "Paste the link to a list on mdblist.com, like https://mdblist.com/lists/…";
export const MDBLIST_SEARCH_OFF_PROFILE =
  "Searching MDBList is off on this server. Popular picks and pasted links still work.";
export const PASTE_TMDB_LIST_LINK = "Paste a TMDB list link";
export const TMDB_LIST_HELP = "Public lists only. Its titles arrive with the first sync.";
export const CHART_RULES_NOTE = "“Trending over” and “Both” appear only for Trending.";
export const NAME_FILLED_HELP =
  "Filled in from the list. Picking another list keeps anything you typed.";
export const SYNCS_ON_CREATE = "It syncs for the first time when you create it.";
export const PICK_A_LIST_FIRST = "Pick a list, then create it.";
export const SYNCED_ORDER_HELP = "Blank takes the whole list, up to 500.";

/** "Kept your name", "Kept your name and description": what a new pick left alone. */
export function keptMessage(fields: readonly ("name" | "description")[]): string | null {
  return fields.length > 0 ? `Kept your ${joinNames([...fields])}` : null;
}

/** "This list only has movies, so TV Shows isn't offered." */
export function ineligibleLibrariesLine(
  mediaKind: "movie" | "tv",
  libraryNames: readonly string[],
): string {
  const only = mediaKind === "movie" ? "movies" : "TV shows";
  const verb = libraryNames.length === 1 ? "isn't" : "aren't";
  return `This list only has ${only}, so ${joinNames(libraryNames)} ${verb} offered.`;
}

/** "Server time (UTC−5)", with the zone's name when the server reports one. */
export function serverTimeLabel(zone?: { utc_offset: string; name?: string }): string {
  if (!zone) return "Server time";
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(zone.utc_offset);
  let offset = "UTC";
  if (match && (match[2] !== "00" || match[3] !== "00")) {
    const hours = String(Number(match[2]));
    offset = `UTC${match[1] === "-" ? "−" : "+"}${hours}${match[3] === "00" ? "" : `:${match[3]}`}`;
  }
  return `Server time (${zone.name ? `${offset}, ${zone.name}` : offset})`;
}

/** The toast after a synced list is created: how its first sync went. */
export function firstSyncMessage(sync?: { status: string; message: string; itemsMatched: number }) {
  if (!sync) return { tone: "success" as const, text: "Created. It syncs on its schedule." };
  const titles = `${sync.itemsMatched} title${sync.itemsMatched === 1 ? "" : "s"}`;
  if (sync.status === "failed") {
    return {
      tone: "warning" as const,
      text: `Created, but the first sync failed. ${sync.message}`.trim(),
    };
  }
  if (sync.status === "warning") {
    return {
      tone: "warning" as const,
      text: `Created. The first sync found ${titles}, with warnings.`,
    };
  }
  return { tone: "success" as const, text: `Created. The first sync found ${titles}.` };
}

// --- A saved Synced list ----------------------------------------------------

export const SYNC_NOW = "Sync now";
export const SYNCING_NOW = "Syncing now…";
export const LAST_SYNC = "Last sync";
export const NEXT_SYNC = "Next sync";
export const NOT_IN_YOUR_LIBRARIES = "Not in your libraries";
export const NOT_SYNCED_YET = "Not yet";
export const NOT_SCHEDULED = "Not scheduled";
export const NOT_COUNTED_YET = "Not counted yet";
export const WHY_SKIPPED = "Why titles are skipped";
export const CHANGE_LINK = "Change link";
export const MDBLIST_LINK = "MDBList link";
export const TMDB_LIST_LINK = "TMDB list link";
export const LINK_CHANGES_AT_NEXT_SYNC = "Public lists only. Titles change at the next sync.";
export const TMDB_LIST_INVALID =
  "Paste the link to a public list on themoviedb.org, like https://www.themoviedb.org/list/310.";
export const PICK_A_CHART = "Pick a chart.";
export const CHART_SET_WHEN_MADE = "set when it was made";
export const FRANCHISE_ID_LABEL = "TMDB collection ID";
export const FIND_FRANCHISE_ID = "Find the ID on themoviedb.org";
export const FRANCHISE_ID_HELP =
  "The number in the collection's link, for example themoviedb.org/collection/119. Titles change at the next sync.";
export const FRANCHISE_ID_MISSING =
  "This list doesn't follow a TMDB collection yet. Add its ID so it can sync.";
export const FRANCHISE_ID_INVALID = "Use the number from the collection's link, like 119.";
export const DISCOVER_LOCKED = "Made by a starter pack. Its rules can't be changed here.";
export const DISCOVER_STILL_EDITABLE =
  "You can still change its name, artwork, max titles, schedule and where it shows.";
export const TRAKT_LOCKED =
  "New Trakt lists aren't supported. This one keeps its source and libraries.";
export const TRAKT_STILL_EDITABLE =
  "You can still change its name, artwork, order, schedule and where it shows.";
export const TRAKT_SCHEDULE_STOPPED = "A stopped Trakt list can't be scheduled again.";
export const PERSONAL_SCHEDULE_LOCKED =
  "This server doesn't let profiles change a list's schedule.";

/** "3 hours ago": how long ago a sync ran. */
export function syncedAgo(iso: string, now = Date.now()): string {
  const seconds = Math.round((now - Date.parse(iso)) / 1000);
  if (Number.isNaN(seconds)) return "recently";
  if (seconds < 60) return "just now";
  const steps: Array<[number, string]> = [
    [60, "minute"],
    [24, "hour"],
    [30, "day"],
    [12, "month"],
  ];
  let value = Math.round(seconds / 60);
  for (const [size, unit] of steps) {
    if (value < size) return `${plural(value, unit)} ago`;
    value = Math.round(value / size);
  }
  return `${plural(value, "year")} ago`;
}

/** "41 titles skipped". */
export function titlesSkipped(count: number): string {
  return `${plural(count, "title")} skipped`;
}

/** Why a synced list skips titles, and what brings them in. */
export function skippedExplanation(
  count: number | undefined,
  libraryNames: readonly string[],
  canSync = true,
) {
  const where = libraryNames.length > 0 ? joinNames(libraryNames) : "your libraries";
  if (count === undefined) {
    const skipped = `Titles on the list that aren't in ${where} are skipped.`;
    return canSync ? `${skipped} Sync now to count them.` : skipped;
  }
  const verb = count === 1 ? "isn't" : "aren't";
  return `${plural(count, "title")} on the list ${verb} in ${where}, so they're skipped. Add them to one of those libraries and they join at the next sync.`;
}

/** The red callout at the top of a list whose last sync failed. */
export function syncFailedLead(lastAt: string | undefined): string {
  return lastAt ? `The last sync failed ${syncedAgo(lastAt)}.` : "The last sync failed.";
}

export function keepsTitles(count: number): string {
  return `The collection keeps its ${plural(count, "title")}.`;
}

// --- Add to collection -----------------------------------------------------

export const ADD_TO_COLLECTION_FOOTNOTE =
  "Only manual collections take titles by hand. Ticking saves right away.";

/** "Manual · 15 titles": a manual collection's line in a picker. */
export function manualTitleCount(count: number): string {
  return `${COLLECTION_KIND_LABEL.manual} · ${plural(count, "title")}`;
}

/** The Add to collection footer: how many of the profile's collections hold the title. */
export function inCollections(count: number): string {
  return count === 0 ? "Not in a collection yet" : `In ${plural(count, "collection")}`;
}

/** The new collection was kept, but the title it was made for didn't go in. */
export function madeButNotAdded(collection: string, title: string): string {
  return `Made ${collection}, but couldn't add ${title}`;
}

// --- Save bar ---------------------------------------------------------------

/** How the save bar and the conflict banner name a draft field. */
export const DRAFT_FIELD_LABEL: Readonly<Record<DraftField, string>> = {
  name: "Name",
  description: "Description",
  libraryIds: "Libraries",
  rules: "Rules",
  rawSortConfig: "Order",
  showOnly: "Show only",
  visibility: SHOW_ON_TAB_LABEL,
  shared: SHOW_TO_OTHER_PROFILES_LABEL,
  inLibraryTabs: SHOW_ON_TAB_LABEL,
  list: "List",
  limit: "Max titles",
  schedule: "Sync schedule",
};

export const ARTWORK_SLOT_LABEL: Readonly<Record<ArtworkSlot, string>> = {
  poster: "Poster",
  backdrop: "Backdrop",
};

export const NOT_CREATED_YET = "Not created yet";
export const TITLES_ALREADY_SAVED = "Titles are already saved.";
export const SAVE_FAILED = "Couldn't save";

/** Why Create waits on a server collection with no library yet. */
export const PICK_LIBRARIES_FIRST = "Pick its libraries, then create it.";

/** Why Save waits on a saved server collection with every library unticked. */
export const PICK_A_LIBRARY = "Pick at least one library.";

export const NAME_IT_THEN_CREATE = "Name it, then create it.";

export function titlesReadyToAdd(count: number): string {
  return count === 0 ? NAME_IT_THEN_CREATE : `${plural(count, "title")} ready to add`;
}

/** "Name and description not saved": the first field as labelled, the rest in lower case. */
export function notSavedMessage(fieldLabels: readonly string[]): string {
  const [first, ...rest] = fieldLabels;
  if (!first) return "";
  const names = [first, ...rest.map((label) => label.charAt(0).toLowerCase() + label.slice(1))];
  return `${joinNames(names)} not saved`;
}

// --- Conflicts and deletes --------------------------------------------------

export const CONFLICT_TITLE = "This collection changed since you opened it.";

export function serverDeleteDescription(libraryNames: readonly string[]): string {
  if (libraryNames.length === 0) return "It's removed for everyone. This can't be undone.";
  return `It's removed from ${joinNames(libraryNames)} for everyone. This can't be undone.`;
}

export function personalDeleteDescription(shared: boolean): string {
  return shared
    ? "It's removed for you and every profile you share it with. This can't be undone."
    : "This can't be undone.";
}
