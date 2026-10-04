import {
  queryDefinitionFromSectionConfig,
  queryDefinitionToSectionConfig,
  type PageSectionConfig,
  type QueryDefinition,
  type SettingsSectionEntry,
} from "@/api/types";
import type { BulkCreateAdminSections } from "@/api/adminSections";
import type { CollectionOption } from "@/hooks/queries/useAllUserCollections";
import {
  finalizeSectionLibraryFilter,
  LIBRARY_FILTER_SECTION_TYPES,
} from "@/lib/sectionLibraryFilter";
import { FILTER_SECTION_TYPES, sectionTypeLabel } from "@/lib/sectionTypes";
import { randomUUID } from "@/lib/uuid";
import type { RowDraft } from "./rowDraft";
import type { PageRef } from "./types";

/** What the recipe gallery's config drawer hands its owner when the user adds a row. */
export interface AddPayload {
  section_type: string;
  title: string;
  item_limit: number;
  featured: boolean;
  enabled: boolean;
  config: Record<string, unknown>;
  apply_to_all_libraries?: boolean;
  library_ids?: number[];
}

interface BuildGalleryAddPayloadInput {
  sectionType: string;
  title: string;
  itemLimit: number;
  featured: boolean;
  enabled: boolean;
  config: Record<string, unknown>;
}

/**
 * The gallery drawer's add payload. With `bulkLibraryIds` it is the payload
 * the "Apply to all libraries" confirmation sends.
 */
export function buildGalleryAddPayload(
  { sectionType, title, itemLimit, featured, enabled, config }: BuildGalleryAddPayloadInput,
  bulkLibraryIds?: number[],
): AddPayload {
  const payload = {
    section_type: sectionType,
    title,
    item_limit: itemLimit,
    featured,
    enabled,
    config,
  };
  return bulkLibraryIds
    ? { ...payload, apply_to_all_libraries: true, library_ids: bulkLibraryIds }
    : { ...payload, apply_to_all_libraries: false };
}

/** The admin create request for one gallery add on the page the admin has open. */
export function buildGalleryCreateRequest(
  payload: AddPayload,
  scope: string,
  activeLibraryId: number | null,
): Partial<PageSectionConfig> {
  return {
    scope,
    ...(scope === "library" && activeLibraryId != null ? { library_id: activeLibraryId } : {}),
    section_type: payload.section_type,
    title: payload.title,
    item_limit: payload.item_limit,
    featured: payload.featured,
    enabled: payload.enabled,
    config: payload.config,
  };
}

/** The admin bulk create request for a gallery add applied to several library pages. */
export function buildGalleryBulkCreateRequest(
  payload: AddPayload,
  libraryIds: number[],
): BulkCreateAdminSections {
  return {
    scope: "library",
    library_ids: libraryIds,
    section_type: payload.section_type,
    title: payload.title,
    item_limit: payload.item_limit,
    featured: payload.featured,
    enabled: payload.enabled,
    config: payload.config,
  };
}

/** A gallery add on Settings > Home Screen, as a new profile-owned row. */
export function buildProfileGallerySection(
  payload: AddPayload,
  position: number,
): SettingsSectionEntry {
  return {
    id: randomUUID(),
    section_type: payload.section_type,
    title: payload.title,
    featured: payload.featured,
    item_limit: payload.item_limit,
    hidden: false,
    is_custom: true,
    customized: true,
    position,
    config: payload.config,
  };
}

function preserveGeneratedSectionMetadata(
  existingConfig: Record<string, unknown> | undefined,
  nextConfig: Record<string, unknown>,
): Record<string, unknown> {
  if (!existingConfig) {
    return nextConfig;
  }

  const merged = { ...nextConfig };
  if (typeof existingConfig.generated_source === "string" && existingConfig.generated_source) {
    merged.generated_source = existingConfig.generated_source;
  }
  if (
    typeof existingConfig.filter_library_id === "number" &&
    Number.isInteger(existingConfig.filter_library_id)
  ) {
    merged.filter_library_id = existingConfig.filter_library_id;
  }
  return merged;
}

type CollectionRowSurface = "profile" | "admin";

/**
 * The collection a collection row's config points at, or "" for none. Admin
 * rows read only `library_collection_id`: the admin endpoint rejects a row
 * without it, so a legacy `user_collection_id` there counts as no selection.
 */
export function collectionIdOf(
  config?: Record<string, unknown>,
  surface: CollectionRowSurface = "profile",
): string {
  const userValue = config?.user_collection_id;
  if (surface === "profile" && typeof userValue === "string" && userValue) return userValue;
  const libraryValue = config?.library_collection_id;
  return typeof libraryValue === "string" ? libraryValue : "";
}

/**
 * A collection row's config after an edit. An unchanged selection keeps the
 * stored config byte for byte, so a row whose collection isn't in the picker
 * list (still loading, or shared and since gone) keeps its id key. A newly
 * picked collection replaces both id keys with `key` and keeps the rest.
 * `stored` is the row's config only when the row already was a collection row;
 * `surface` decides which stored key counts as its selection (see collectionIdOf).
 */
function collectionRowConfig(
  stored: Record<string, unknown> | undefined,
  selectedCollectionId: string,
  key: "user_collection_id" | "library_collection_id",
  surface: CollectionRowSurface,
): Record<string, unknown> {
  if (stored && selectedCollectionId && collectionIdOf(stored, surface) === selectedCollectionId) {
    return { ...stored };
  }
  const rest = { ...stored };
  delete rest.user_collection_id;
  delete rest.library_collection_id;
  return { ...rest, [key]: selectedCollectionId };
}

export interface BuildProfileSectionSaveEntryInput {
  section: SettingsSectionEntry | null;
  sectionType: string;
  title: string;
  itemLimit: number;
  featured: boolean;
  queryDefinition: QueryDefinition;
  selectedCollectionId: string;
  recipeParams?: Record<string, unknown>;
  collections?: CollectionOption[];
}

export function buildProfileSectionSaveEntry({
  section,
  sectionType,
  title,
  itemLimit,
  featured,
  queryDefinition,
  selectedCollectionId,
  recipeParams,
  collections,
}: BuildProfileSectionSaveEntryInput): SettingsSectionEntry {
  let config: Record<string, unknown>;
  if (sectionType === "collection") {
    const selected = collections?.find((collection) => collection.id === selectedCollectionId);
    config = collectionRowConfig(
      section?.section_type === "collection" ? section.config : undefined,
      selectedCollectionId,
      selected?.source === "user" ? "user_collection_id" : "library_collection_id",
      "profile",
    );
  } else if (FILTER_SECTION_TYPES.has(sectionType)) {
    config = preserveGeneratedSectionMetadata(
      section?.config,
      queryDefinitionToSectionConfig(queryDefinition),
    );
  } else if (recipeParams && LIBRARY_FILTER_SECTION_TYPES.has(sectionType)) {
    // The params start from the section config and the library picker owns the
    // filter keys, so restoring the old filter_library_id would widen the selection.
    config = finalizeSectionLibraryFilter(recipeParams);
  } else {
    config = preserveGeneratedSectionMetadata(section?.config, recipeParams ?? {});
  }

  return {
    id: section?.id ?? randomUUID(),
    section_type: sectionType,
    title: title || sectionTypeLabel(sectionType),
    featured,
    item_limit: itemLimit,
    hidden: section?.hidden ?? false,
    is_custom: section?.is_custom ?? true,
    customized: section?.customized ?? false,
    position: section?.position ?? 0,
    config,
  };
}

export interface BuildAdminSectionPayloadInput {
  section: PageSectionConfig | null;
  scope: string;
  currentLibraryId: number | null;
  sectionType: string;
  title: string;
  itemLimit: number;
  featured: boolean;
  enabled: boolean;
  queryDefinition: QueryDefinition;
  selectedCollectionId: string;
  recipeParams?: Record<string, unknown>;
  collections?: CollectionOption[];
}

export function buildAdminSectionPayload({
  section,
  scope,
  currentLibraryId,
  sectionType,
  title,
  itemLimit,
  featured,
  enabled,
  queryDefinition,
  selectedCollectionId,
  recipeParams,
}: BuildAdminSectionPayloadInput): Partial<PageSectionConfig> & { id?: string } {
  const base = section?.section_type === sectionType ? { ...section.config } : {};
  let config: Record<string, unknown>;
  if (sectionType === "collection") {
    // Admin rows pick library collections only.
    config = collectionRowConfig(
      section?.section_type === "collection" ? base : undefined,
      selectedCollectionId,
      "library_collection_id",
      "admin",
    );
  } else if (FILTER_SECTION_TYPES.has(sectionType)) {
    // The editor replaces query fields, while keeping recipe metadata it does not edit.
    delete base.filter_type;
    delete base.filter_library_id;
    delete base.filter_library_ids;
    delete base.order;
    config = { ...base, ...queryDefinitionToSectionConfig(queryDefinition) };
  } else if (recipeParams && LIBRARY_FILTER_SECTION_TYPES.has(sectionType)) {
    // The library picker owns the filter keys; keeping the old ones from base
    // would re-add a replaced filter_library_id.
    delete base.filter_library_id;
    delete base.filter_library_ids;
    delete base.library_ids;
    config = finalizeSectionLibraryFilter({ ...base, ...recipeParams });
  } else {
    config = { ...base, ...recipeParams };
  }

  const safeTitle = title.trim() || sectionTypeLabel(sectionType);

  return {
    ...(section ? { id: section.id } : {}),
    scope,
    ...(scope === "library" && currentLibraryId != null ? { library_id: currentLibraryId } : {}),
    title: safeTitle,
    section_type: sectionType,
    item_limit: itemLimit,
    featured,
    enabled,
    config,
  };
}

/** Where a new single row goes: after every row on the page (0 on an empty page). */
export function nextAppendPosition(positions: readonly number[]): number {
  return positions.length === 0 ? 0 : Math.max(...positions) + 1;
}

/**
 * The create request for a row added from the Add row dialog. The body is
 * the recipe gallery's, byte for byte, plus `position`: the server stores the
 * position a single create sends, so without it a new row would land near
 * the top of the page.
 */
export function buildRowCreateRequest(
  draft: RowDraft,
  title: string,
  page: PageRef,
  position: number,
): Partial<PageSectionConfig> {
  const payload = buildGalleryAddPayload({
    sectionType: draft.sectionType,
    title,
    itemLimit: draft.itemLimit,
    featured: draft.hero,
    enabled: true,
    config: draft.config,
  });
  return {
    ...buildGalleryCreateRequest(
      payload,
      page.kind,
      page.kind === "library" ? page.libraryId : null,
    ),
    position,
  };
}

/**
 * The update request for a row saved from Edit row: the row editor's bytes.
 * The draft's config already starts from the stored config, so the builder
 * gets no base to merge back: a key the user's variant change removed stays
 * removed. `enabled` comes from the version being saved over.
 */
export function buildRowUpdateRequest(
  section: PageSectionConfig,
  draft: RowDraft,
  title: string,
): Partial<PageSectionConfig> & { id?: string } {
  return buildAdminSectionPayload({
    section: { ...section, config: {} },
    scope: section.scope,
    currentLibraryId: section.library_id,
    sectionType: draft.sectionType,
    title,
    itemLimit: draft.itemLimit,
    featured: draft.hero,
    enabled: section.enabled,
    queryDefinition: queryDefinitionFromSectionConfig(draft.config),
    selectedCollectionId: "",
    recipeParams: draft.config,
  });
}
