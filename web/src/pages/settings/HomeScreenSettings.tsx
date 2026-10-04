/* eslint-disable react-refresh/only-export-components */
import { useMemo, useRef, useState } from "react";
import {
  CircleMinus,
  Download,
  Pencil,
  RotateCcw,
  Star,
  StarOff,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DeleteRuleRowsDialog } from "@/components/homeRows/DeleteRuleRowsDialog";
import { HideWatchedCard } from "@/components/homeRows/HideWatchedCard";
import { HomeRowsPage, type SharedRowMenuItems } from "@/components/homeRows/HomeRowsPage";
import { PageLockNote } from "@/components/homeRows/notes";
import type { PageMoreMenuItem } from "@/components/homeRows/PageMoreMenu";
import { RemoveRowDialog } from "@/components/homeRows/RemoveRowDialog";
import { ResetProfileDialog } from "@/components/homeRows/ResetProfileDialog";
import type { RowMenuItem } from "@/components/homeRows/RowMenu";
import { AddRowDialog } from "@/components/homeRows/addRow/AddRowDialog";
import { useNewRowHighlight } from "@/components/homeRows/useNewRowHighlight";
import { useRowFocus } from "@/components/homeRows/useRowFocus";
import { HomeLayoutImportDialog } from "@/components/sections/HomeLayoutTransfer";
import { useHomeLayoutExport } from "@/hooks/queries/homeRows/useHomeLayoutExport";
import { useProfileHomeRowsAdapter } from "@/hooks/queries/homeRows/useProfileHomeRowsAdapter";
import { useUserLibraries } from "@/hooks/queries/libraries";
import { useOptionalAuth } from "@/hooks/useAuth";
import {
  useEffectiveSettings,
  useSetSettingValue,
  type SettingIdentity,
} from "@/hooks/queries/settingValues";
import { collectionKind, profilePageName, type CollectionSummary } from "@/lib/homeRows/describe";
import { pageLabel } from "@/lib/homeRows/pages";
import type { EditSession, HomeRow } from "@/lib/homeRows/types";
import { SETTING_KEYS } from "@/lib/settingsContract";

export { buildProfileGallerySection } from "@/lib/homeRows/payloads";
export {
  applySectionDeletion,
  buildSectionOverrides,
  canMutateSectionSettings,
  createOverrideIdSource,
  hydrateRemovedSystemSections,
  sectionSaveErrorMessage,
  shouldRestoreLatestSaveFailure,
  shouldRestoreSelectionState,
} from "@/lib/homeRows/profileOverrides";

const PROFILE_SCOPE: SettingIdentity = { scope: "profile" };
const HOME_PREFERENCE_KEYS = [SETTING_KEYS.HOME_HIDE_WATCHED_ITEMS] as const;

/**
 * Settings > Home Screen: this profile's rows on Home and each library page,
 * on the same Home rows components as the admin page. Changes save as they
 * are made and only ever change this profile.
 */
/** Something the page needs didn't load, so it can't change until a retry. */
function LoadFailedNote({
  what,
  retryLabel,
  onRetry,
}: {
  what: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="border-warning/40 bg-warning/10 flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 text-sm"
    >
      <p className="min-w-0 flex-1">
        {what} didn&apos;t load, so this page can&apos;t change right now.
      </p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  );
}

export default function HomeScreenSettings() {
  const adapter = useProfileHomeRowsAdapter();
  const { data: libraries } = useUserLibraries();
  const focus = useRowFocus(adapter.rows, adapter.pending);
  const label = pageLabel(adapter.page, adapter.pages);
  const pageName = profilePageName(label);
  const layoutExport = useHomeLayoutExport();
  const [importOpen, setImportOpen] = useState(false);
  const [rowDialog, setRowDialog] = useState<{ session: EditSession | null } | null>(null);
  const [highlightId, setHighlightId] = useNewRowHighlight();
  const [removing, setRemoving] = useState<HomeRow | null>(null);
  const [deletingRuleRows, setDeletingRuleRows] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  // Set when a confirmed delete takes away the control that opened its dialog.
  const removedOpener = useRef(false);

  const homePreferences = useEffectiveSettings({ keys: HOME_PREFERENCE_KEYS });
  const saveHomePreference = useSetSettingValue();
  const hideWatchedItems =
    homePreferences.data?.[SETTING_KEYS.HOME_HIDE_WATCHED_ITEMS]?.value === true;

  const profileId = useOptionalAuth()?.profile?.id;
  const collectionOptions = adapter.collections?.options;
  const collectionSummaries = useMemo(
    () =>
      new Map<string, CollectionSummary>(
        (collectionOptions ?? []).map((option) => [
          option.id,
          {
            title: option.title,
            kind: collectionKind(option.collection_type),
            // The list also holds collections other profiles shared.
            yours: Boolean(profileId) && option.creator_profile_id === profileId,
          },
        ]),
      ),
    [collectionOptions, profileId],
  );

  const { pageLock } = adapter;
  const lockedRows = pageLock ? adapter.rows.filter((row) => pageLock.rowIds.includes(row.id)) : [];

  function openRow(row: HomeRow) {
    if (!adapter.canEdit) return;
    void adapter
      .openEdit(row.id)
      .then((session) => setRowDialog({ session }))
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : "Could not open this row"),
      );
  }

  function confirmRemove() {
    if (!removing) return;
    removedOpener.current = true;
    focus.afterRemoval(removing.id);
    adapter.remove([removing.id]);
    setRemoving(null);
  }

  function confirmDeleteRuleRows() {
    if (!pageLock) return;
    removedOpener.current = true;
    focus.afterRemoval(pageLock.rowIds[0]!);
    adapter.remove(pageLock.rowIds);
    setDeletingRuleRows(false);
  }

  function skipReturnFocus() {
    const skip = removedOpener.current;
    removedOpener.current = false;
    return skip;
  }

  function rowMenuItems(row: HomeRow, shared: SharedRowMenuItems): RowMenuItem[] {
    if (pageLock?.rowIds.includes(row.id)) {
      return [
        {
          key: "delete-rule-rows",
          label: "Delete rule rows…",
          icon: Trash2,
          destructive: true,
          onSelect: () => setDeletingRuleRows(true),
        },
      ];
    }
    const busy = !adapter.canEdit;
    return [
      {
        key: "edit",
        label: "Edit row…",
        icon: Pencil,
        disabled: busy,
        onSelect: () => openRow(row),
      },
      ...(row.renamedFrom
        ? [
            {
              key: "original-name",
              label: "Use the original name",
              icon: Undo2,
              disabled: busy,
              onSelect: () => adapter.restoreOriginalName(row.id),
            },
          ]
        : []),
      {
        key: "hero",
        label: row.hero ? "Stop using as hero banner" : "Use as hero banner",
        icon: row.hero ? StarOff : Star,
        disabled: busy,
        onSelect: () => void adapter.setHero(row.id, !row.hero),
      },
      shared.moveToTop,
      shared.moveToBottom,
      {
        key: "remove",
        label: row.own ? "Delete row…" : `Remove from my ${pageName}…`,
        icon: row.own ? Trash2 : CircleMinus,
        destructive: true,
        group: true,
        disabled: busy,
        onSelect: () => setRemoving(row),
      },
    ];
  }

  const resetTarget = adapter.page.kind === "home" ? "Home" : `the ${label} page`;
  const moreItems: PageMoreMenuItem[] = [
    {
      key: "export",
      label: layoutExport.running ? "Exporting layout…" : "Export layout",
      help: "Save your rows for every page to a file.",
      icon: Download,
      disabled: !layoutExport.ready || layoutExport.running,
      onSelect: () => void layoutExport.run(),
    },
    {
      key: "import",
      label: "Import layout…",
      help: "Load a layout saved here or on another server.",
      icon: Upload,
      disabled: !layoutExport.libraries,
      opensDialog: true,
      onSelect: () => setImportOpen(true),
    },
    {
      key: "reset",
      label: `Reset ${resetTarget} to the server's rows…`,
      help: "Brings back hidden rows and original names, and removes rows you added.",
      icon: RotateCcw,
      group: true,
      disabled: !adapter.canReset,
      opensDialog: true,
      onSelect: () => setResetOpen(true),
    },
  ];

  function handleHideWatchedItemsChange(enabled: boolean) {
    saveHomePreference.mutate(
      { key: SETTING_KEYS.HOME_HIDE_WATCHED_ITEMS, value: enabled, identity: PROFILE_SCOPE },
      { onError: () => toast.error("Failed to save Home preference") },
    );
  }

  let notice = null;
  if (pageLock) {
    notice = (
      <PageLockNote
        titles={lockedRows.map((row) => row.title)}
        onDelete={() => setDeletingRuleRows(true)}
      />
    );
  } else if (adapter.overridesFailed) {
    notice = (
      <LoadFailedNote
        what="Your saved changes"
        retryLabel="Reload rows"
        onRetry={() => void adapter.reload()}
      />
    );
  } else if (adapter.pageLockCheck === "failed") {
    notice = (
      <LoadFailedNote
        what="The kinds of rows"
        retryLabel="Try again"
        onRetry={adapter.reloadCatalog}
      />
    );
  } else if (adapter.overridesLoading || adapter.pageLockCheck === "loading") {
    notice = (
      <p role="status" className="text-muted-foreground text-sm">
        Loading your saved changes…
      </p>
    );
  }

  const editingRow = rowDialog?.session?.row;
  return (
    <HomeRowsPage
      adapter={adapter}
      title="Home screen"
      subtitle="Choose the rows you see and their order. Only this profile changes, and it saves as you go."
      focus={focus}
      collection={(id) => collectionSummaries.get(id)}
      onOpenRow={adapter.canEdit ? openRow : undefined}
      highlightRowId={highlightId}
      rowMenuItems={rowMenuItems}
      moreItems={moreItems}
      addRow={{ onClick: () => setRowDialog({ session: null }), disabled: !adapter.canEdit }}
      notices={notice}
    >
      <HideWatchedCard
        checked={hideWatchedItems}
        disabled={homePreferences.isLoading || saveHomePreference.isPending}
        onCheckedChange={handleHideWatchedItemsChange}
      />

      <RemoveRowDialog
        row={removing}
        pageName={pageName}
        onConfirm={confirmRemove}
        onOpenChange={(open) => !open && setRemoving(null)}
        skipReturnFocus={skipReturnFocus}
      />
      <DeleteRuleRowsDialog
        open={deletingRuleRows && pageLock !== null}
        titles={lockedRows.map((row) => row.title)}
        pageName={pageName}
        onConfirm={confirmDeleteRuleRows}
        onOpenChange={setDeletingRuleRows}
        skipReturnFocus={skipReturnFocus}
      />
      <ResetProfileDialog
        open={resetOpen}
        pageName={pageName}
        ownTitles={adapter.rows.filter((row) => row.own).map((row) => row.title)}
        onConfirm={() => {
          setResetOpen(false);
          adapter.reset();
        }}
        onOpenChange={setResetOpen}
      />
      {importOpen && layoutExport.libraries ? (
        <HomeLayoutImportDialog
          libraries={layoutExport.libraries}
          onClose={() => setImportOpen(false)}
        />
      ) : null}
      {rowDialog ? (
        <AddRowDialog
          adapter={adapter}
          catalog={adapter.catalog}
          catalogFailed={adapter.catalogFailed}
          libraries={libraries ?? []}
          session={rowDialog.session}
          onClose={() => setRowDialog(null)}
          onSaved={(newIds) => setHighlightId(newIds[0] ?? null)}
          deleteLabel={editingRow && !editingRow.own ? `Remove from my ${pageName}…` : undefined}
          onDelete={(session) => {
            setRowDialog(null);
            setRemoving(session.row);
          }}
        />
      ) : null}
    </HomeRowsPage>
  );
}
