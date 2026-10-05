/**
 * One description of where a collection lives, so a page or editor can work
 * with server (library) and personal collections through the same calls.
 *
 * `SERVER_SCOPE` covers the admin library collections under `/admin/...`;
 * `PERSONAL_SCOPE` covers a profile's own collections. Both use the query
 * keys and request bodies the pages already use, so a cache entry or a request
 * looks the same whichever path produced it. Hooks live in
 * `hooks/queries/collectionScope.ts`, not on these objects.
 */
import type { QueryClient, QueryKey } from "@tanstack/react-query";

import {
  adminCreateBody,
  adminMutationMessage,
  adminUpdateBody,
  fetchAdminCollections,
  fetchAdminCollectionSnapshot,
  saveAdminArtwork,
} from "@/api/adminCollections";
import {
  collectionCreateToV2,
  collectionsFromV2,
  collectionUpdateToV2,
  fetchCollectionEditSnapshot,
  previewFromV2,
  previewToV2,
  saveCollectionPoster,
  syncFromV2,
} from "@/api/personalCollections";
import type {
  Collection,
  CreateCollectionRequest,
  CreateLibraryCollectionRequest,
  DisplayQueryDefinition,
  LibraryCollection,
  QueryDefinition,
  QueryDefinitionInput,
  UpdateCollectionRequest,
} from "@/api/types";
import { normalizeQueryDefinition } from "@/api/types";
import { requiredETag } from "@/api/v2/etag";
import { v2, V2ProblemError } from "@/api/v2/request";
import { normalizeSmartCollectionLimit } from "@/components/collections/smartCollectionLimits";
import {
  invalidateAdminCollectionQueries,
  invalidateUserCollectionQueries,
} from "@/hooks/queries/collectionSurfaceRefresh";
import { adminKeys, collectionKeys, libraryCollectionKeys } from "@/hooks/queries/keys";
import {
  buildLibraryCollectionCatalogHref,
  buildUserCollectionCatalogHref,
} from "@/pages/catalogSearchParams";

import { draftRules } from "./draft";
import { isOwnCollection } from "./personalOwnership";
import { collectionKindOf, syncedSourceOf, type CollectionKind, type SyncedSource } from "./types";

export type ScopeKind = "server" | "personal";
export type ArtworkSlot = "poster" | "backdrop";
export type WireCollection = LibraryCollection | Collection;

/** A staged artwork change, sent after the collection itself saves. */
export interface ArtworkSlotDraft {
  file?: File | null;
  sourceUrl?: string;
  /** Remove the saved image on Save; a new file or link in the same slot wins. */
  remove?: boolean;
}
export type ArtworkDraft = Partial<Record<ArtworkSlot, ArtworkSlotDraft>>;

/** What an editor edits for a manual or smart collection, independent of scope. */
export interface CollectionDraft {
  kind: CollectionKind;
  name: string;
  description: string;
  /** Server: the libraries the collection belongs to. Personal smart: the libraries it matches; [] = all. */
  libraryIds: number[];
  /** Smart only. A "no limit" limit is already cleared. */
  rules?: QueryDefinition;
  /** The stored `sort_config`, sent back with smart rules. */
  rawSortConfig?: Record<string, unknown>;
  /** Personal manual only: the display filter. */
  showOnly?: DisplayQueryDefinition;
  artwork: ArtworkDraft;
  /** Manual, before the collection exists: titles to add, in order, once it is created. */
  stagedItems?: string[];
  /**
   * Pin (`featured`) is not here: it is set in Arrange, so an editor creates
   * with it off and never sends it on a save.
   */
  server?: { visibility: "visible" | "hidden" };
  personal?: { shared: boolean; inLibraryTabs: boolean };
}

/** A draft `create` and `update` can send today. Synced lists still save through their import forms. */
export type SavableDraft = CollectionDraft & { kind: "manual" | "smart" };

/** The read model shared by both scopes, for headers, rows and editors. */
export interface CollectionView<Raw extends WireCollection = WireCollection> {
  id: string;
  scope: ScopeKind;
  kind: CollectionKind;
  source: SyncedSource | null;
  name: string;
  description: string;
  posterUrl?: string;
  posterThumbhash?: string;
  backdropUrl?: string;
  itemCount: number;
  libraryIds: number[];
  /** Personal: the profile that created it, the only one that may change it. */
  ownerProfileId?: string;
  sync?: { status: string; message: string; lastAt?: string; nextAt?: string; schedule: string };
  server?: { visibility: "visible" | "hidden"; pinFirst: boolean; managementKey?: string };
  personal?: { shared: boolean; inLibraryTabs: boolean };
  raw: Raw;
}

export interface EditorSnapshot<Raw extends WireCollection = WireCollection> {
  view: CollectionView<Raw>;
  etag: string;
}

export interface PreviewItem {
  content_id: string;
  title: string;
  type: string;
  poster_url?: string;
}

export interface SaveOutcome {
  warnings: string[];
  failedArtwork: ArtworkSlot[];
}

export interface SyncOutcome {
  status: string;
  message: string;
  itemsMatched: number;
}

export interface CollectionScope<Raw extends WireCollection = WireCollection> {
  readonly kind: ScopeKind;
  /** The value the item hooks take to pick the admin or personal item routes. */
  readonly itemSource: "library" | "user";
  readonly artworkSlots: readonly ArtworkSlot[];
  readonly requireLibraries: boolean;
  /**
   * True when the editor read carries no artwork, so the editor waits for the
   * list before it opens. A personal read carries its own poster and opens at once.
   */
  readonly editorAwaitsList: boolean;
  readonly allowPersonalizedRules: boolean;

  paths: {
    list(options?: { libraryId?: number | null; view?: "list" | "arrange" }): string;
    create(options?: {
      type?: CollectionKind;
      source?: SyncedSource;
      libraryId?: number | null;
    }): string;
    edit(
      id: string,
      options?: { libraryId?: number | null; view?: "list" | "arrange"; focus?: "titles" },
    ): string;
    browse(view: CollectionView<Raw>): string;
  };

  /** The keys the existing hooks already use; the scope adds no cache namespace. */
  keys: {
    root: QueryKey;
    list: QueryKey;
    capabilities: QueryKey;
    snapshot(id: string): QueryKey;
    itemOrder(id: string): QueryKey;
    preview(fingerprint: string): QueryKey;
  };

  toView(raw: Raw): CollectionView<Raw>;
  toDraft(
    view: CollectionView<Raw> | null,
    init: { kind: "manual" | "smart"; libraryId?: number | null },
  ): CollectionDraft;
  /** True when the acting profile may not change it. Fails closed while the profile is unknown. */
  isReadOnly(view: CollectionView<Raw>, actingProfileId: string | null | undefined): boolean;

  /** The list the scope's pages read; the same request and cache entry they use. */
  fetchList(): Promise<{ collections: Raw[] }>;
  fetchSnapshot(id: string): Promise<EditorSnapshot<Raw>>;
  /** `failedArtwork`: the slots whose upload or removal failed after the collection saved. */
  create(draft: SavableDraft): Promise<{ id: string } & SaveOutcome>;
  update(ref: { id: string; etag: string }, draft: SavableDraft): Promise<SaveOutcome>;
  remove(ref: { id: string; etag: string }): Promise<void>;
  sync(id: string): Promise<SyncOutcome>;
  preview(rules: QueryDefinition, limit: number): Promise<{ items: PreviewItem[]; total: number }>;
  invalidate(queryClient: QueryClient, id?: string): Promise<void>;
  errorMessage(error: unknown, fallback: string): string;
}

function withQuery(path: string, params: Record<string, string | number | null | undefined>) {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(name, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

function rulesFor(kind: CollectionKind, query: QueryDefinitionInput) {
  return kind === "smart"
    ? normalizeSmartCollectionLimit(normalizeQueryDefinition(query))
    : undefined;
}

/** Smart rules match the draft's libraries; the draft's list is the one the editor shows. */
function smartRules(draft: SavableDraft): QueryDefinition | undefined {
  return draft.kind === "smart" ? draftRules(draft) : undefined;
}

function sanitizeLibraryIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const ids = raw
    .filter((id): id is number => typeof id === "number" && Number.isFinite(id) && id > 0)
    .map((id) => Math.trunc(id));
  return Array.from(new Set(ids));
}

/**
 * The libraries a personal collection is restricted to. A synced list keeps
 * them in `source_config.library_ids`; a smart collection in its rules; a
 * manual collection has none.
 */
export function personalCollectionLibraryIds(collection: Collection): number[] {
  if (collection.collection_type === "manual") return [];
  const configured = collection.source_config?.library_ids;
  if (Array.isArray(configured)) return sanitizeLibraryIds(configured);
  return sanitizeLibraryIds(collection.query_definition?.library_ids);
}

function serverLibraryIds(collection: LibraryCollection): number[] {
  if (collection.library_ids?.length) return collection.library_ids;
  return collection.library_id ? [collection.library_id] : [];
}

function syncView(collection: WireCollection): CollectionView["sync"] {
  if (collectionKindOf(collection.collection_type) !== "synced") return undefined;
  return {
    status: collection.last_sync_status ?? "",
    message: collection.last_sync_message ?? "",
    lastAt: collection.last_sync_at || undefined,
    nextAt: collection.next_sync_at || undefined,
    schedule: collection.sync_schedule ?? "",
  };
}

function trimmedSource(slot: ArtworkSlotDraft | undefined) {
  return slot?.sourceUrl?.trim() || undefined;
}

/** Admin artwork errors read "poster: …" or "backdrop: …". */
function serverOutcome(artworkErrors: string[]): SaveOutcome {
  return {
    warnings: artworkErrors,
    failedArtwork: (["poster", "backdrop"] as const).filter((slot) =>
      artworkErrors.some((error) => error.startsWith(`${slot}:`)),
    ),
  };
}

function personalOutcome(posterError: string | undefined): SaveOutcome {
  return posterError
    ? { warnings: [posterError], failedArtwork: ["poster"] }
    : { warnings: [], failedArtwork: [] };
}

/** The slots whose saved image a save removes. */
function removedArtwork(draft: SavableDraft): ArtworkSlot[] {
  return (["poster", "backdrop"] as const).filter((slot) => draft.artwork[slot]?.remove);
}

function serverRequest(draft: SavableDraft): Omit<CreateLibraryCollectionRequest, "featured"> {
  return {
    library_ids: draft.libraryIds,
    title: draft.name,
    description: draft.description,
    collection_type: draft.kind,
    visibility: draft.server?.visibility ?? "visible",
    query_definition: smartRules(draft),
    sort_config: draft.kind === "smart" ? (draft.rawSortConfig ?? {}) : undefined,
    poster_source_url: trimmedSource(draft.artwork.poster),
    backdrop_source_url: trimmedSource(draft.artwork.backdrop),
  };
}

function personalFields(draft: SavableDraft) {
  return {
    name: draft.name,
    description: draft.description,
    is_shared: draft.personal?.shared ?? false,
    query_definition: smartRules(draft),
    sort_config: draft.kind === "smart" ? (draft.rawSortConfig ?? {}) : undefined,
    include_in_server_collections: draft.personal?.inLibraryTabs ?? false,
    display_query_definition: draft.kind === "manual" ? draft.showOnly : undefined,
  };
}

function personalMutationMessage(error: unknown, fallback: string) {
  if (error instanceof V2ProblemError && error.status === 412) {
    return "This collection changed while you were editing. Reload it and review your changes before saving again.";
  }
  return error instanceof Error ? error.message : fallback;
}

/** The admin preview also answers with paging state; the editor needs only items and total. */
function previewItems(value: { items: PreviewItem[]; total: number }) {
  return { items: value.items, total: value.total };
}

export const SERVER_SCOPE: CollectionScope<LibraryCollection> = {
  kind: "server",
  itemSource: "library",
  artworkSlots: ["poster", "backdrop"],
  requireLibraries: true,
  editorAwaitsList: true,
  allowPersonalizedRules: false,

  paths: {
    // A bare `?libraryId=N` opens that library's Arrange (older links), so a
    // library's List names its view.
    list: ({ libraryId, view = libraryId ? "list" : undefined } = {}) =>
      withQuery("/admin/collections", { libraryId, view }),
    create: ({ type, source, libraryId } = {}) =>
      withQuery("/admin/collections/new", { type, source, libraryId }),
    edit: (id, { libraryId, view, focus } = {}) =>
      withQuery(`/admin/collections/${encodeURIComponent(id)}/edit`, { libraryId, view, focus }),
    browse: (view) => buildLibraryCollectionCatalogHref(view.id, view.name),
  },

  keys: {
    root: ["admin", "collections"],
    list: adminKeys.collections(),
    capabilities: ["admin", "collections", "capabilities"],
    snapshot: (id) => ["admin", "collections", "edit", id],
    itemOrder: (id) => ["libraryCollections", "items", id, "order"],
    preview: (fingerprint) => collectionKeys.preview("admin", fingerprint),
  },

  toView: (raw) => ({
    id: raw.id,
    scope: "server",
    kind: collectionKindOf(raw.collection_type),
    source: syncedSourceOf(raw.collection_type, raw.source_config),
    name: raw.title,
    description: raw.description ?? "",
    posterUrl: raw.poster_url || undefined,
    posterThumbhash: raw.poster_thumbhash || undefined,
    backdropUrl: raw.backdrop_url || undefined,
    itemCount: raw.item_count ?? 0,
    libraryIds: serverLibraryIds(raw),
    sync: syncView(raw),
    server: {
      visibility: raw.visibility,
      pinFirst: raw.featured,
      managementKey: raw.management_key || undefined,
    },
    raw,
  }),

  toDraft: (view, { kind, libraryId }) => {
    const draftKind = view?.kind ?? kind;
    const libraryIds = view ? view.libraryIds : libraryId ? [libraryId] : [];
    return {
      kind: draftKind,
      name: view?.name ?? "",
      description: view?.description ?? "",
      libraryIds,
      rules: rulesFor(draftKind, { ...view?.raw.query_definition, library_ids: libraryIds }),
      rawSortConfig: view?.raw.sort_config ?? {},
      artwork: {},
      server: { visibility: view?.server?.visibility ?? "visible" },
    };
  },

  isReadOnly: () => false,

  fetchList: () => fetchAdminCollections(),

  async fetchSnapshot(id) {
    const { collection, etag } = await fetchAdminCollectionSnapshot(id);
    return { view: SERVER_SCOPE.toView(collection), etag };
  },

  async create(draft) {
    const request = serverRequest(draft);
    // Made in the editor, so not pinned: Pin is an Arrange action.
    const created = await v2("POST /api/v2/admin/collections", {
      body: adminCreateBody({ ...request, featured: false }),
    });
    const { artworkErrors } = await saveAdminArtwork(
      created,
      request,
      draft.artwork.poster?.file,
      draft.artwork.backdrop?.file,
    );
    return { id: created.id, ...serverOutcome(artworkErrors) };
  },

  async update(ref, draft) {
    const request = serverRequest(draft);
    const updated = await v2("PATCH /api/v2/admin/collections/{id}", {
      path: { id: ref.id },
      headers: { "If-Match": requiredETag(ref.etag) },
      // No `featured`: a stale editor must not undo a Pin set in Arrange.
      body: adminUpdateBody(request),
    });
    const { artworkErrors } = await saveAdminArtwork(
      updated,
      request,
      draft.artwork.poster?.file,
      draft.artwork.backdrop?.file,
      removedArtwork(draft),
    );
    return serverOutcome(artworkErrors);
  },

  async remove(ref) {
    await v2("DELETE /api/v2/admin/collections/{id}", {
      path: { id: ref.id },
      headers: { "If-Match": requiredETag(ref.etag) },
    });
  },

  async sync(id) {
    const run = await v2("POST /api/v2/admin/collections/{id}/sync", { path: { id } });
    return { status: run.status, message: run.message, itemsMatched: run.items_matched };
  },

  preview: (rules, limit) =>
    v2("POST /api/v2/admin/collections/preview", {
      body: { query_definition: rules, limit },
    }).then(previewItems),

  invalidate: (queryClient) => invalidateAdminCollectionQueries(queryClient),

  errorMessage: (error, fallback) => adminMutationMessage(error, fallback),
};

export const PERSONAL_SCOPE: CollectionScope<Collection> = {
  kind: "personal",
  itemSource: "user",
  artworkSlots: ["poster"],
  requireLibraries: false,
  editorAwaitsList: false,
  allowPersonalizedRules: true,

  paths: {
    list: () => "/collections",
    create: ({ type, source } = {}) => withQuery("/collections/new", { type, source }),
    edit: (id, { focus } = {}) =>
      withQuery(`/collections/${encodeURIComponent(id)}/edit`, { focus }),
    browse: (view) => buildUserCollectionCatalogHref(view.id, view.name),
  },

  keys: {
    root: collectionKeys.all,
    list: collectionKeys.list(),
    capabilities: ["collections", "capabilities"],
    snapshot: (id) => ["collections", "edit", id],
    itemOrder: (id) => ["collections", "items", id, "order"],
    preview: (fingerprint) => collectionKeys.preview("user", fingerprint),
  },

  toView: (raw) => ({
    id: raw.id,
    scope: "personal",
    kind: collectionKindOf(raw.collection_type),
    source: syncedSourceOf(raw.collection_type, raw.source_config),
    name: raw.name,
    description: raw.description ?? "",
    posterUrl: raw.poster_url || undefined,
    posterThumbhash: raw.poster_thumbhash || undefined,
    itemCount: raw.item_count ?? 0,
    libraryIds: personalCollectionLibraryIds(raw),
    ownerProfileId: raw.creator_profile_id,
    sync: syncView(raw),
    personal: {
      shared: raw.is_shared,
      inLibraryTabs: raw.include_in_server_collections ?? false,
    },
    raw,
  }),

  toDraft: (view, { kind }) => {
    const draftKind = view?.kind ?? kind;
    const libraryIds = view?.libraryIds ?? [];
    return {
      kind: draftKind,
      name: view?.name ?? "",
      description: view?.description ?? "",
      libraryIds,
      rules: rulesFor(draftKind, { ...view?.raw.query_definition, library_ids: libraryIds }),
      rawSortConfig: view?.raw.sort_config ?? {},
      showOnly: view?.raw.display_query_definition,
      artwork: {},
      personal: {
        shared: view?.personal?.shared ?? false,
        inLibraryTabs: view?.personal?.inLibraryTabs ?? false,
      },
    };
  },

  isReadOnly: (view, actingProfileId) =>
    !isOwnCollection({ creator_profile_id: view.ownerProfileId ?? "" }, actingProfileId),

  fetchList: () => v2("GET /api/v2/collections").then(collectionsFromV2),

  async fetchSnapshot(id) {
    const { collection, etag } = await fetchCollectionEditSnapshot(id);
    return { view: PERSONAL_SCOPE.toView(collection), etag };
  },

  async create(draft) {
    const body: CreateCollectionRequest = {
      ...personalFields(draft),
      collection_type: draft.kind,
      poster_source_url: trimmedSource(draft.artwork.poster),
    };
    const created = await v2("POST /api/v2/collections", { body: collectionCreateToV2(body) });
    const { posterError } = await saveCollectionPoster(created, draft.artwork.poster?.file);
    return { id: created.id, ...personalOutcome(posterError) };
  },

  async update(ref, draft) {
    const body: UpdateCollectionRequest = personalFields(draft);
    const updated = await v2("PATCH /api/v2/collections/{id}", {
      path: { id: ref.id },
      headers: { "If-Match": requiredETag(ref.etag) },
      body: collectionUpdateToV2(body),
    });
    const { posterError } = await saveCollectionPoster(
      updated,
      draft.artwork.poster?.file,
      trimmedSource(draft.artwork.poster),
      draft.artwork.poster?.remove,
    );
    return personalOutcome(posterError);
  },

  async remove(ref) {
    await v2("DELETE /api/v2/collections/{id}", {
      path: { id: ref.id },
      headers: { "If-Match": requiredETag(ref.etag) },
    });
  },

  async sync(id) {
    const result = syncFromV2(await v2("POST /api/v2/collections/{id}/sync", { path: { id } }));
    return { status: result.status, message: result.message, itemsMatched: result.items_matched };
  },

  preview: (rules, limit) =>
    v2("POST /api/v2/collections/preview", {
      body: previewToV2({ query_definition: rules, limit }),
    }).then(previewFromV2),

  async invalidate(queryClient, id) {
    await Promise.all([
      invalidateUserCollectionQueries(queryClient, id),
      // A collection shown on the Collections tab is listed in each library's tab.
      queryClient.invalidateQueries({ queryKey: libraryCollectionKeys.all }),
    ]);
  },

  errorMessage: personalMutationMessage,
};
