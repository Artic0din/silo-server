/**
 * A library's shelves in Arrange: the server's collection groups plus the
 * collections on no shelf ("No heading"), in the order viewers see them on
 * the library's Collections tab, and the moves Arrange can make.
 */
import type { GroupSortMode, LibraryCollection, LibraryCollectionGroup } from "@/api/types";

import { NO_HEADING } from "./copy";

/** The id the order routes use for the collections on no shelf. */
export const UNGROUPED = "ungrouped";

export type ShelfKind = "regular" | "user_collections" | "ungrouped";

export interface Shelf {
  /** The group's id, or `UNGROUPED`. */
  id: string;
  kind: ShelfKind;
  name: string;
  sortMode: GroupSortMode;
  /** In the order the server stores them; `shownCollections` gives the order viewers see. */
  collections: LibraryCollection[];
}

export interface BoardGroup extends LibraryCollectionGroup {
  collections: LibraryCollection[];
}

/** A collection's new place: its shelf's whole stored order once the move saves. */
export interface CollectionMove {
  shelfId: string;
  orderedIds: string[];
}

export const SHELF_ORDER_LABEL: Readonly<Record<GroupSortMode, string>> = {
  manual: "Your order",
  name_asc: "Name A–Z",
  name_desc: "Name Z–A",
  recent: "Recently updated",
  most_items: "Most titles",
};

const SORTED_BY: Readonly<Record<GroupSortMode, string | null>> = {
  manual: null,
  name_asc: "name",
  name_desc: "name",
  recent: "recently updated",
  most_items: "most titles",
};

function byId(a: { id: string }, b: { id: string }) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function move<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/**
 * The shelves top to bottom. No heading sits at its own position; a tie in
 * position falls back to the id, its sentinel included, as the server orders them.
 */
export function boardShelves(
  groups: readonly BoardGroup[],
  ungrouped: readonly LibraryCollection[],
  ungroupedSortOrder: number,
): Shelf[] {
  const slots = [
    ...groups.map((group) => ({
      order: group.sort_order,
      shelf: {
        id: group.id,
        kind: group.kind,
        name: group.name,
        sortMode: group.default_sort_mode,
        collections: group.collections,
      } satisfies Shelf,
    })),
    {
      order: ungroupedSortOrder,
      shelf: {
        id: UNGROUPED,
        kind: "ungrouped",
        name: NO_HEADING,
        sortMode: "manual",
        collections: [...ungrouped],
      } satisfies Shelf,
    },
  ];
  slots.sort((a, b) => a.order - b.order || byId(a.shelf, b.shelf));
  return slots.map((slot) => slot.shelf);
}

/** A shelf's collections in the order viewers see them. */
export function shownCollections(shelf: Shelf): LibraryCollection[] {
  const list = [...shelf.collections];
  switch (shelf.sortMode) {
    case "name_asc":
      return list.sort((a, b) => a.title.localeCompare(b.title));
    case "name_desc":
      return list.sort((a, b) => b.title.localeCompare(a.title));
    case "recent":
      return list.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
    case "most_items":
      return list.sort((a, b) => (b.item_count ?? 0) - (a.item_count ?? 0));
    default:
      return list;
  }
}

/** What a shelf that orders itself sorts by ("name", "most titles"); null for Your order. */
export function sortedBy(mode: GroupSortMode): string | null {
  return SORTED_BY[mode];
}

/** "3 collections", or "2 collections, sorted by name" on a shelf that orders itself. */
export function shelfCountLine(shelf: Shelf): string {
  const count = shelf.collections.length;
  const line = `${count} collection${count === 1 ? "" : "s"}`;
  const by = sortedBy(shelf.sortMode);
  return by ? `${line}, sorted by ${by}` : line;
}

/** My collections holds each viewer's own collections, never a server one. */
export function acceptsCollections(shelf: Shelf): boolean {
  return shelf.kind !== "user_collections";
}

export function shelfOf(shelves: readonly Shelf[], collectionId: string): Shelf | undefined {
  return shelves.find((shelf) => shelf.collections.some((entry) => entry.id === collectionId));
}

/**
 * Where collection `id` goes when it's dropped on collection `overId` of
 * shelf `shelfId`, or on the shelf itself (`overId` null, also Move to shelf).
 * Within its shelf it takes the place of the card it lands on, as the drag
 * showed; from another shelf it goes before that card, or last. Null when
 * nothing would change or the shelf can't take it.
 */
export function planCollectionMove(
  shelves: readonly Shelf[],
  id: string,
  shelfId: string,
  overId: string | null,
): CollectionMove | null {
  const target = shelves.find((shelf) => shelf.id === shelfId);
  if (!target || !acceptsCollections(target)) return null;
  const ids = target.collections.map((entry) => entry.id);
  const from = ids.indexOf(id);
  if (from !== -1) {
    // Order within a shelf that sorts itself changes nothing viewers see.
    if (overId === null || target.sortMode !== "manual") return null;
    const to = ids.indexOf(overId);
    if (to === -1 || to === from) return null;
    return { shelfId, orderedIds: move(ids, from, to) };
  }
  const at = overId === null ? -1 : ids.indexOf(overId);
  return {
    shelfId,
    orderedIds: at === -1 ? [...ids, id] : [...ids.slice(0, at), id, ...ids.slice(at)],
  };
}

/** The shelves as they look once `next` saves. */
export function applyCollectionMove(
  shelves: readonly Shelf[],
  id: string,
  next: CollectionMove,
): Shelf[] {
  const moved = shelves.flatMap((shelf) => shelf.collections).find((entry) => entry.id === id);
  if (!moved) return [...shelves];
  return shelves.map((shelf) => {
    const rest = shelf.collections.filter((entry) => entry.id !== id);
    if (shelf.id !== next.shelfId)
      return rest.length === shelf.collections.length ? shelf : { ...shelf, collections: rest };
    const known = new Map([...rest, moved].map((entry) => [entry.id, entry]));
    return {
      ...shelf,
      collections: next.orderedIds.flatMap((entry) => known.get(entry) ?? []),
    };
  });
}

/** Every shelf's id once shelf `id` moves to index `to` (clamped), or null when it's already there. */
export function planShelfMove(shelves: readonly Shelf[], id: string, to: number): string[] | null {
  const ids = shelves.map((shelf) => shelf.id);
  const from = ids.indexOf(id);
  const target = Math.max(0, Math.min(to, ids.length - 1));
  return from === -1 || from === target ? null : move(ids, from, target);
}

export function applyShelfMove(shelves: readonly Shelf[], orderedIds: readonly string[]): Shelf[] {
  const known = new Map(shelves.map((shelf) => [shelf.id, shelf]));
  return orderedIds.flatMap((id) => known.get(id) ?? []);
}
