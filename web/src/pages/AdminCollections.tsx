import { toast } from "sonner";
import {
  fetchAdminCollectionSnapshot,
  fetchAdminGroupSnapshot,
  prepareAdminCollectionDeletes,
  adminMutationMessage,
} from "@/api/adminCollections";
import type { AdminCollectionDeleteSnapshot } from "@/api/adminCollections";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AdminJob, LibraryCollection, LibraryCollectionGroup } from "@/api/types";
import { V2ProblemError } from "@/api/v2/request";
import { useAdminLibraries } from "@/hooks/queries/admin/libraries";
import {
  useAdminCollectionsBoard,
  useCreateCollectionGroup,
  useUpdateCollectionGroup,
  useDeleteCollectionGroup,
} from "@/hooks/queries/admin/collectionGroups";
import {
  useAdminCollectionCapabilities,
  useAdminCollections,
  useDeleteAdminCollections,
  useSetAdminCollectionVisibility,
  useTemplateBundleApplyJobs,
} from "@/hooks/queries/admin/collections";
import { useScopeSync } from "@/hooks/queries/collectionScope";
import { invalidateAdminCollectionQueries } from "@/hooks/queries/collectionSurfaceRefresh";
import { sectionKeys } from "@/hooks/queries/keys";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useEventChannel } from "@/components/realtimeEventsContext";
import { CalmPage } from "@/components/calm/CalmPage";
import { PageMoreMenu, type PageMoreMenuItem } from "@/components/calm/PageMoreMenu";
import { PillSwitcher } from "@/components/calm/PillSwitcher";
import { CollectionActionsMenu } from "@/components/collections/CollectionActionsMenu";
import { HideCollectionDialog } from "@/components/collections/HideCollectionDialog";
import {
  CollectionColumnHeader,
  CollectionListItem,
} from "@/components/collections/admin/CollectionListItem";
import { GroupsBoard } from "@/components/collections/admin/GroupsBoard";
import { GroupEditDialog } from "@/components/collections/admin/GroupEditDialog";
import { MobileDockBar } from "@/components/homeRows/MobileDockBar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  AlertCircle,
  CheckCircle2,
  Info,
  Layers,
  LayoutGrid,
  Library as LibraryIcon,
  List,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { CollectionTemplateGallery } from "@/components/CollectionTemplateGallery";
import {
  collectionLibraryIds,
  countByLibrary,
  filterAdminCollections,
  readAdminListState,
  writeAdminListState,
  type AdminListState,
  type AdminListView,
  type KindFilter,
} from "@/lib/collections/adminList";
import { COLLECTION_IN_USE, serverDeleteDescription } from "@/lib/collections/copy";
import { listReturnState } from "@/lib/collections/listReturn";
import { serverCollectionPeek } from "@/lib/collections/peek";
import { SERVER_SCOPE } from "@/lib/collections/scope";
import { COLLECTION_KIND_LABEL, isListBackedCollectionType } from "@/lib/collections/types";
import { cn } from "@/lib/utils";
import { buildLibraryCollectionCatalogHref } from "./catalogSearchParams";
import { collectionsInAdminScope } from "./adminCollectionsShared";

/** Under this width More and New collection move to a bar docked at the bottom. */
const NARROW_QUERY = "(max-width: 1023px)";
const ALL_LIBRARIES = "all";

const KIND_OPTIONS: ReadonlyArray<{ value: KindFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "manual", label: COLLECTION_KIND_LABEL.manual },
  { value: "smart", label: COLLECTION_KIND_LABEL.smart },
  { value: "synced", label: COLLECTION_KIND_LABEL.synced },
];

/** A collection being deleted from the list or the board, read fresh for its ETag. */
interface PendingDelete {
  collection: LibraryCollection;
  etag: string;
  error: string | null;
}

function deleteErrorMessage(error: unknown): string {
  if (
    error instanceof V2ProblemError &&
    error.status === 409 &&
    error.problemType === "collection_in_use"
  )
    return COLLECTION_IN_USE;
  return SERVER_SCOPE.errorMessage(error, "Couldn't delete it");
}

/**
 * Server collections: the List of every collection (`?view=list`, the
 * default) and a library's shelves (`?view=arrange&libraryId=N`). The URL
 * holds the view, library, type, search and failed-sync filter, and editors
 * opened from here come back to it.
 */
export default function AdminCollections() {
  useDocumentTitle("Collections");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const state = readAdminListState(searchParams);
  const narrow = useMediaQuery(NARROW_QUERY);
  const libraries = useAdminLibraries();
  const libraryList = useMemo(() => libraries.data ?? [], [libraries.data]);
  const libraryNames = useMemo(
    () => new Map(libraryList.map((library) => [library.id, library.name])),
    [libraryList],
  );
  const arrangeLibraryId =
    state.view === "arrange" ? (state.libraryId ?? libraryList[0]?.id ?? null) : null;
  const activeLibraryId = state.view === "arrange" ? arrangeLibraryId : state.libraryId;
  const listHref = `${location.pathname}${location.search}`;

  const [galleryOpen, setGalleryOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<{
    mode: "create" | "edit";
    id?: string;
    snapshot?: Awaited<ReturnType<typeof fetchAdminGroupSnapshot>>;
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  // The Delete button closes its dialog as it's pressed; keep it open for the answer.
  const holdDeleteOpen = useRef(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [confirmDeleteSelected, setConfirmDeleteSelected] = useState(false);
  const [selectedCollectionIds, setSelectedCollectionIds] = useState<Set<string>>(new Set());
  const [hiding, setHiding] = useState<LibraryCollection | null>(null);
  // The switch runs ahead of the list while a change saves.
  const [visibilityOverrides, setVisibilityOverrides] = useState<ReadonlyMap<string, boolean>>(
    new Map(),
  );
  const [syncingIds, setSyncingIds] = useState<ReadonlySet<string>>(new Set());

  const { data: capabilities } = useAdminCollectionCapabilities();
  const allCollections = useAdminCollections();
  const collections = useMemo(() => allCollections.data ?? [], [allCollections.data]);
  const libraryCounts = useMemo(() => countByLibrary(collections), [collections]);
  const listed = useMemo(() => filterAdminCollections(collections, state), [collections, state]);
  const inLibrary = useMemo(
    () => filterAdminCollections(collections, { ...state, kind: "all", q: "", failed: false }),
    [collections, state],
  );
  const failedCount = useMemo(
    () => filterAdminCollections(collections, { ...state, failed: true }).length,
    [collections, state],
  );

  const board = useAdminCollectionsBoard(arrangeLibraryId ?? undefined);
  const viewCollections = useMemo(
    () =>
      state.view === "arrange"
        ? collectionsInAdminScope(collections, board.data, arrangeLibraryId)
        : listed,
    [arrangeLibraryId, board.data, collections, listed, state.view],
  );
  const selectedCollections = useMemo(
    () => viewCollections.filter((collection) => selectedCollectionIds.has(collection.id)),
    [viewCollections, selectedCollectionIds],
  );
  const createGroup = useCreateCollectionGroup(arrangeLibraryId ?? 0);
  const updateGroup = useUpdateCollectionGroup(arrangeLibraryId ?? 0);
  const deleteGroup = useDeleteCollectionGroup(arrangeLibraryId ?? 0);
  const deleteCollections = useDeleteAdminCollections();
  const setVisibility = useSetAdminCollectionVisibility();
  const sync = useScopeSync(SERVER_SCOPE);
  const removeOne = useMutation({
    retry: false,
    mutationFn: (ref: { id: string; etag: string }) => SERVER_SCOPE.remove(ref),
  });
  const applyJobs = useTemplateBundleApplyJobs();
  useEventChannel("jobs");
  const latestApplyJob = applyJobs.data?.[0] ?? null;
  const activeApplyJob = latestApplyJob !== null && isActiveTemplateBundleApplyJob(latestApplyJob);
  const lastInvalidatedJobID = useRef<string | null>(null);

  useEffect(() => {
    if (!latestApplyJob || activeApplyJob || lastInvalidatedJobID.current === latestApplyJob.id) {
      return;
    }
    lastInvalidatedJobID.current = latestApplyJob.id;
    void invalidateAdminCollectionQueries(queryClient);
    void queryClient.invalidateQueries({ queryKey: sectionKeys.all });
  }, [activeApplyJob, latestApplyJob, queryClient]);

  useEffect(() => {
    const clearSelection = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        pendingDelete === null &&
        !confirmDeleteSelected &&
        !confirmDeleteAll
      ) {
        setSelectedCollectionIds(new Set());
      }
    };
    window.addEventListener("keydown", clearSelection);
    return () => window.removeEventListener("keydown", clearSelection);
  }, [confirmDeleteAll, pendingDelete, confirmDeleteSelected]);

  function update(patch: Partial<AdminListState>, options: { replace?: boolean } = {}) {
    if (patch.libraryId !== undefined || patch.view !== undefined)
      setSelectedCollectionIds(new Set());
    setSearchParams(
      (current) => writeAdminListState(current, { ...readAdminListState(current), ...patch }),
      options,
    );
  }

  function setView(view: AdminListView) {
    if (view === state.view) return;
    // Arrange works on one library: from All libraries it opens the first.
    update(
      view === "arrange"
        ? { view, libraryId: state.libraryId ?? libraryList[0]?.id ?? null }
        : { view, libraryId: arrangeLibraryId },
    );
  }

  function openEditor(collection: LibraryCollection, libraryId = activeLibraryId) {
    navigate(SERVER_SCOPE.paths.edit(collection.id, { libraryId }), {
      state: listReturnState(listHref),
    });
  }

  /** The libraries a collection is in that this page knows by name. */
  function librariesOf(collection: LibraryCollection): Array<{ id: number; name: string }> {
    return collectionLibraryIds(collection).flatMap((id) => {
      const name = libraryNames.get(id);
      return name ? [{ id, name }] : [];
    });
  }

  function namesOf(collection: LibraryCollection): string[] {
    return librariesOf(collection).map((library) => library.name);
  }

  function isVisible(collection: LibraryCollection) {
    return visibilityOverrides.get(collection.id) ?? collection.visibility !== "hidden";
  }

  function saveVisible(collection: LibraryCollection, visible: boolean) {
    setVisibilityOverrides((current) => new Map(current).set(collection.id, visible));
    setVisibility.mutate(
      { id: collection.id, visible },
      {
        onSettled: () =>
          setVisibilityOverrides((current) => {
            const next = new Map(current);
            next.delete(collection.id);
            return next;
          }),
      },
    );
  }

  function changeVisible(collection: LibraryCollection, visible: boolean) {
    // Rows that show it would keep showing it with a See all that can't open.
    if (!visible && (collection.row_count ?? 0) > 0) setHiding(collection);
    else saveVisible(collection, visible);
  }

  function syncNow(collection: LibraryCollection) {
    setSyncingIds((current) => new Set(current).add(collection.id));
    sync.mutate(collection.id, {
      onSettled: () =>
        setSyncingIds((current) => {
          const next = new Set(current);
          next.delete(collection.id);
          return next;
        }),
    });
  }

  async function prepareDelete(collection: LibraryCollection) {
    try {
      const snapshot = await fetchAdminCollectionSnapshot(collection.id);
      setPendingDelete({ collection: snapshot.collection, etag: snapshot.etag, error: null });
    } catch (error) {
      toast.error(adminMutationMessage(error, "Could not load collection"));
    }
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    holdDeleteOpen.current = true;
    removeOne.mutate(
      { id: pendingDelete.collection.id, etag: pendingDelete.etag },
      {
        onSuccess: () => {
          toast.success("Collection deleted");
          setPendingDelete(null);
        },
        onError: (error) =>
          setPendingDelete((current) =>
            current ? { ...current, error: deleteErrorMessage(error) } : current,
          ),
        onSettled: () => {
          holdDeleteOpen.current = false;
          void SERVER_SCOPE.invalidate(queryClient);
        },
      },
    );
  }

  const [deleteSnapshots, setDeleteSnapshots] = useState<AdminCollectionDeleteSnapshot[]>([]);
  const [preparingDelete, setPreparingDelete] = useState(false);
  async function prepareBulkDelete(selected: boolean) {
    setPreparingDelete(true);
    try {
      setDeleteSnapshots(
        await prepareAdminCollectionDeletes(
          (selected ? selectedCollections : viewCollections).map((entry) => entry.id),
        ),
      );
      if (selected) setConfirmDeleteSelected(true);
      else setConfirmDeleteAll(true);
    } catch (error) {
      toast.error(adminMutationMessage(error, "Could not prepare deletion"));
    } finally {
      setPreparingDelete(false);
    }
  }
  async function prepareGroupEdit(id: string) {
    try {
      setEditingGroup({ mode: "edit", id, snapshot: await fetchAdminGroupSnapshot(id) });
    } catch (error) {
      toast.error(adminMutationMessage(error, "Could not load group"));
    }
  }

  const editingTarget: LibraryCollectionGroup | null = editingGroup?.snapshot?.group ?? null;
  const activeLibrary = libraryList.find((library) => library.id === activeLibraryId) ?? null;
  const filtered = state.kind !== "all" || state.q.trim() !== "" || state.failed;
  const collectionDeletionNotice =
    "Silo will keep collections that are still used by home or library sections. This action cannot be undone.";
  const sharedDeletionNotice =
    "Shared collections will also be removed from their other libraries.";
  const deleteAllDescription = activeLibrary
    ? `Delete all ${deleteSnapshots.length} collections shown for ${activeLibrary.name}? ${sharedDeletionNotice} ${collectionDeletionNotice}`
    : filtered
      ? `Delete all ${deleteSnapshots.length} collections in this view? ${collectionDeletionNotice}`
      : `Delete all ${deleteSnapshots.length} server collections? ${collectionDeletionNotice}`;
  // Read library membership from the snapshots the delete will use, not the
  // board, which can be stale.
  const selectedIncludesShared = deleteSnapshots.some(
    (snapshot) => collectionLibraryIds(snapshot.collection).length > 1,
  );
  const deleteSelectedScopeNotice = selectedIncludesShared ? ` ${sharedDeletionNotice}` : "";
  const deleteSelectedDescription = `Delete ${deleteSnapshots.length} selected collection${deleteSnapshots.length === 1 ? "" : "s"}?${deleteSelectedScopeNotice} ${collectionDeletionNotice}`;
  const deleteProgressLabel = `Deleting ${deleteCollections.progress?.completed ?? 0} of ${deleteCollections.progress?.total ?? viewCollections.length} collections`;
  const bulkBusy = preparingDelete || deleteCollections.isPending || activeApplyJob;

  function handleDeleteSelected() {
    if (!activeApplyJob)
      deleteCollections.mutate(deleteSnapshots, {
        onSuccess: () => setConfirmDeleteSelected(false),
      });
  }
  function handleDeleteAll() {
    if (!activeApplyJob)
      deleteCollections.mutate(deleteSnapshots, { onSuccess: () => setConfirmDeleteAll(false) });
  }

  // Until Starter packs and Select collections arrive, More holds today's page actions.
  const moreItems: PageMoreMenuItem[] = [
    {
      key: "templates",
      label: "Browse templates…",
      help: "Add ready-made synced lists, one at a time or as a set.",
      icon: Sparkles,
      disabled: !capabilities?.imports,
      opensDialog: true,
      onSelect: () => setGalleryOpen(true),
    },
    ...(state.view === "arrange" && activeLibrary && capabilities?.groups
      ? [
          {
            key: "new-shelf",
            label: "New shelf…",
            help: `Add a heading to ${activeLibrary.name} › Collections.`,
            icon: Plus,
            opensDialog: true,
            onSelect: () => setEditingGroup({ mode: "create" }),
          },
        ]
      : []),
    {
      key: "delete-all",
      label: deleteCollections.isPending ? `${deleteProgressLabel}…` : "Delete all in this view…",
      help: "Every collection the current filters show.",
      icon: Trash2,
      group: true,
      disabled: viewCollections.length === 0 || bulkBusy,
      onSelect: () => void prepareBulkDelete(false),
    },
  ];
  const more = <PageMoreMenu items={moreItems} compact={narrow} />;
  const newCollection = (
    <Button
      asChild
      size={narrow ? "lg" : "sm"}
      className={cn(narrow && "h-12 rounded-[14px] text-[15px]")}
    >
      <Link
        to={SERVER_SCOPE.paths.create({ libraryId: activeLibraryId })}
        state={listReturnState(listHref)}
      >
        <Plus aria-hidden /> New collection
      </Link>
    </Button>
  );

  const pendingNames = pendingDelete ? namesOf(pendingDelete.collection) : [];

  return (
    <div
      aria-busy={deleteCollections.isPending || preparingDelete}
      inert={deleteCollections.isPending || preparingDelete ? true : undefined}
    >
      <CalmPage
        heading="page"
        title="Collections"
        subtitle="Server collections everyone can browse on each library's Collections tab and use in Home rows."
        actions={
          narrow ? null : (
            <>
              {more}
              {newCollection}
            </>
          )
        }
        padBottom={narrow}
      >
        <CollectionApplyJobBanner job={latestApplyJob} />

        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <PillSwitcher
              label="Library"
              options={[
                {
                  value: ALL_LIBRARIES,
                  label: "All libraries",
                  icon: LibraryIcon,
                  // Arrange works on one library's shelves.
                  disabled: state.view === "arrange",
                },
                ...libraryList.map((library, index) => ({
                  value: String(library.id),
                  label: library.name,
                  count: libraryCounts.get(library.id) ?? 0,
                  separated: index === 0,
                })),
              ]}
              value={activeLibraryId ? String(activeLibraryId) : ALL_LIBRARIES}
              onChange={(value) =>
                update({ libraryId: value === ALL_LIBRARIES ? null : Number(value) })
              }
            />
          </div>
          <Segmented
            label="View"
            value={state.view}
            options={[
              { value: "list", label: "List", icon: List },
              { value: "arrange", label: "Arrange", icon: LayoutGrid },
            ]}
            onChange={setView}
          />
        </div>

        {state.view === "list" ? (
          <section aria-label="Collections" className="surface-panel rounded-[26px] p-1.5">
            {allCollections.isError ? (
              <div role="alert" className="grid justify-items-center gap-3 px-4 py-10 text-sm">
                <p>Couldn&apos;t load collections</p>
                <Button variant="outline" size="sm" onClick={() => void allCollections.refetch()}>
                  Retry
                </Button>
              </div>
            ) : allCollections.isLoading ? (
              <ListSkeleton />
            ) : inLibrary.length === 0 ? (
              <EmptyLibrary
                libraryName={activeLibrary?.name ?? null}
                canBrowseTemplates={Boolean(capabilities?.imports)}
                onBrowseTemplates={() => setGalleryOpen(true)}
                newCollection={newCollection}
              />
            ) : (
              <>
                <ListFilters
                  state={state}
                  total={inLibrary.length}
                  failedCount={failedCount}
                  onChange={(patch) => update(patch, { replace: true })}
                />
                {listed.length === 0 ? (
                  <div className="grid justify-items-center gap-2 px-4 py-10 text-sm">
                    <p className="text-muted-foreground">No collections match.</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        update({ kind: "all", q: "", failed: false }, { replace: true })
                      }
                    >
                      Clear filters
                    </Button>
                  </div>
                ) : (
                  <>
                    <CollectionColumnHeader count={listed.length} />
                    <ol className="grid">
                      {listed.map((collection) => {
                        const libraries = librariesOf(collection);
                        const visible = isVisible(collection);
                        const syncing = syncingIds.has(collection.id);
                        const peekLibraryId = state.libraryId ?? libraries[0]?.id;
                        return (
                          <CollectionListItem
                            key={collection.id}
                            collection={collection}
                            libraryNames={libraries.map((library) => library.name)}
                            showLibraries={state.libraryId === null}
                            peek={
                              peekLibraryId ? serverCollectionPeek(collection, peekLibraryId) : null
                            }
                            visible={visible}
                            syncing={syncing}
                            switchDisabled={visibilityOverrides.has(collection.id)}
                            onVisibleChange={(next) => changeVisible(collection, next)}
                            onOpen={() => openEditor(collection)}
                            menu={
                              <CollectionActionsMenu
                                placement="row"
                                name={collection.title}
                                onEdit={() => openEditor(collection)}
                                openIn={{
                                  libraries,
                                  onOpen: (libraryId) =>
                                    navigate(
                                      buildLibraryCollectionCatalogHref(
                                        collection.id,
                                        collection.title,
                                        libraryId,
                                      ),
                                    ),
                                  disabledReason: visible
                                    ? undefined
                                    : "Hidden from Collections tabs",
                                }}
                                sync={
                                  isListBackedCollectionType(collection.collection_type)
                                    ? {
                                        syncing:
                                          syncing || collection.last_sync_status === "running",
                                        onSync: () => syncNow(collection),
                                      }
                                    : undefined
                                }
                                onDelete={() => void prepareDelete(collection)}
                              />
                            }
                          />
                        );
                      })}
                    </ol>
                  </>
                )}
                <p className="text-muted-foreground flex items-center gap-2 px-4 pt-2 pb-3 text-[13px]">
                  <Info aria-hidden className="size-4 shrink-0" />
                  <span>
                    Click a collection to edit it. Order and shelves live in{" "}
                    <button
                      type="button"
                      className="text-foreground font-semibold underline-offset-4 hover:underline"
                      onClick={() => setView("arrange")}
                    >
                      Arrange
                    </button>
                    .
                  </span>
                </p>
              </>
            )}
          </section>
        ) : (
          <ArrangeView
            libraryId={arrangeLibraryId}
            libraryName={activeLibrary?.name ?? null}
            board={board}
            capabilities={capabilities}
            selectedIds={selectedCollectionIds}
            setSelectedIds={setSelectedCollectionIds}
            syncingCollectionID={[...syncingIds][0] ?? null}
            busy={bulkBusy}
            newCollection={newCollection}
            onBrowseTemplates={() => setGalleryOpen(true)}
            onEditGroup={(id) => void prepareGroupEdit(id)}
            onEditCollection={(collection) => openEditor(collection, arrangeLibraryId)}
            onDeleteCollection={(collection) => void prepareDelete(collection)}
            onSyncCollection={syncNow}
            onDeleteSelected={() => void prepareBulkDelete(true)}
          />
        )}
      </CalmPage>

      {narrow ? <MobileDockBar more={more} addRow={newCollection} /> : null}

      <CollectionTemplateGallery
        open={galleryOpen}
        onOpenChange={setGalleryOpen}
        libraries={libraryList}
        initialLibraryId={activeLibraryId}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !holdDeleteOpen.current) setPendingDelete(null);
        }}
        title={`Delete ${pendingDelete?.collection.title ?? "collection"}?`}
        description={serverDeleteDescription(pendingNames)}
        confirmLabel="Delete"
        variant="destructive"
        isPending={removeOne.isPending}
        error={pendingDelete?.error}
        onConfirm={confirmDelete}
      />

      <HideCollectionDialog
        open={hiding !== null}
        onOpenChange={(open) => {
          if (!open) setHiding(null);
        }}
        name={hiding?.title ?? ""}
        libraryNames={hiding ? namesOf(hiding) : []}
        rowCount={hiding?.row_count ?? 0}
        onConfirm={() => {
          if (hiding) saveVisible(hiding, false);
        }}
      />

      <ConfirmDialog
        open={confirmDeleteSelected}
        onOpenChange={setConfirmDeleteSelected}
        title="Delete selected collections"
        description={deleteSelectedDescription}
        confirmLabel="Delete selected"
        variant="destructive"
        onConfirm={handleDeleteSelected}
      />

      <ConfirmDialog
        open={confirmDeleteAll}
        onOpenChange={setConfirmDeleteAll}
        title="Delete all collections"
        description={deleteAllDescription}
        confirmLabel="Delete all"
        variant="destructive"
        onConfirm={handleDeleteAll}
      />

      {editingGroup && (
        <GroupEditDialog
          mode={editingGroup.mode}
          group={editingTarget}
          onCancel={() => setEditingGroup(null)}
          onSubmit={async (input) => {
            try {
              if (editingGroup.mode === "create") {
                await createGroup.mutateAsync(input);
              } else if (editingGroup.id) {
                await updateGroup.mutateAsync({
                  id: editingGroup.id,
                  etag: editingGroup.snapshot!.etag,
                  ...input,
                });
              }
              setEditingGroup(null);
            } catch {
              // toast already shown by mutation onError
            }
          }}
          onDelete={
            editingGroup.mode === "edit" && editingGroup.id
              ? async () => {
                  if (!editingGroup.id) return;
                  try {
                    await deleteGroup.mutateAsync({
                      id: editingGroup.id,
                      etag: editingGroup.snapshot!.etag,
                    });
                    setEditingGroup(null);
                  } catch {
                    // toast already shown by mutation onError
                  }
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

/** Toggle buttons for a small set of choices, one pressed. */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; icon?: typeof List }>;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="border-border bg-muted/20 flex shrink-0 items-center gap-0.5 rounded-xl border p-[3px]"
    >
      {options.map((option) => {
        const pressed = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(option.value)}
            className={cn(
              "focus-visible:ring-ring/50 inline-flex h-8 items-center gap-1.5 rounded-[9px] px-3 text-[13px] font-medium whitespace-nowrap outline-none focus-visible:ring-[3px] max-lg:h-11",
              pressed
                ? "bg-accent text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.icon ? <option.icon aria-hidden className="size-4" /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Search, type and the failed-sync chip above the List. */
function ListFilters({
  state,
  total,
  failedCount,
  onChange,
}: {
  state: AdminListState;
  total: number;
  failedCount: number;
  onChange: (patch: Partial<AdminListState>) => void;
}) {
  return (
    <div className="border-border/75 flex flex-wrap items-center gap-2.5 border-b px-3 pt-2.5 pb-3">
      <div className="relative min-w-[200px] flex-1 sm:max-w-[280px]">
        <Search
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
        />
        <Input
          type="search"
          aria-label="Search collections"
          placeholder={`Search ${total} collection${total === 1 ? "" : "s"}`}
          value={state.q}
          onChange={(event) => onChange({ q: event.target.value })}
          className="h-9 rounded-xl pl-9"
        />
      </div>
      <Segmented
        label="Type"
        value={state.kind}
        options={KIND_OPTIONS}
        onChange={(kind) => onChange({ kind })}
      />
      {failedCount > 0 || state.failed ? (
        <button
          type="button"
          aria-pressed={state.failed}
          onClick={() => onChange({ failed: !state.failed })}
          className={cn(
            "focus-visible:ring-ring/50 ml-auto inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[13px] font-medium outline-none focus-visible:ring-[3px] max-lg:h-11",
            state.failed
              ? "border-destructive bg-destructive/15 text-destructive"
              : "border-destructive/40 text-destructive hover:bg-destructive/10",
          )}
        >
          <span aria-hidden className="bg-destructive size-2 rounded-full" />
          {failedCount} sync{failedCount === 1 ? "" : "s"} failed
        </button>
      ) : null}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div role="status" aria-busy="true" className="grid gap-1 p-2">
      <span className="sr-only">Loading collections…</span>
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="flex items-center gap-3.5 px-2 py-2.5">
          <Skeleton className="h-[50px] w-[74px] rounded-xl" />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-64" />
          </div>
          <Skeleton className="h-5 w-9 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** A library, or the server, with no collections yet: both ways to make some. */
function EmptyLibrary({
  libraryName,
  canBrowseTemplates,
  onBrowseTemplates,
  newCollection,
}: {
  libraryName: string | null;
  canBrowseTemplates: boolean;
  onBrowseTemplates: () => void;
  newCollection: ReactNode;
}) {
  return (
    <div className="grid justify-items-center gap-3 px-4 py-14 text-center">
      <span className="bg-accent/80 ring-border grid size-12 place-items-center rounded-xl ring-1 ring-inset">
        <Layers aria-hidden className="text-muted-foreground size-5" />
      </span>
      <p className="font-semibold">
        {libraryName ? `No collections in ${libraryName} yet` : "No collections yet"}
      </p>
      <p className="text-muted-foreground max-w-sm text-sm">
        Make one yourself, or start from ready-made lists.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!canBrowseTemplates}
          onClick={onBrowseTemplates}
        >
          <Sparkles aria-hidden /> Browse templates
        </Button>
        {newCollection}
      </div>
    </div>
  );
}

/** Today's shelves board for one library, until Arrange is rebuilt. */
function ArrangeView({
  libraryId,
  libraryName,
  board,
  capabilities,
  selectedIds,
  setSelectedIds,
  syncingCollectionID,
  busy,
  newCollection,
  onBrowseTemplates,
  onEditGroup,
  onEditCollection,
  onDeleteCollection,
  onSyncCollection,
  onDeleteSelected,
}: {
  libraryId: number | null;
  libraryName: string | null;
  board: ReturnType<typeof useAdminCollectionsBoard>;
  capabilities: { imports?: boolean } | undefined;
  selectedIds: Set<string>;
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
  syncingCollectionID: string | null;
  busy: boolean;
  newCollection: ReactNode;
  onBrowseTemplates: () => void;
  onEditGroup: (id: string) => void;
  onEditCollection: (collection: LibraryCollection) => void;
  onDeleteCollection: (collection: LibraryCollection) => void;
  onSyncCollection: (collection: LibraryCollection) => void;
  onDeleteSelected: () => void;
}) {
  if (libraryId === null) return null;
  if (board.isLoading)
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded-lg" />
        ))}
      </div>
    );
  if (!board.data) return null;
  const count =
    board.data.ungrouped.length +
    board.data.groups.reduce((sum, group) => sum + group.collections.length, 0);
  const hasShelves = board.data.groups.some((group) => group.kind === "regular");
  if (count === 0 && !hasShelves)
    return (
      <div className="surface-panel rounded-[26px] p-1.5">
        <EmptyLibrary
          libraryName={libraryName}
          canBrowseTemplates={Boolean(capabilities?.imports)}
          onBrowseTemplates={onBrowseTemplates}
          newCollection={newCollection}
        />
      </div>
    );
  return (
    <div className="grid gap-3">
      {selectedIds.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{selectedIds.size} selected</Badge>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
            Clear
          </Button>
          <Button size="sm" variant="destructive" disabled={busy} onClick={onDeleteSelected}>
            <Trash2 data-icon="inline-start" /> Delete Selected
          </Button>
        </div>
      ) : null}
      <GroupsBoard
        libraryID={libraryId}
        groups={board.data.groups}
        ungrouped={board.data.ungrouped}
        ungroupedSortOrder={board.data.ungroupedSortOrder}
        onEditGroup={onEditGroup}
        onEditCollection={onEditCollection}
        onDeleteCollection={onDeleteCollection}
        onSyncCollection={onSyncCollection}
        selectedIds={selectedIds}
        setSelectedIds={setSelectedIds}
        syncingCollectionID={syncingCollectionID}
      />
    </div>
  );
}

function CollectionApplyJobBanner({ job }: { job: AdminJob | null }) {
  if (!job || job.job_type !== "template_bundle_apply") {
    return null;
  }

  const active = isActiveTemplateBundleApplyJob(job);
  const recent = active || isRecentTemplateBundleApplyJob(job);
  if (!recent) {
    return null;
  }

  if (job.status === "failed") {
    return (
      <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border px-4 py-3">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium">Collection defaults apply failed</p>
            <p className="text-xs">{job.error_message || job.message || "The job failed."}</p>
          </div>
        </div>
      </div>
    );
  }

  if (job.status === "completed") {
    return (
      <div className="border-border bg-muted/30 rounded-lg border px-4 py-3">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium">Collection defaults applied</p>
            <p className="text-muted-foreground text-xs">{templateBundleApplySummary(job)}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="border-border bg-muted/30 rounded-lg border px-4 py-3">
      <div className="flex items-start gap-3">
        <Loader2 className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0 animate-spin" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">Applying collection defaults</p>
            <p className="text-muted-foreground text-xs">{job.message || "Working..."}</p>
          </div>
          <div className="progress-bar">
            <div className="progress-fill animate-pulse" style={{ width: "40%" }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function isActiveTemplateBundleApplyJob(job: AdminJob) {
  return job.status === "queued" || job.status === "running";
}

function isRecentTemplateBundleApplyJob(job: AdminJob) {
  const timestamp = job.completed_at ?? job.requested_at;
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return false;
  }
  return Date.now() - parsed < 10 * 60_000;
}

function templateBundleApplySummary(job: AdminJob) {
  const payload = job.result_payload as Record<string, unknown> | undefined;
  const created = resultArrayLength(payload, "created");
  const skipped = resultArrayLength(payload, "skipped");
  const failed = resultArrayLength(payload, "failed");
  const syncQueued = resultArrayLength(payload, "sync_queued");
  const featured = resultArrayLength(payload, "featured");
  const parts = [
    `Created ${created}`,
    `skipped ${skipped}`,
    failed > 0 ? `failed ${failed}` : "",
    syncQueued > 0 ? `queued ${syncQueued} initial syncs` : "",
    featured > 0 ? `featured ${featured}` : "",
  ].filter(Boolean);
  return parts.join("; ");
}

function resultArrayLength(payload: Record<string, unknown> | undefined, key: string) {
  const value = payload?.[key];
  return Array.isArray(value) ? value.length : 0;
}
