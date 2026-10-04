/**
 * The data the Home rows components read. Both surfaces (admin Home rows and
 * Settings > Home Screen) map their own rows into these shapes through an
 * adapter hook, so nothing under components/homeRows reads an account role or
 * an API type.
 */
export type Surface = "admin" | "profile";

export type PageRef = { kind: "home" } | { kind: "library"; libraryId: number };

export interface HomeRowsPageOption {
  ref: PageRef;
  label: string;
}

export interface HomeRow {
  id: string;
  title: string;
  sectionType: string;
  config: Record<string, unknown>;
  itemLimit: number;
  hero: boolean;
  /** Admin: the row is enabled. Profile: the row is not hidden. */
  shown: boolean;
  /** A row the profile added itself ("Yours"). Always false on the admin surface. */
  own: boolean;
  /** A legacy Trakt row: the server refuses config changes and turning it back on. */
  legacyTrakt: boolean;
}

export type HomeRowsConflict = null | { scope: "page" | "row"; rowId?: string };

export interface HomeRowsAdapter {
  surface: Surface;
  page: PageRef;
  pages: HomeRowsPageOption[];
  /** Ignored while `pending`, so a write never lands on a page the user left. */
  setPage(ref: PageRef): void;
  status: "loading" | "ready" | "error";
  /** The read failure shown when `status` is "error". */
  error: string | null;
  canEdit: boolean;
  /** In display order, including an attempted order the server has not accepted. */
  rows: HomeRow[];
  /** A write, or the refetch after it, is still in flight. */
  pending: boolean;
  conflict: HomeRowsConflict;
  /** Refetches the page and drops any attempted order. */
  reload(): Promise<void>;
  /** Whether a reorder may start now. */
  canReorder: boolean;
  /**
   * The version a reorder is checked against. Captured when a drag starts and
   * handed back to `reorder`, so a refetch during the drag cannot change it.
   */
  orderToken: unknown;
  reorder(orderedIds: string[], orderToken?: unknown): Promise<void>;
  setShown(id: string, shown: boolean): Promise<void>;
  setHero(id: string, hero: boolean): Promise<void>;
}
