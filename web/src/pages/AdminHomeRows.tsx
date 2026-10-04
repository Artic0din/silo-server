import { useMemo, useRef, useState } from "react";
import type { Library, LibraryCollection, PageSectionConfig } from "@/api/types";
import {
  useBulkCreateSections,
  useCreateSection,
  useUpdateSection,
  useDeleteSection,
  useDeleteSections,
  useRestoreDefaultSections,
} from "@/hooks/queries/sections";
import RecipeGalleryModal from "@/components/RecipeGallery/RecipeGalleryModal";
import RecipeConfigDrawer from "@/components/RecipeGallery/RecipeConfigDrawer";
import type { AddPayload } from "@/components/RecipeGallery/RecipeConfigDrawer";
import { buildGalleryBulkCreateRequest, buildGalleryCreateRequest } from "@/lib/homeRows/payloads";
import type { RecipeDefinition, GalleryPreset } from "@/lib/recipes";
import { fetchRecipeCatalog } from "@/lib/recipes";
import { useQuery } from "@tanstack/react-query";
import { useAdminCollections, useImportTraktCollection } from "@/hooks/queries/admin/collections";
import { useAdminLibraries } from "@/hooks/queries/admin/libraries";
import { useAdminHomeRows } from "@/hooks/queries/homeRows/useAdminHomeRows";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Pencil, Plus, RotateCcw, Star, StarOff, Trash2 } from "lucide-react";

import { toast } from "sonner";
import {
  fetchAdminSectionSnapshot,
  fetchAdminSectionDeleteTargets,
  fetchAdminSectionOrderSnapshot,
} from "@/api/adminSections";
import { V2ProblemError } from "@/api/v2/request";
import SectionEditorDrawer from "@/components/sections/SectionEditorDrawer";
import { HomeRowsPage, type SharedRowMenuItems } from "@/components/homeRows/HomeRowsPage";
import { DeleteRowDialog } from "@/components/homeRows/DeleteRowDialog";
import type { RowMenuItem } from "@/components/homeRows/RowMenu";
import { useRowFocus } from "@/components/homeRows/useRowFocus";
import { pageLabel, pageParam } from "@/lib/homeRows/pages";
import type { HomeRow } from "@/lib/homeRows/types";
import {
  createAdminSectionCreation,
  runAdminSectionCreation,
  type AdminSectionCreation,
} from "@/lib/adminSectionCreation";
import { updateCheckboxSelection } from "@/lib/checkboxSelection";

interface TraktPublicRecipeConfig {
  preset: "trending" | "popular";
  mediaType: "movie" | "tv";
}

function getTraktRecipeConfig(config: Record<string, unknown>): TraktPublicRecipeConfig | null {
  if (config.source_provider !== "trakt") return null;
  const preset = config.source_preset;
  const mediaType = config.media_type;
  if (
    (preset !== "trending" && preset !== "popular") ||
    (mediaType !== "movie" && mediaType !== "tv")
  ) {
    return null;
  }
  return { preset, mediaType };
}

function isMatchingTraktCollection(
  collection: LibraryCollection,
  preset: string,
  mediaType: string,
  libraryID: number,
) {
  return (
    collection.management_mode === "section" &&
    collection.management_key ===
      buildTraktSectionManagedCollectionKey(preset, mediaType, libraryID) &&
    collection.collection_type === "trakt" &&
    collection.library_id === libraryID &&
    collection.source_config?.preset === preset &&
    collection.source_config?.media_type === mediaType
  );
}

function buildTraktSectionManagedCollectionKey(
  preset: string,
  mediaType: string,
  libraryID: number,
) {
  return `trakt:${preset}:${mediaType}:library:${libraryID}`;
}

function findDefaultTraktLibrary(libraries: Library[], mediaType: string): number | null {
  const wantedType = mediaType === "tv" ? "series" : "movies";
  return libraries.find((library) => library.type === wantedType)?.id ?? libraries[0]?.id ?? null;
}

export default function AdminHomeRows() {
  const adapter = useAdminHomeRows();
  const { scope, capabilities } = adapter;
  const activeLibraryId = adapter.libraryId ?? null;
  const currentPageKey = pageParam(adapter.page);
  const currentPageLabel = pageLabel(adapter.page, adapter.pages);
  const { data: librariesData } = useAdminLibraries();
  const librariesList = useMemo(() => librariesData ?? [], [librariesData]);
  const focus = useRowFocus(adapter.rows, adapter.pending);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const snapshotRequest = useRef(0);
  const [editingETag, setEditingETag] = useState<string | null>(null);
  const [editConflict, setEditConflict] = useState(false);
  const [deleteETag, setDeleteETag] = useState<string | null>(null);
  const [deleteConflict, setDeleteConflict] = useState(false);
  const deletedRow = useRef(false);
  const [deleteTargets, setDeleteTargets] = useState<
    Awaited<ReturnType<typeof fetchAdminSectionDeleteTargets>>
  >([]);
  const [restoreSnapshot, setRestoreSnapshot] = useState<Awaited<
    ReturnType<typeof fetchAdminSectionOrderSnapshot>
  > | null>(null);
  const [restoreConflict, setRestoreConflict] = useState(false);
  const { data: collectionsData = [] } = useAdminCollections();
  const { data: recipeCatalog } = useQuery({
    queryKey: ["recipe-catalog"],
    queryFn: fetchRecipeCatalog,
    staleTime: 5 * 60 * 1000,
  });
  const collectionTitles = useMemo(
    () => new Map(collectionsData.map((collection) => [collection.id, collection.title])),
    [collectionsData],
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSection, setEditingSection] = useState<PageSectionConfig | null>(null);
  const [confirmDeleteSection, setConfirmDeleteSection] = useState<PageSectionConfig | null>(null);
  const [confirmDeleteSelected, setConfirmDeleteSelected] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  // Selection belongs to one page; switching pages starts with nothing selected.
  const [selection, setSelection] = useState<{ page: string; ids: Set<string> }>({
    page: currentPageKey,
    ids: new Set(),
  });
  const selectedSectionIds = useMemo(
    () => (selection.page === currentPageKey ? selection.ids : new Set<string>()),
    [selection, currentPageKey],
  );
  const selectionAnchorRef = useRef<string | null>(null);
  const deleteMutation = useDeleteSection();
  const deleteSectionsMutation = useDeleteSections();
  const restoreDefaultsMutation = useRestoreDefaultSections();
  const [confirmRestoreOpen, setConfirmRestoreOpen] = useState(false);
  const [resetProfiles, setResetProfiles] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [pickedRecipe, setPickedRecipe] = useState<{
    def: RecipeDefinition;
    preset: GalleryPreset;
  } | null>(null);
  const createFromGalleryMutation = useCreateSection();
  const importTraktMutation = useImportTraktCollection();
  const createMutation = useCreateSection();
  const bulkCreateMutation = useBulkCreateSections();
  const updateMutation = useUpdateSection();
  const [creation, setCreation] = useState<{ state: AdminSectionCreation; scope: string } | null>(
    null,
  );
  const [creationRunning, setCreationRunning] = useState(false);
  const creationRunningRef = useRef(false);

  const creationUnresolved = Boolean(
    creation?.state.targets.some((target) => target.status !== "complete"),
  );

  const rowIds = useMemo(() => adapter.rows.map((row) => row.id), [adapter.rows]);
  const selectedSections = useMemo(
    () => adapter.sections.filter((section) => selectedSectionIds.has(section.id)),
    [adapter.sections, selectedSectionIds],
  );
  const canManageCurrentScope = adapter.canEdit;

  function setSelectedSectionIds(update: (previous: Set<string>) => Set<string>) {
    setSelection((current) => ({
      page: currentPageKey,
      ids: update(current.page === currentPageKey ? current.ids : new Set()),
    }));
  }

  function clearSectionSelection() {
    setSelectedSectionIds(() => new Set());
    selectionAnchorRef.current = null;
  }

  function updateSectionSelection(sectionId: string, checked: boolean, extendRange: boolean) {
    const anchorId = extendRange && selectedSectionIds.size > 0 ? selectionAnchorRef.current : null;
    setSelectedSectionIds((previous) =>
      updateCheckboxSelection(previous, rowIds, anchorId, sectionId, checked, extendRange),
    );
    if (anchorId === null || !rowIds.includes(anchorId)) {
      selectionAnchorRef.current = sectionId;
    }
  }

  async function prepareSnapshot(action: () => Promise<void>) {
    setSnapshotLoading(true);
    try {
      await action();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load the current rows");
    } finally {
      setSnapshotLoading(false);
    }
  }

  function sectionFor(row: HomeRow) {
    return adapter.sections.find((section) => section.id === row.id);
  }

  function handleDelete(section: PageSectionConfig) {
    const request = ++snapshotRequest.current;
    void prepareSnapshot(async () => {
      const snapshot = await fetchAdminSectionSnapshot(section.id);
      if (request !== snapshotRequest.current) return;
      deletedRow.current = false;
      setConfirmDeleteSection(snapshot.section);
      setDeleteETag(snapshot.etag);
      setDeleteConflict(false);
    });
  }

  function handleEdit(section: PageSectionConfig) {
    const request = ++snapshotRequest.current;
    void prepareSnapshot(async () => {
      const snapshot = await fetchAdminSectionSnapshot(section.id);
      if (request !== snapshotRequest.current) return;
      setEditingSection(snapshot.section);
      setEditingETag(snapshot.etag);
      setEditConflict(false);
      setDialogOpen(true);
    });
  }

  function confirmDeleteRow() {
    if (!confirmDeleteSection || !deleteETag) return;
    const id = confirmDeleteSection.id;
    deleteMutation.mutate(
      { id, etag: deleteETag },
      {
        onSuccess: () => {
          deletedRow.current = true;
          focus.afterRemoval(id);
          setConfirmDeleteSection(null);
        },
        onError: (error) => {
          setDeleteConflict(error instanceof V2ProblemError && error.status === 412);
          toast.error(error instanceof Error ? error.message : "Could not delete this row");
        },
      },
    );
  }

  function prepareBulkDelete(all: boolean) {
    const ids = all ? rowIds : selectedSections.map((section) => section.id);
    if (ids.length > 100) {
      toast.error("Select at most 100 sections per deletion.");
      return;
    }
    const request = ++snapshotRequest.current;
    void prepareSnapshot(async () => {
      const targets = await fetchAdminSectionDeleteTargets(ids);
      if (request !== snapshotRequest.current) return;
      setDeleteTargets(targets);
      setConfirmDeleteAll(all);
      setConfirmDeleteSelected(!all);
    });
  }

  function openRestore() {
    const request = ++snapshotRequest.current;
    void prepareSnapshot(async () => {
      const snapshot = await fetchAdminSectionOrderSnapshot(scope, activeLibraryId ?? undefined);
      if (request !== snapshotRequest.current) return;
      setRestoreSnapshot(snapshot);
      setRestoreConflict(false);
      setConfirmRestoreOpen(true);
    });
  }

  function rowMenuItems(row: HomeRow, shared: SharedRowMenuItems): RowMenuItem[] {
    const section = sectionFor(row);
    const busy = !canManageCurrentScope || snapshotLoading || !section;
    return [
      {
        key: "edit",
        label: "Edit row…",
        icon: Pencil,
        disabled: busy,
        onSelect: () => section && handleEdit(section),
      },
      {
        key: "hero",
        label: row.hero ? "Stop using as hero banner" : "Use as hero banner",
        icon: row.hero ? StarOff : Star,
        disabled: !canManageCurrentScope,
        onSelect: () => void adapter.setHero(row.id, !row.hero),
      },
      shared.moveToTop,
      shared.moveToBottom,
      {
        key: "delete",
        label: "Delete row…",
        icon: Trash2,
        destructive: true,
        group: true,
        disabled: busy,
        onSelect: () => section && handleDelete(section),
      },
    ];
  }

  const sectionDeletionNotice =
    "Silo will also try to remove section-managed collections that are no longer referenced. This action cannot be undone.";
  const deleteProgressLabel = `Deleting ${deleteSectionsMutation.progress?.completed ?? 0} of ${deleteSectionsMutation.progress?.total ?? deleteTargets.length} sections`;

  function handleDeleteCapturedSections() {
    deleteSectionsMutation.mutate(deleteTargets, {
      onSuccess: (result) => {
        setSelectedSectionIds(() => new Set(result.failedIds));
        setConfirmDeleteAll(false);
        setConfirmDeleteSelected(false);
      },
    });
  }

  function normalizeLibraryIDs(ids: number[] | undefined): number[] {
    if (!ids || ids.length === 0) return [];
    return Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)));
  }

  async function ensureTraktSectionCollection(
    payload: AddPayload,
    traktRecipe: TraktPublicRecipeConfig,
    libraryID: number,
  ): Promise<LibraryCollection> {
    const existing = collectionsData.find((collection) =>
      isMatchingTraktCollection(collection, traktRecipe.preset, traktRecipe.mediaType, libraryID),
    );
    if (existing) return existing;

    const managementKey = buildTraktSectionManagedCollectionKey(
      traktRecipe.preset,
      traktRecipe.mediaType,
      libraryID,
    );
    const imported = await importTraktMutation.mutateAsync({
      body: {
        library_id: libraryID,
        title: payload.title,
        description: "",
        preset: traktRecipe.preset,
        media_type: traktRecipe.mediaType,
        limit: payload.item_limit,
        featured: payload.featured,
        management_mode: "section",
        management_source: "recipe_gallery",
        management_key: managementKey,
      },
    });
    return imported.collection;
  }

  async function runTraktCreation(state: AdminSectionCreation, targetScope: string) {
    if (creationRunningRef.current) return;
    creationRunningRef.current = true;
    setCreationRunning(true);
    setCreation({ state, scope: targetScope });
    try {
      const result = await runAdminSectionCreation(state, {
        resolveCollection: async (payload, libraryID) => {
          const recipe = getTraktRecipeConfig(payload.config);
          if (!recipe) throw new Error("This recipe no longer identifies a Trakt list");
          return (await ensureTraktSectionCollection(payload, recipe, libraryID)).id;
        },
        createSection: async (payload, libraryID, collectionID) => {
          const created = await createMutation.mutateAsync({
            scope: targetScope,
            ...(targetScope === "library" ? { library_id: libraryID } : {}),
            section_type: payload.section_type,
            title: payload.title,
            item_limit: payload.item_limit,
            featured: payload.featured,
            enabled: payload.enabled,
            config: { ...payload.config, library_collection_id: collectionID },
          });
          return created.id;
        },
        onProgress: (next) => setCreation({ state: next, scope: targetScope }),
      });
      const completed = result.targets.filter((target) => target.status === "complete").length;
      if (completed === result.targets.length)
        toast.success(`Created ${completed} section${completed === 1 ? "" : "s"}`);
      else
        toast.warning(
          `Created ${completed} of ${result.targets.length} sections. Review the remaining targets below.`,
        );
      setCreation({ state: result, scope: targetScope });
    } finally {
      creationRunningRef.current = false;
      setCreationRunning(false);
    }
  }

  async function createBulkSectionsFromGallery(
    payload: AddPayload,
    libraryIDs: number[],
  ): Promise<void> {
    if (libraryIDs.length === 0) {
      throw new Error("Choose at least one library before applying this section");
    }

    const config = payload.config;
    const traktRecipe = getTraktRecipeConfig(config);
    const selectedCollectionID =
      typeof config.library_collection_id === "string" ? config.library_collection_id.trim() : "";
    if (traktRecipe && selectedCollectionID === "") {
      await runTraktCreation(createAdminSectionCreation(payload, libraryIDs), "library");
      return;
    }

    const result = await bulkCreateMutation.mutateAsync(
      buildGalleryBulkCreateRequest(payload, libraryIDs),
    );
    toast.success(`Created ${result.created} section${result.created === 1 ? "" : "s"}`);
  }

  async function createSectionFromGallery(payload: AddPayload) {
    const bulkLibraryIDs = normalizeLibraryIDs(payload.library_ids);
    if (payload.apply_to_all_libraries || bulkLibraryIDs.length > 0) {
      await createBulkSectionsFromGallery(payload, bulkLibraryIDs);
      return;
    }

    const config = payload.config;
    const traktRecipe = getTraktRecipeConfig(config);
    const selectedCollectionID =
      typeof config.library_collection_id === "string" ? config.library_collection_id.trim() : "";
    if (traktRecipe && selectedCollectionID === "") {
      const targetLibraryID =
        activeLibraryId ?? findDefaultTraktLibrary(librariesList, traktRecipe.mediaType);
      if (!targetLibraryID) {
        throw new Error("Choose a library before adding this Trakt section");
      }
      await runTraktCreation(createAdminSectionCreation(payload, [targetLibraryID]), scope);
      return;
    }

    await createFromGalleryMutation.mutateAsync(
      buildGalleryCreateRequest(payload, scope, activeLibraryId),
    );
  }

  return (
    <div
      aria-busy={deleteSectionsMutation.isPending}
      inert={deleteSectionsMutation.isPending ? true : undefined}
    >
      <HomeRowsPage
        adapter={adapter}
        title="Home rows"
        subtitle="The rows everyone sees on Home and on library pages. Profiles can still hide, rename or reorder them."
        focus={focus}
        collectionTitle={(id) => collectionTitles.get(id)}
        onOpenRow={(row) => {
          const section = sectionFor(row);
          if (section && canManageCurrentScope && !snapshotLoading) handleEdit(section);
        }}
        rowMenuItems={rowMenuItems}
        selection={{
          selectedIds: selectedSectionIds,
          onChange: updateSectionSelection,
          onClear: clearSectionSelection,
          label: (row) => `Select ${row.title}`,
        }}
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={
                !canManageCurrentScope || snapshotLoading || restoreDefaultsMutation.isPending
              }
              onClick={openRestore}
            >
              <RotateCcw className="mr-1 h-4 w-4" /> Restore Defaults
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={
                !canManageCurrentScope || snapshotLoading || creationRunning || creationUnresolved
              }
              onClick={() => setGalleryOpen(true)}
            >
              <Plus className="mr-1 h-4 w-4" /> Add from Gallery
            </Button>
            <Button
              ref={focus.attachAddButton}
              size="sm"
              disabled={
                !canManageCurrentScope || snapshotLoading || creationRunning || creationUnresolved
              }
              onClick={() => {
                setEditingSection(null);
                setEditingETag(null);
                setEditConflict(false);
                setDialogOpen(true);
              }}
            >
              <Plus className="mr-1 h-4 w-4" /> Add Section
            </Button>
            {selectedSections.length > 0 ? (
              <>
                <Badge variant="secondary">{selectedSections.length} selected</Badge>
                <Button size="sm" variant="ghost" onClick={clearSectionSelection}>
                  Clear
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={
                    snapshotLoading ||
                    selectedSections.length > 100 ||
                    deleteSectionsMutation.isPending ||
                    !canManageCurrentScope
                  }
                  onClick={() => prepareBulkDelete(false)}
                >
                  <Trash2 data-icon="inline-start" /> Delete Selected
                </Button>
              </>
            ) : null}
            {adapter.rows.length > 0 ? (
              <Button
                size="sm"
                variant="destructive"
                disabled={
                  snapshotLoading ||
                  adapter.rows.length > 100 ||
                  deleteSectionsMutation.isPending ||
                  restoreDefaultsMutation.isPending ||
                  !canManageCurrentScope
                }
                onClick={() => prepareBulkDelete(true)}
              >
                {deleteSectionsMutation.isPending ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-1 h-4 w-4" />
                )}
                {deleteSectionsMutation.isPending ? `${deleteProgressLabel}…` : "Delete All"}
              </Button>
            ) : null}
          </>
        }
        notices={
          <>
            {creation && (
              <div className="surface-panel space-y-2 rounded-xl p-4" role="status">
                <p>
                  {creation.state.targets.filter((target) => target.status === "complete").length}{" "}
                  of {creation.state.targets.length} sections created for "
                  {creation.state.payload.title}".
                </p>
                {creation.state.targets.map((target) => (
                  <p key={target.libraryID}>
                    {librariesList.find((library) => library.id === target.libraryID)?.name ??
                      `Library ${target.libraryID}`}
                    : {target.status === "complete" ? "Created" : target.status.replace(/_/g, " ")}
                    {target.collectionID ? ` · Collection ${target.collectionID}` : ""}
                    {target.error ? ` · ${target.error}` : ""}
                  </p>
                ))}
                {creation.state.targets.some(
                  (target) =>
                    target.status === "import_unknown" || target.status === "section_unknown",
                ) && (
                  <p role="alert">
                    A creation response was not confirmed. Review Collections and Sections before
                    creating that target again; it will not be retried automatically.
                  </p>
                )}
                {creation.state.targets.some(
                  (target) => target.status === "section_failed" || target.status === "pending",
                ) && (
                  <Button
                    disabled={creationRunning}
                    onClick={() => void runTraktCreation(creation.state, creation.scope)}
                  >
                    Retry remaining sections
                  </Button>
                )}
                {!creationRunning && creationUnresolved && (
                  <Button variant="outline" onClick={() => setCreation(null)}>
                    Finish review and clear tracking
                  </Button>
                )}
                {!creationRunning &&
                  creation.state.targets.every((target) => target.status === "complete") && (
                    <Button variant="ghost" onClick={() => setCreation(null)}>
                      Dismiss
                    </Button>
                  )}
              </div>
            )}

            {(adapter.rows.length > 100 || selectedSections.length > 100) && (
              <p role="status">Select up to 100 sections per deletion. </p>
            )}
            {snapshotLoading && <p role="status">Loading current section details…</p>}
          </>
        }
      >
        <DeleteRowDialog
          rowTitle={confirmDeleteSection?.title ?? ""}
          pageLabel={currentPageLabel}
          open={confirmDeleteSection !== null}
          conflict={deleteConflict}
          busy={deleteMutation.isPending}
          canConfirm={Boolean(deleteETag) && !snapshotLoading}
          onConfirm={confirmDeleteRow}
          onReload={() => {
            if (confirmDeleteSection) handleDelete(confirmDeleteSection);
          }}
          onOpenChange={(open) => {
            if (!open) {
              snapshotRequest.current++;
              setConfirmDeleteSection(null);
            }
          }}
          onCloseAutoFocus={(event) => {
            // After a delete the row's menu is about to go; focus moves to its
            // neighbour once the list refetches.
            if (deletedRow.current) event.preventDefault();
          }}
        />
        <Dialog
          open={confirmDeleteSelected || confirmDeleteAll}
          onOpenChange={(open) => {
            if (!open && !deleteSectionsMutation.isPending) {
              setConfirmDeleteSelected(false);
              setConfirmDeleteAll(false);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {confirmDeleteAll ? "Delete all sections" : "Delete selected sections"}
              </DialogTitle>
            </DialogHeader>
            <p>
              Delete {deleteTargets.length} captured sections? {sectionDeletionNotice}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                disabled={deleteSectionsMutation.isPending}
                onClick={() => {
                  setConfirmDeleteSelected(false);
                  setConfirmDeleteAll(false);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={deleteSectionsMutation.isPending}
                onClick={handleDeleteCapturedSections}
              >
                Delete {deleteTargets.length} sections
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        <Dialog
          open={confirmRestoreOpen}
          onOpenChange={(open) => {
            if (restoreDefaultsMutation.isPending) return;
            setConfirmRestoreOpen(open);
            if (!open) {
              snapshotRequest.current++;
              setResetProfiles(false);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Restore Default Sections</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-muted-foreground text-sm">
                This will replace all {restoreSnapshot?.scope === "home" ? "home" : "library"}{" "}
                sections with the defaults. Any custom sections will be removed.
              </p>
              <div className="flex items-center gap-2">
                <Switch
                  id="resetProfiles"
                  size="sm"
                  disabled={!capabilities?.reset_profiles || restoreDefaultsMutation.isPending}
                  checked={resetProfiles}
                  onCheckedChange={(checked) => setResetProfiles(checked === true)}
                />
                <Label htmlFor="resetProfiles" className="text-sm font-normal">
                  Also reset all user customizations for this scope
                </Label>
              </div>
              {restoreConflict && (
                <p role="alert">
                  Sections changed. Reload the current scope before restoring defaults.
                </p>
              )}
              {!capabilities?.reset_profiles && (
                <p className="text-muted-foreground text-sm">
                  Resetting user customizations is unavailable on this server.
                </p>
              )}
              <div className="flex justify-end gap-2">
                {restoreConflict && (
                  <Button disabled={snapshotLoading} onClick={openRestore}>
                    Reload sections
                  </Button>
                )}
                <Button
                  variant="outline"
                  disabled={restoreDefaultsMutation.isPending}
                  onClick={() => {
                    snapshotRequest.current++;
                    setConfirmRestoreOpen(false);
                    setResetProfiles(false);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  disabled={
                    restoreDefaultsMutation.isPending || restoreConflict || !restoreSnapshot
                  }
                  onClick={() => {
                    restoreDefaultsMutation.mutate(
                      {
                        scope: restoreSnapshot!.scope,
                        ...(restoreSnapshot!.library_id != null
                          ? { library_id: Number(restoreSnapshot!.library_id) }
                          : {}),
                        etag: restoreSnapshot!.etag,
                        reset_profiles: Boolean(capabilities?.reset_profiles && resetProfiles),
                      },
                      {
                        onSuccess: () => {
                          toast.success("Sections restored to defaults");
                          setConfirmRestoreOpen(false);
                          setResetProfiles(false);
                        },
                        onError: (error) => {
                          setRestoreConflict(
                            error instanceof V2ProblemError && error.status === 412,
                          );
                          toast.error("Failed to restore defaults");
                        },
                      },
                    );
                  }}
                >
                  Restore Defaults
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <SectionEditorDrawer
          mode="admin"
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) {
              snapshotRequest.current++;
              setEditingSection(null);
            }
          }}
          section={editingSection}
          conflict={editConflict}
          onReload={() => {
            if (editingSection) handleEdit(editingSection);
          }}
          scope={editingSection?.scope ?? scope}
          currentLibraryId={editingSection ? editingSection.library_id : activeLibraryId}
          libraries={librariesList}
          recipeCatalog={recipeCatalog}
          isSubmitting={
            createMutation.isPending || updateMutation.isPending || bulkCreateMutation.isPending
          }
          onSave={(section) => {
            if (section.id) {
              updateMutation.mutate(
                { ...section, id: section.id, etag: editingETag! },
                {
                  onSuccess: () => {
                    setDialogOpen(false);
                    setEditingSection(null);
                  },
                  onError: (error) => {
                    setEditConflict(error instanceof V2ProblemError && error.status === 412);
                    toast.error(
                      error instanceof Error ? error.message : "Failed to update section",
                    );
                  },
                },
              );
            } else {
              createMutation.mutate(section, {
                onSuccess: () => {
                  setDialogOpen(false);
                  setEditingSection(null);
                },
                onError: (error) => {
                  toast.error(error instanceof Error ? error.message : "Failed to create section");
                },
              });
            }
          }}
        />

        <RecipeGalleryModal
          open={galleryOpen}
          onClose={() => setGalleryOpen(false)}
          onPick={(def, preset) => {
            setGalleryOpen(false);
            setPickedRecipe({ def, preset });
          }}
        />

        {pickedRecipe && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <RecipeConfigDrawer
              libraryCollectionsOnly
              libraryScoped={scope === "library"}
              showBulkApply={scope === "library"}
              libraries={librariesList}
              def={pickedRecipe.def}
              preset={pickedRecipe.preset}
              onCancel={() => setPickedRecipe(null)}
              onBackToGallery={() => {
                setPickedRecipe(null);
                setGalleryOpen(true);
              }}
              onAdd={async (payload) => {
                try {
                  await createSectionFromGallery(payload);
                  setPickedRecipe(null);
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Failed to create section");
                  throw error;
                }
              }}
            />
          </div>
        )}
      </HomeRowsPage>
    </div>
  );
}
