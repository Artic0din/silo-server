import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PageSectionConfig } from "@/api/types";
import {
  useCreateSection,
  useUpdateSection,
  useDeleteSection,
  useDeleteSections,
  useRestoreDefaultSections,
} from "@/hooks/queries/sections";
import { fetchRecipeCatalog } from "@/lib/recipes";
import { useQuery } from "@tanstack/react-query";
import { useAdminCollections } from "@/hooks/queries/admin/collections";
import { useAdminLibraries } from "@/hooks/queries/admin/libraries";
import {
  useAdminHomeRows,
  type BatchFailure,
  type ShownBatchResult,
} from "@/hooks/queries/homeRows/useAdminHomeRows";
import { Pencil, RotateCcw, SquareCheckBig, Star, StarOff, Trash2 } from "lucide-react";

import { toast } from "sonner";
import {
  adminSectionMutationMessage,
  fetchAdminSectionSnapshot,
  fetchAdminSectionDeleteTargets,
  fetchAdminSectionOrderSnapshot,
} from "@/api/adminSections";
import { V2ProblemError } from "@/api/v2/request";
import SectionEditorDrawer from "@/components/sections/SectionEditorDrawer";
import { HomeRowsPage, type SharedRowMenuItems } from "@/components/homeRows/HomeRowsPage";
import { DeleteRowDialog, DeleteRowsDialog } from "@/components/homeRows/DeleteRowDialog";
import type { PageMoreMenuItem } from "@/components/homeRows/PageMoreMenu";
import { RestoreDialog } from "@/components/homeRows/RestoreDialog";
import { MAX_SELECTED_ROWS, SelectModeBar } from "@/components/homeRows/SelectModeBar";
import { AddRowDialog, type BridgeCarry } from "@/components/homeRows/addRow/AddRowDialog";
import { BRIDGED_ROW_KINDS } from "@/lib/homeRows/catalog";
import type { RowMenuItem } from "@/components/homeRows/RowMenu";
import { useRowFocus } from "@/components/homeRows/useRowFocus";
import { pageLabel, pageParam, samePage } from "@/lib/homeRows/pages";
import { nextAppendPosition } from "@/lib/homeRows/payloads";
import type { EditSession, HomeRow } from "@/lib/homeRows/types";
import { updateCheckboxSelection } from "@/lib/checkboxSelection";

/** A collection or rule card picked in the row dialog, which the older editor opens. */
type DrawerBridge = { type: string; carry: BridgeCarry | null };

/** How long a newly added row stays highlighted. */
const NEW_ROW_HIGHLIGHT_MS = 2500;

function rowCount(count: number) {
  return count === 1 ? "1 row" : `${count} rows`;
}

function batchFailureText({ title, reason, message }: BatchFailure) {
  if (reason === "changed") return `${title} changed since you opened this page.`;
  if (reason === "legacy") return `${title} is a Trakt row, which can't be turned back on.`;
  return `${title}: ${message}`;
}

/** Reports a select-mode Turn on / Turn off, naming every row left as it was. */
function reportShownBatch({ changedIds, failures }: ShownBatchResult, shown: boolean) {
  const verb = shown ? "Turned on" : "Turned off";
  const attempted = changedIds.length + failures.length;
  const description = failures.map(batchFailureText).join(" ");
  if (attempted === 0) toast.success(`The selected rows are already ${shown ? "on" : "off"}.`);
  else if (failures.length === 0) toast.success(`${verb} ${rowCount(changedIds.length)}.`);
  else if (changedIds.length > 0)
    toast.warning(`${verb} ${changedIds.length} of ${rowCount(attempted)}.`, { description });
  else
    toast.error(`Could not turn ${shown ? "on" : "off"} ${rowCount(attempted)}.`, { description });
}

export default function AdminHomeRows() {
  const adapter = useAdminHomeRows();
  const { scope, serverCapabilities: capabilities } = adapter;
  const activeLibraryId = adapter.libraryId ?? null;
  const currentPageKey = pageParam(adapter.page);
  const currentPageLabel = pageLabel(adapter.page, adapter.pages);
  const { data: librariesData } = useAdminLibraries();
  const librariesList = useMemo(() => librariesData ?? [], [librariesData]);
  const focus = useRowFocus(adapter.rows, adapter.pending);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const snapshotRequest = useRef(0);
  // A row or order read started on one page must not open a dialog, or arm a
  // confirmation, after the admin has moved to another page.
  useLayoutEffect(() => {
    snapshotRequest.current++;
  }, [currentPageKey]);
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
  const { data: recipeCatalog, isError: recipeCatalogFailed } = useQuery({
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
  const [selectMode, setSelectMode] = useState(false);
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
  const createMutation = useCreateSection();
  const updateMutation = useUpdateSection();
  // The Add row / Edit row dialog: open with no session to add a row.
  const [rowDialog, setRowDialog] = useState<{ session: EditSession | null } | null>(null);
  // A collection or rule card picked in the row dialog: the kind for the older
  // editor, and the name and More options an existing row carries into it.
  const [bridge, setBridge] = useState<DrawerBridge | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  useEffect(() => {
    if (!highlightId) return;
    const timer = setTimeout(() => setHighlightId(null), NEW_ROW_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlightId]);

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

  function exitSelectMode() {
    setSelectMode(false);
    clearSectionSelection();
  }

  function selectAllRows(checked: boolean) {
    setSelectedSectionIds(() => new Set(checked ? rowIds : []));
    selectionAnchorRef.current = null;
  }

  async function setSelectedShown(shown: boolean) {
    const ids = selectedSections.map((section) => section.id);
    if (ids.length === 0 || ids.length > MAX_SELECTED_ROWS) return;
    try {
      reportShownBatch(await adapter.setShownMany(ids, shown), shown);
    } catch (error) {
      toast.error(adminSectionMutationMessage(error, "Could not change these rows"));
    }
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

  function handleEdit(section: PageSectionConfig, from: DrawerBridge | null = null) {
    const request = ++snapshotRequest.current;
    void prepareSnapshot(async () => {
      const snapshot = await fetchAdminSectionSnapshot(section.id);
      if (request !== snapshotRequest.current) return;
      setEditingSection(snapshot.section);
      setEditingETag(snapshot.etag);
      setEditConflict(false);
      setBridge(from);
      setDialogOpen(true);
    });
  }

  /** Edit row…: ready-made rows open the row dialog, the rest the older editor. */
  function openRow(row: HomeRow) {
    const section = sectionFor(row);
    if (!section || !canManageCurrentScope || snapshotLoading) return;
    if (BRIDGED_ROW_KINDS.has(row.sectionType)) {
      handleEdit(section);
      return;
    }
    const request = ++snapshotRequest.current;
    void prepareSnapshot(async () => {
      const session = await adapter.openEdit(row.id);
      if (request !== snapshotRequest.current) return;
      setRowDialog({ session });
    });
  }

  function openAddRow() {
    snapshotRequest.current++;
    setRowDialog({ session: null });
  }

  /** A collection or rule card: until the dialog edits those rows, the older editor does. */
  function bridgeToEditor(type: string, session: EditSession | null, carry: BridgeCarry | null) {
    setRowDialog(null);
    if (session) {
      const section = sectionFor(session.row);
      if (section) handleEdit(section, { type, carry });
      return;
    }
    setEditingSection(null);
    setEditingETag(null);
    setEditConflict(false);
    setBridge({ type, carry: null });
    setDialogOpen(true);
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

  function prepareBulkDelete() {
    const ids = selectedSections.map((section) => section.id);
    if (ids.length === 0 || ids.length > MAX_SELECTED_ROWS) return;
    const request = ++snapshotRequest.current;
    void prepareSnapshot(async () => {
      const targets = await fetchAdminSectionDeleteTargets(ids);
      if (request !== snapshotRequest.current) return;
      setDeleteTargets(targets);
      setConfirmDeleteSelected(true);
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

  function closeRestore() {
    snapshotRequest.current++;
    setConfirmRestoreOpen(false);
    setResetProfiles(false);
  }

  function confirmRestore() {
    if (!restoreSnapshot) return;
    restoreDefaultsMutation.mutate(
      {
        scope: restoreSnapshot.scope,
        ...(restoreSnapshot.library_id != null
          ? { library_id: Number(restoreSnapshot.library_id) }
          : {}),
        etag: restoreSnapshot.etag,
        reset_profiles: Boolean(capabilities?.reset_profiles && resetProfiles),
      },
      {
        onSuccess: () => {
          toast.success(`Restored the default rows on ${currentPageLabel}.`);
          setConfirmRestoreOpen(false);
          setResetProfiles(false);
        },
        onError: (error) => {
          const stale = error instanceof V2ProblemError && error.status === 412;
          setRestoreConflict(stale);
          if (!stale)
            toast.error(adminSectionMutationMessage(error, "Could not restore the default rows"));
        },
      },
    );
  }

  // What Restore replaces, as of the version the dialog read.
  const restoreRowIds = new Set(restoreSnapshot?.ordered_ids ?? []);
  const restoreCollectionTitles = adapter.sections
    .filter((section) => restoreRowIds.has(section.id) && section.section_type === "collection")
    .map((section) => section.title);

  const moreItems: PageMoreMenuItem[] = [
    {
      key: "select",
      label: "Select rows",
      help: "Turn several rows on or off, or delete them together.",
      icon: SquareCheckBig,
      // Focus moves to Select all once select mode opens.
      returnFocus: false,
      disabled: !canManageCurrentScope || selectMode || adapter.rows.length === 0,
      onSelect: () => setSelectMode(true),
    },
    {
      key: "restore",
      label: "Restore defaults…",
      help: "Put back the rows Silo starts with on this page.",
      icon: RotateCcw,
      // The restore itself is an admin row write, so `pending` covers it.
      disabled: !canManageCurrentScope || snapshotLoading || adapter.pending,
      onSelect: openRestore,
    },
  ];

  function rowMenuItems(row: HomeRow, shared: SharedRowMenuItems): RowMenuItem[] {
    const section = sectionFor(row);
    const busy = !canManageCurrentScope || snapshotLoading || !section;
    return [
      {
        key: "edit",
        label: "Edit row…",
        icon: Pencil,
        disabled: busy,
        onSelect: () => openRow(row),
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

  const deleteProgressLabel = `Deleting ${deleteSectionsMutation.progress?.completed ?? 0} of ${deleteSectionsMutation.progress?.total ?? deleteTargets.length}…`;
  const bulkBusy =
    !canManageCurrentScope ||
    adapter.pending ||
    snapshotLoading ||
    deleteSectionsMutation.isPending;

  function handleDeleteCapturedSections() {
    deleteSectionsMutation.mutate(deleteTargets, {
      onSuccess: (result) => {
        setSelectedSectionIds(() => new Set(result.failedIds));
        setConfirmDeleteSelected(false);
      },
    });
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
        onOpenRow={openRow}
        highlightRowId={highlightId}
        rowMenuItems={rowMenuItems}
        moreItems={moreItems}
        addRow={{ onClick: openAddRow, disabled: !canManageCurrentScope || snapshotLoading }}
        selection={
          selectMode
            ? {
                selectedIds: selectedSectionIds,
                onChange: updateSectionSelection,
                onSelectAll: selectAllRows,
                onExit: exitSelectMode,
                label: (row) => `Select ${row.title}`,
                bar: (
                  <SelectModeBar
                    count={selectedSections.length}
                    busy={bulkBusy}
                    onTurnOn={() => void setSelectedShown(true)}
                    onTurnOff={() => void setSelectedShown(false)}
                    onDelete={prepareBulkDelete}
                  />
                ),
              }
            : undefined
        }
        notices={
          snapshotLoading ? (
            <p role="status" className="text-muted-foreground text-sm">
              Loading the current rows…
            </p>
          ) : null
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
        <DeleteRowsDialog
          count={deleteTargets.length}
          pageLabel={currentPageLabel}
          open={confirmDeleteSelected}
          busy={deleteSectionsMutation.isPending}
          progress={deleteProgressLabel}
          onConfirm={handleDeleteCapturedSections}
          onOpenChange={(open) => {
            if (!open) setConfirmDeleteSelected(false);
          }}
        />
        <RestoreDialog
          open={confirmRestoreOpen}
          page={adapter.page}
          pageLabel={currentPageLabel}
          otherLibraryLabels={adapter.pages
            .filter(
              (option) => option.ref.kind === "library" && !samePage(option.ref, adapter.page),
            )
            .map((option) => option.label)}
          rowCount={restoreRowIds.size}
          collectionRowTitles={restoreCollectionTitles}
          resetSupported={Boolean(capabilities?.reset_profiles)}
          resetProfiles={resetProfiles}
          onResetProfilesChange={setResetProfiles}
          conflict={restoreConflict}
          busy={restoreDefaultsMutation.isPending || snapshotLoading}
          canConfirm={restoreSnapshot !== null}
          onConfirm={confirmRestore}
          onReload={() => void adapter.reload().finally(openRestore)}
          onOpenChange={(open) => {
            if (!open) closeRestore();
          }}
        />

        <SectionEditorDrawer
          mode="admin"
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) {
              snapshotRequest.current++;
              setEditingSection(null);
              setBridge(null);
            }
          }}
          section={editingSection}
          initialType={bridge?.type}
          carried={bridge?.carry ?? undefined}
          conflict={editConflict}
          onReload={() => {
            // A reload refreshes the stored row; the kind picked in the dialog stays.
            if (editingSection) handleEdit(editingSection, bridge);
          }}
          scope={editingSection?.scope ?? scope}
          currentLibraryId={editingSection ? editingSection.library_id : activeLibraryId}
          libraries={librariesList}
          recipeCatalog={recipeCatalog}
          isSubmitting={createMutation.isPending || updateMutation.isPending}
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
              // New rows go to the bottom: the server stores the position sent.
              const position = nextAppendPosition(adapter.sections.map((row) => row.position));
              createMutation.mutate(
                { ...section, position },
                {
                  onSuccess: (created) => {
                    setDialogOpen(false);
                    setEditingSection(null);
                    setHighlightId(created.id);
                  },
                  onError: (error) => {
                    toast.error(
                      error instanceof Error ? error.message : "Failed to create section",
                    );
                  },
                },
              );
            }
          }}
        />

        {rowDialog ? (
          <AddRowDialog
            adapter={adapter}
            catalog={recipeCatalog}
            catalogFailed={recipeCatalogFailed}
            libraries={librariesList}
            session={rowDialog.session}
            onClose={() => setRowDialog(null)}
            onSaved={(newIds) => setHighlightId(newIds[0] ?? null)}
            onBridge={bridgeToEditor}
            onDelete={(session) => {
              setRowDialog(null);
              const section = sectionFor(session.row);
              if (section) handleDelete(section);
            }}
          />
        ) : null}
      </HomeRowsPage>
    </div>
  );
}
