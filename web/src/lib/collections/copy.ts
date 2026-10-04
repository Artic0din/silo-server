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

/** The older builders' wording of the same switch, until they move onto the editor page. */
export const LIBRARY_TAB_DESCRIPTION =
  "Pin this collection to your library's Collections tab alongside the admin shelves. Profiles that can see this collection see it there too.";

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

export function titlesReadyToAdd(count: number): string {
  return count === 0 ? "Name it, then create it." : `${plural(count, "title")} ready to add`;
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
