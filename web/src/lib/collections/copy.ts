import type { DraftField } from "./draft";
import type { ArtworkSlot } from "./scope";
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

/** What turning sharing off costs: "Maya and Leo lose it, including Home rows they made from it." */
export function unshareConsequence(profileNames: readonly string[]): string {
  const who = profileNames.length > 0 ? joinNames(profileNames) : "Other profiles";
  return `${who} lose it, including Home rows they made from it.`;
}

/** Shown when sharing is turned off on a saved collection. */
export function unshareWarning(profileNames: readonly string[]): string {
  return `When you save, ${unshareConsequence(profileNames)}`;
}

/** The ⋯ switch's help on a card: the menu has room for one short line. */
export const SHOW_TO_OTHER_PROFILES_SHORT_HELP = "Every profile on this account sees it";

// --- Server list ------------------------------------------------------------

export const ON_HOME = "On Home";
export const HIDDEN_FROM_TAB = "Hidden from Collections tab";

/** "Movies › Collections and Kids › Collections". */
function collectionsTabs(libraryNames: readonly string[]): string {
  return joinNames(libraryNames.map((name) => `${name} › Collections`));
}

export function hideCollectionTitle(name: string): string {
  return `Hide ${name} from Collections tabs?`;
}

/** Hiding a collection rows show: they keep showing it, but See all can't open it. */
export function hideCollectionDescription(
  libraryNames: readonly string[],
  rowCount: number,
): string {
  const leaves = libraryNames.length > 0 ? `It leaves ${collectionsTabs(libraryNames)}. ` : "";
  const rows =
    rowCount === 1
      ? "1 row still shows it, but its See all won't open while it's hidden."
      : `${rowCount} rows still show it, but their See all won't open while it's hidden.`;
  return leaves + rows;
}

/** A delete the server refused because Home or library page rows still show the collection. */
export const COLLECTION_IN_USE = "Rows still use it. Remove them first.";

// --- Select mode and Delete all ---------------------------------------------

/** Rows use every collection a delete was asked for, so nothing goes. */
export const COLLECTIONS_IN_USE = "Rows still use them. Remove the rows first.";

/** A starter pack being added would race a delete of the collections it makes. */
export const STARTER_PACK_BLOCKS_DELETE = "A starter pack is being added. Delete once it finishes.";

const KIND_NOUN: Readonly<Record<CollectionKind | "mixed", readonly [string, string]>> = {
  manual: ["manual collection", "manual collections"],
  smart: ["smart collection", "smart collections"],
  synced: ["synced list", "synced lists"],
  mixed: ["collection", "collections"],
};

/** "1 synced list", "7 collections": `kind` null when the collections are of several types. */
function kindCount(count: number, kind: CollectionKind | null): string {
  const [one, many] = KIND_NOUN[kind ?? "mixed"];
  return `${count} ${count === 1 ? one : many}`;
}

/** Up to five names, then how many more. */
function someNames(names: readonly string[]): string {
  const shown = names.length > 5 ? [...names.slice(0, 4), `${names.length - 4} more`] : names;
  return joinNames(shown);
}

export function syncListsLabel(count: number): string {
  return `Sync ${plural(count, "list")}`;
}

/** Sync works on synced lists only; says how many picked collections it passes over. */
export function syncSkipNote(smart: number, manual: number): string | null {
  if (smart + manual === 0) return null;
  const kinds = smart && manual ? "smart and manual" : smart ? "smart" : "manual";
  return `Sync skips ${kinds} collections (${smart + manual} here).`;
}

export type BatchAction = "sync" | "show" | "hide";

const BATCH_WORDS: Readonly<
  Record<BatchAction, { done: string; verb: string; noun: string; where: string }>
> = {
  sync: { done: "Synced", verb: "sync", noun: "list", where: "" },
  show: { done: "Showed", verb: "show", noun: "collection", where: " on Collections tabs" },
  hide: { done: "Hid", verb: "hide", noun: "collection", where: " from Collections tabs" },
};

/**
 * The toast after a select-mode action: all done, some done, or none.
 * `warned` counts the done ones that finished with warnings (a sync's unmatched entries).
 */
export function batchResult(
  action: BatchAction,
  done: number,
  total: number,
  warned = 0,
): { tone: "success" | "warning" | "error"; message: string } {
  const words = BATCH_WORDS[action];
  const warnings = warned > 0 ? `, ${warned} with warnings` : "";
  if (done === total)
    return {
      tone: warned > 0 ? "warning" : "success",
      message: `${words.done} ${plural(done, words.noun)}${words.where}${warnings}.`,
    };
  if (done > 0)
    return {
      tone: "warning",
      message: `${words.done} ${done} of ${plural(total, words.noun)}${warnings}.`,
    };
  return { tone: "error", message: `Couldn't ${words.verb} ${plural(total, words.noun)}.` };
}

export function alreadyShown(shown: boolean): string {
  return shown
    ? "The selected collections are already on Collections tabs."
    : "The selected collections are already hidden.";
}

export function hideCollectionsTitle(count: number): string {
  return `Hide ${count} collections from Collections tabs?`;
}

/** Hiding several collections rows show: `rowCount` is the rows' total. */
export function hideCollectionsDescription(rowCount: number): string {
  return rowCount === 1
    ? "1 row still shows one of them, but its See all won't open while it's hidden."
    : `${rowCount} rows still show them, but those rows' See all won't open while they're hidden.`;
}

/** "Delete 7 synced lists in Movies?" `where` is a library name or "this view". */
export function deleteCollectionsTitle(
  count: number,
  kind: CollectionKind | null,
  where: string | null,
): string {
  return `Delete ${kindCount(count, kind)}${where ? ` in ${where}` : ""}?`;
}

export function deleteCollectionsDescription(count: number): string {
  return count === 1
    ? "It's removed for everyone. Its titles stay in your libraries."
    : "They're removed for everyone. Their titles stay in your libraries.";
}

/** A collection is one thing in every library it's in, so deleting it there removes it everywhere. */
export function alsoDeletedElsewhere(
  entries: ReadonlyArray<{ title: string; libraryNames: readonly string[] }>,
  kind: CollectionKind | null,
): string {
  const [one, many] = KIND_NOUN[kind ?? "mixed"];
  const names = someNames(
    entries.map((entry) => `${entry.title} (${joinNames(entry.libraryNames)})`),
  );
  return entries.length === 1
    ? `A ${one} that's also in another library goes there too: ${names}.`
    : `${many.charAt(0).toUpperCase()}${many.slice(1)} that are also in other libraries go there too: ${names}.`;
}

/** The collections a delete leaves alone because Home or library page rows show them. */
export function keptForRows(titles: readonly string[]): string {
  return titles.length === 1
    ? `1 is kept because rows use it: ${titles[0]}.`
    : `${titles.length} are kept because rows use them: ${someNames(titles)}.`;
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

// --- Arrange ----------------------------------------------------------------

export function arrangeHeading(libraryName: string): string {
  return `Shelves on ${libraryName} › Collections`;
}
export const ARRANGE_SUBTITLE =
  "Shelves are set separately for each library. Top to bottom, the way viewers see them.";
export const ARRANGE_HINT =
  "Drag shelves and collections, or focus a handle and press Space, then the arrow keys. ⋯ has Move to shelf. Changes save right away.";

export const NO_HEADING = "No heading";
export const NO_HEADING_HELP = "Collections not on a shelf, shown without a title";
export const MY_COLLECTIONS_TAG = "Different for each viewer";
export const MY_COLLECTIONS_NOTE = `Each viewer's own collections land here when they turn on “${SHOW_ON_TAB_LABEL}”. You can rename or move this shelf.`;
/** Shown on My collections while a server collection is dragged. */
export const MY_COLLECTIONS_NO_DROP = "Viewers' own collections only";
export const HIDDEN_TAG = "Hidden";
export const MOVE_FAILED = "Couldn't move it";
/** A move found the order changed by someone else since Arrange read it; nothing was saved. */
export const ORDER_CHANGED =
  "Someone else changed this order, so nothing moved. Arrange now shows their order; move it again.";

export const VIEWER_PREVIEW_LABEL = "What viewers see";
export const VIEWER_PREVIEW_MINE = "Each viewer's own";
export const VIEWER_PREVIEW_NOTE =
  "The pin marks a collection kept at the start of its shelf. Hidden collections don't appear.";

// --- Pin (`featured`) ---------------------------------------------------------

export const PIN_LABEL = "Pin to the start of its shelf";
export const UNPIN_LABEL = "Unpin";
export const PINNED = "Pinned";
export const PINNED_BAND = "Pinned to the start";

/** Pin is set on the collection, not per library, so it reaches every library the collection is in. */
const PIN_EVERY_LIBRARY = " This applies in every library it's in.";

/**
 * What Pin does, given what the shelf sorts by (null for Your order) and
 * whether the collection is in more than one library. Pinned collections also
 * lead the capped Server collections list on every profile's Collections
 * page, which is all Pin does on a shelf that sorts itself.
 */
export function pinHelp(shelfSortedBy: string | null, inSeveralLibraries = false): string {
  const help =
    shelfSortedBy === null
      ? "Shows first on this shelf and in Server collections on the Collections page."
      : `Shows first in Server collections on the Collections page; this shelf sorts by ${shelfSortedBy}.`;
  return inSeveralLibraries ? help + PIN_EVERY_LIBRARY : help;
}

export function unpinHelp(shelfSortedBy: string | null, inSeveralLibraries = false): string {
  const help =
    shelfSortedBy === null
      ? "Stops showing first on this shelf and in Server collections on the Collections page."
      : "Stops showing first in Server collections on the Collections page.";
  return inSeveralLibraries ? help + PIN_EVERY_LIBRARY : help;
}

/**
 * The phone sheet's Pin switch, which names the collection and its shelf
 * (null for No heading, which viewers never see as a name).
 */
export function pinSwitchLabel(name: string, shelfName: string | null): string {
  return `Pin ${name} to the start of ${shelfName ?? "the collections with no heading"}`;
}

export function deleteShelfTitle(name: string): string {
  return `Delete the ${name} shelf?`;
}

/** Deleting a shelf never deletes its collections, and touches one library only. */
export function deleteShelfDescription(collectionCount: number, libraryName: string): string {
  const members =
    collectionCount === 0
      ? "It has no collections."
      : `${collectionCount === 1 ? "Its 1 collection moves" : `Its ${collectionCount} collections move`} to ${NO_HEADING} on ${libraryName} › Collections. ${collectionCount === 1 ? "It isn't" : "They aren't"} deleted.`;
  return `${members} Only ${libraryName} changes; shelves in other libraries stay as they are. You can make the shelf again later.`;
}
