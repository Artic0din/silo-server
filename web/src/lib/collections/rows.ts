import { homeRowsPath } from "@/lib/homeRows/rowLinks";
import type { PageRef } from "@/lib/homeRows/types";

import { joinNames, libraryPageLabel } from "./copy";

/** An administrator Home or library page row that shows a server collection. */
export interface CollectionRow {
  id: string;
  page: PageRef;
  title: string;
  enabled: boolean;
  /** Its place on the page, counting from 1. */
  position: number;
  /** How many rows the page has, turned-off rows included. */
  pageRowCount: number;
}

/** The rows that show a collection, as read for the editor or a delete. */
export type RowsState =
  | { status: "loading" }
  | { status: "error"; onRetry: () => void }
  | { status: "ready"; rows: readonly CollectionRow[] };

type LibraryNames = ReadonlyMap<number, string>;

/** "Home" or "Kids page". */
export function rowPlace(page: PageRef, names: LibraryNames): string {
  if (page.kind === "home") return "Home";
  return libraryPageLabel(names.get(page.libraryId) ?? "Library");
}

/** "Home · row 6 of 9", with "Turned off" for a row nobody sees. */
export function rowMeta(row: CollectionRow, names: LibraryNames): string {
  const where = `${rowPlace(row.page, names)} · row ${row.position} of ${row.pageRowCount}`;
  return row.enabled ? where : `${where} · Turned off`;
}

/** "Studio Ghibli (Home)": each row by title and place, for naming rows in a message. */
export function rowLabels(rows: readonly CollectionRow[], names: LibraryNames): string[] {
  return rows.map((row) => `${row.title} (${rowPlace(row.page, names)})`);
}

/** "Home and the Kids page", "the Kids and Movies pages": the pages `rows` sit on. */
export function rowPlaces(rows: readonly CollectionRow[], names: LibraryNames): string | null {
  const home = rows.some((row) => row.page.kind === "home");
  const pages = [
    ...new Set(
      rows.flatMap((row) =>
        row.page.kind === "library" ? [names.get(row.page.libraryId) ?? "Library"] : [],
      ),
    ),
  ];
  const parts = [
    ...(home ? ["Home"] : []),
    ...(pages.length > 0 ? [`the ${joinNames(pages)} page${pages.length === 1 ? "" : "s"}`] : []),
  ];
  return parts.length > 0 ? joinNames(parts) : null;
}

/** The header's "On Home and the Kids page": where viewers see it in a row, turned-off rows left out. */
export function onRowsLine(rows: readonly CollectionRow[], names: LibraryNames): string | null {
  const places = rowPlaces(
    rows.filter((row) => row.enabled),
    names,
  );
  return places ? `On ${places}` : null;
}

interface NamedLibrary {
  id: number;
  name: string;
}

/**
 * The library pages a collection can be added to as a row: the libraries it's
 * in first, then the others, each in the order given.
 */
export function rowPages(
  collectionLibraries: readonly NamedLibrary[],
  allLibraries: readonly NamedLibrary[],
): { bound: NamedLibrary[]; others: NamedLibrary[] } {
  const boundIds = new Set(collectionLibraries.map((library) => library.id));
  return {
    bound: allLibraries.filter((library) => boundIds.has(library.id)),
    others: allLibraries.filter((library) => !boundIds.has(library.id)),
  };
}

/**
 * Admin Home rows on `page` with Add row open on the collection. With
 * `returnTo` (the editor), Home rows comes back there after Add row.
 */
export function addRowPath(collectionId: string, page: PageRef, returnTo?: string): string {
  return homeRowsPath("admin", page, {
    add: `collection:library:${collectionId}`,
    ...(returnTo ? { return: returnTo } : {}),
  });
}

/** Admin Home rows with the row open in Edit row. */
export function openRowPath(row: Pick<CollectionRow, "id" | "page">): string {
  return homeRowsPath("admin", row.page, { edit: row.id });
}
