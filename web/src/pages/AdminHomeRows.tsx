import { useEffect, useMemo, useRef, useState } from "react";
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
import { AddRowDialog } from "@/components/homeRows/addRow/AddRowDialog";
import { BRIDGED_ROW_KINDS } from "@/lib/homeRows/catalog";
import type { RowMenuItem } from "@/components/homeRows/RowMenu";
import { useRowFocus } from "@/components/homeRows/useRowFocus";
import { pageLabel, pageParam } from "@/lib/homeRows/pages";
import { nextAppendPosition } from "@/lib/homeRows/payloads";
import type { EditSession, HomeRow } from "@/lib/homeRows/types";
import { updateCheckboxSelection } from "@/lib/checkboxSelection";

/** How long a newly added row stays highlighted. */
const NEW_ROW_HIGHLIGHT_MS = 2500;

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
  const createMutation = useCreateSection();
  const updateMutation = useUpdateSection();
  // The Add row / Edit row dialog: open with no session to add a row.
  const [rowDialog, setRowDialog] = useState<{ session: EditSession | null } | null>(null);
  // The kind a collection or rule card picked, for the older editor it opens.
  const [drawerType, setDrawerType] = useState<string | undefined>();
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

  function handleEdit(section: PageSectionConfig, initialType?: string) {
    const request = ++snapshotRequest.current;
    void prepareSnapshot(async () => {
      const snapshot = await fetchAdminSectionSnapshot(section.id);
      if (request !== snapshotRequest.current) return;
      setEditingSection(snapshot.section);
      setEditingETag(snapshot.etag);
      setEditConflict(false);
      setDrawerType(initialType);
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
  function bridgeToEditor(type: string, session: EditSession | null) {
    setRowDialog(null);
    if (session) {
      const section = sectionFor(session.row);
      if (section) handleEdit(section, type);
      return;
    }
    setEditingSection(null);
    setEditingETag(null);
    setEditConflict(false);
    setDrawerType(type);
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
              // The restore itself is an admin row write, so `pending` covers it.
              disabled={!canManageCurrentScope || snapshotLoading || adapter.pending}
              onClick={openRestore}
            >
              <RotateCcw className="mr-1 h-4 w-4" /> Restore Defaults
            </Button>
            <Button
              ref={focus.attachAddButton}
              size="sm"
              disabled={!canManageCurrentScope || snapshotLoading}
              onClick={openAddRow}
            >
              <Plus className="mr-1 h-4 w-4" /> Add row
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
              setDrawerType(undefined);
            }
          }}
          section={editingSection}
          initialType={drawerType}
          conflict={editConflict}
          onReload={() => {
            if (editingSection) handleEdit(editingSection);
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
