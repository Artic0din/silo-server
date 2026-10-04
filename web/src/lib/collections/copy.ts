import type { DraftField } from "./draft";
import type { ArtworkSlot } from "./scope";

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
