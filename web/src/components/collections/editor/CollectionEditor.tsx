import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { useQueries } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SaveBar } from "@/components/SaveBar";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";
import { useAdminCollectionCapabilities } from "@/hooks/queries/admin/collections";
import { useAdminLibraries } from "@/hooks/queries/admin/libraries";
import { createCatalogSearchState, fetchCatalogPage } from "@/hooks/queries/catalog";
import {
  useCollectionDraft,
  useScopeDelete,
  useScopePreview,
  useScopeSync,
} from "@/hooks/queries/collectionScope";
import { useCollectionCapabilities } from "@/hooks/queries/collections";
import { catalogKeys } from "@/hooks/queries/keys";
import { useUserLibraries } from "@/hooks/queries/libraries";
import { useProfiles } from "@/hooks/queries/profiles";
import { useCurrentProfile } from "@/hooks/useCurrentProfile";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useHasUnsavedChanges, useReportUnsavedChanges } from "@/hooks/useUnsavedChanges";
import {
  DRAFT_FIELD_LABEL,
  NAME_FILLED_HELP,
  NAME_IT_THEN_CREATE,
  NOT_CREATED_YET,
  PICK_A_LIBRARY,
  PICK_A_LIST_FIRST,
  PICK_LIBRARIES_FIRST,
  PREVIEW_SHOWS_UNSAVED,
  SAVE_FAILED,
  SMART_UPDATES_ITSELF,
  SYNCED_CREATE_SUBTITLE,
  SYNCS_ON_CREATE,
  TITLES_ALREADY_SAVED,
  firstSyncMessage,
  joinNames,
  keptMessage,
  notSavedMessage,
  personalDeleteDescription,
  serverDeleteDescription,
  titlesReadyToAdd,
} from "@/lib/collections/copy";
import { draftRules, type DraftField } from "@/lib/collections/draft";
import { useListReturnPath } from "@/lib/collections/listReturn";
import type {
  CollectionDraft,
  CollectionScope,
  CreateKind,
  EditorSnapshot,
  WireCollection,
} from "@/lib/collections/scope";
import { savedListProblem, type SyncedDraft, type SyncedTab } from "@/lib/collections/synced";
import { SYNCED_SOURCE_LABEL } from "@/lib/collections/types";
import { buildLibraryCollectionCatalogHref } from "@/pages/catalogSearchParams";

import { LibrariesLine } from "../fields/LibrariesLine";
import { focusLibrariesLine } from "../fields/librariesLineFocus";
import { CollectionEditorShell } from "./CollectionEditorShell";
import { CollectionMetaLine } from "./CollectionMetaLine";
import { ConflictBanner } from "./ConflictBanner";
import { DetailsPanel } from "./DetailsPanel";
import { EditorHeader, type OpenTarget } from "./EditorHeader";
import { CollectionPreviewPane } from "./CollectionPreviewPane";
import { ManualContentsPanel } from "./ManualContentsPanel";
import { SmartRulesPanel } from "./SmartRulesPanel";
import { SyncedListPanel, type SyncedListPanelProps } from "./SyncedListPanel";
import { WhereItShowsPanel } from "./WhereItShowsPanel";

const NO_TITLES: readonly string[] = [];
/** The fields the live preview already reflects before they are saved. */
const PREVIEWED: ReadonlySet<DraftField> = new Set(["rules", "libraryIds", "rawSortConfig"]);

/**
 * "3 titles are only in Kids: …" when unticking libraries would drop titles a
 * server collection holds. Reads each saved library's titles only while an
 * untick is pending.
 */
function useUntickWarning(
  collectionId: string | undefined,
  saved: readonly number[],
  chosen: readonly number[],
  libraries: ReadonlyArray<{ id: number; name: string }>,
) {
  const removed = saved.filter((id) => !chosen.includes(id));
  const pending = Boolean(collectionId) && removed.length > 0;
  const pages = useQueries({
    queries: saved.map((libraryId) => ({
      queryKey: [...catalogKeys.all, "collectionTitlesIn", collectionId, libraryId],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchCatalogPage(
          createCatalogSearchState("library_collection", {
            collection_id: collectionId,
            library_id: libraryId,
            uses_source_order: true,
          }),
          200,
          0,
          { signal },
          false,
        ),
      enabled: pending,
      staleTime: 60 * 1000,
    })),
  });
  if (!pending) return null;
  const kept = new Set(
    saved
      .flatMap((libraryId, index) => (chosen.includes(libraryId) ? [pages[index]] : []))
      .flatMap((page) => page?.data?.items.map((item) => item.content_id) ?? []),
  );
  const onlyRemoved = new Map<string, string>();
  saved.forEach((libraryId, index) => {
    if (chosen.includes(libraryId)) return;
    for (const item of pages[index]?.data?.items ?? []) {
      if (!kept.has(item.content_id)) onlyRemoved.set(item.content_id, item.title);
    }
  });
  if (onlyRemoved.size === 0) return null;
  const names = removed.map((id) => libraries.find((library) => library.id === id)?.name ?? "");
  const titles = [...onlyRemoved.values()];
  const shown = titles.slice(0, 3).join(", ") + (titles.length > 3 ? "…" : "");
  const count = `${titles.length} title${titles.length === 1 ? " is" : "s are"}`;
  return `${count} only in ${joinNames(names.filter(Boolean))}: ${shown}. They'll stop showing when you save.`;
}

/** A Smart collection's rules and their live preview, over the libraries the scope offers. */
function SmartContents<Raw extends WireCollection>({
  scope,
  draft,
  offMessage,
  onChange,
  libraries,
}: {
  scope: CollectionScope<Raw>;
  draft: CollectionDraft;
  /** Why there is no preview while no library is picked. */
  offMessage: string;
  onChange: (update: (draft: CollectionDraft) => CollectionDraft) => void;
  libraries: Array<{ id: number; name: string }>;
}) {
  const needsLibraries = scope.requireLibraries && draft.libraryIds.length === 0;
  const preview = useScopePreview(scope, draftRules(draft), !needsLibraries);
  return (
    <div className="grid gap-6">
      <SmartRulesPanel
        scopeKind={scope.kind}
        draft={draft}
        onChange={onChange}
        libraries={libraries}
      />
      <CollectionPreviewPane preview={preview} offMessage={offMessage} />
    </div>
  );
}

/** A personal Smart collection picks from the libraries the profile can see. */
function PersonalSmartContents<Raw extends WireCollection>(
  props: Omit<Parameters<typeof SmartContents<Raw>>[0], "libraries">,
) {
  const { data = [] } = useUserLibraries();
  return <SmartContents {...props} libraries={data} />;
}

type WithoutLibraries<Props> = Props extends unknown ? Omit<Props, "libraries"> : never;

/** A personal Synced list matches into the libraries the profile can see. */
function PersonalSyncedContents(props: WithoutLibraries<SyncedListPanelProps>) {
  const { data = [] } = useUserLibraries();
  return <SyncedListPanel {...({ ...props, libraries: data } as SyncedListPanelProps)} />;
}

/** Under Name on a new Synced list: whether the pick filled it, or kept what was typed. */
function syncedNameNote(draft: CollectionDraft): string | undefined {
  const synced = draft.synced;
  if (!synced?.list) return undefined;
  const kept = keptMessage(synced.kept);
  if (kept) return kept;
  return draft.name !== "" && draft.name === synced.filled.name ? NAME_FILLED_HELP : undefined;
}

/** Whether anything in a new synced list's step was picked or typed. */
function syncedTouched(synced: SyncedDraft | undefined) {
  return Boolean(
    synced &&
    (synced.list ||
      synced.mdblistLink ||
      synced.tmdbListLink ||
      synced.limit !== undefined ||
      synced.schedule),
  );
}

/**
 * The editor page for every collection type, both scopes, create and edit.
 * A Manual or Smart collection's instance carries on from `/new` to
 * `/:id/edit` after Create; a new Synced list moves to its own edit page,
 * which opens it fresh with its first sync's state.
 */
export function CollectionEditor<Raw extends WireCollection>({
  scope,
  kind: createKind = "manual",
  snapshot,
  libraryId,
  syncedTab,
  onCreated,
}: {
  scope: CollectionScope<Raw>;
  /** Create mode: what to create. A saved collection keeps its own kind. */
  kind?: CreateKind;
  snapshot?: EditorSnapshot<Raw>;
  /** Create mode: the library the editor was opened from. */
  libraryId?: number | null;
  /** Create mode, Synced list: the tab the list step opens on. */
  syncedTab?: SyncedTab;
  /** Create mode, Manual and Smart: told the new id before the page moves to its edit URL. */
  onCreated?: (id: string) => void;
}) {
  const navigate = useNavigate();
  const kind = snapshot ? snapshot.view.kind : createKind;
  const smart = kind === "smart";
  const synced = kind === "synced";
  // A new Synced list leaves for its edit page once it exists.
  const newList = synced && !snapshot;
  const editor = useCollectionDraft(scope, { snapshot, kind, libraryId });
  const { draft, view } = editor;
  const created = Boolean(editor.id) && !newList;
  const isServer = scope.kind === "server";
  useDocumentTitle(created ? `Edit ${view?.name ?? draft.name}` : "New collection");
  const { data: adminLibraries = [] } = useAdminLibraries({ enabled: isServer });
  const { profile } = useCurrentProfile();
  const { data: profiles = [] } = useProfiles({ enabled: !isServer });
  const personalCapabilities = useCollectionCapabilities();
  const adminCapabilities = useAdminCollectionCapabilities(isServer);
  const capabilities = isServer ? adminCapabilities.data : personalCapabilities.data;
  const hasUnsaved = useHasUnsavedChanges();
  const [leaving, setLeaving] = useState<string | null>(null);
  const [openEdit, setOpenEdit] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const listPath = useListReturnPath(
    scope.paths.list({ libraryId: isServer ? (draft.libraryIds[0] ?? null) : null }),
  );
  const remove = useScopeDelete(scope, { onDeleted: () => setLeaving(listPath) });
  const syncList = useScopeSync(scope);
  // How many titles the last sync run here skipped; the collection doesn't carry it.
  const [skipped, setSkipped] = useState<number>();
  // The server records a sync's status only when the run ends, and Sync now
  // answers once it has: the request is the only sync this page can see.
  const syncing = syncList.isPending;
  // Spec §3.1: only server lists offer Sync now here; a profile syncs its
  // lists from their cards on the Collections page.
  const canSync = created && isServer && Boolean(view?.source);
  // Discards put the list's source card back.
  const [discards, setDiscards] = useState(0);

  /** Reads the collection again; a failed read keeps the old token, and Save's 412 merges. */
  function reread() {
    editor.syncWithServer().catch(() => {});
  }

  function syncNow() {
    if (!editor.id || syncing) return;
    syncList.mutate(editor.id, {
      onSuccess: (run) => setSkipped(run.itemsUnmatched),
      // A sync records its run on the collection, even one that fails: read
      // it for the status and so Save sends the new token.
      onSettled: reread,
    });
  }

  const staged = draft.stagedItems ?? NO_TITLES;
  // After Create the page moves to the collection's edit URL. Until it gets
  // there it reports clean, so the guard never asks; a poster that failed to
  // upload then counts as unsaved again.
  const location = useLocation();
  const moving = openEdit !== null && location.pathname !== scope.paths.edit(openEdit);
  const dirty = editor.isDirty || (!created && (staged.length > 0 || syncedTouched(draft.synced)));
  useReportUnsavedChanges(!leaving && !moving && dirty);

  // Leave only once the clean report has reached the guard.
  useEffect(() => {
    if (hasUnsaved) return;
    if (leaving) {
      navigate(leaving, { replace: true });
    } else if (moving && openEdit) {
      navigate(scope.paths.edit(openEdit, { libraryId }), { replace: true });
      // Create unmounts its button; carry on where the contents start.
      if (smart) focusLibrariesLine();
      else if (!newList) document.querySelector<HTMLInputElement>("[data-title-search]")?.focus();
    }
  }, [hasUnsaved, leaving, libraryId, moving, navigate, newList, openEdit, scope, smart]);

  const libraryOptions = adminLibraries.map(({ id, name, type }) => ({ id, name, type }));
  const named = (ids: readonly number[]) =>
    ids.flatMap((id) => {
      const library = libraryOptions.find((entry) => entry.id === id);
      return library ? [{ id, name: library.name }] : [];
    });
  const chosenLibraries = named(draft.libraryIds);
  const savedLibraries = named(view?.libraryIds ?? []);
  const untickWarning = useUntickWarning(
    isServer && kind === "manual" ? editor.id : undefined,
    editor.base.libraryIds,
    draft.libraryIds,
    libraryOptions,
  );
  const otherProfileNames = isServer
    ? []
    : profiles.filter((entry) => entry.id !== profile?.id).map((entry) => entry.name);

  // Open ▾: a server collection opens in each of its libraries; a personal one has one page.
  let open: OpenTarget[] = [];
  if (view && created) {
    open = isServer
      ? savedLibraries.map((library) => ({
          label: library.name,
          href: buildLibraryCollectionCatalogHref(view.id, view.name, library.id),
        }))
      : [{ label: "Open", href: scope.paths.browse(view) }];
  }

  async function create() {
    const result = await editor.create();
    if (!result) return;
    if (newList) {
      const { tone, text } = firstSyncMessage(result.sync);
      const description = result.warnings.length > 0 ? result.warnings.join(" ") : undefined;
      if (tone === "warning" || description) toast.warning(text, { description });
      else toast.success(text);
    } else {
      onCreated?.(result.id);
    }
    setOpenEdit(result.id);
  }

  const needsLibraries = scope.requireLibraries && draft.libraryIds.length === 0;
  const needsList = newList && !draft.synced?.list;
  // A saved list's changed source must be one it can follow.
  const listProblem =
    draft.list && editor.changed.includes("list") ? savedListProblem(draft.list) : null;
  // A created Synced list keeps this bar until it moves to its edit page; one Create is enough.
  const canCreate = !editor.id && draft.name.trim() !== "" && !needsLibraries && !needsList;
  const pending = editor.pendingLabels;
  // What the save bar adds after the pending fields, and before Create.
  let afterPending: string | null = kind === "manual" ? TITLES_ALREADY_SAVED : listProblem;
  let createHint = titlesReadyToAdd(staged.length);
  if (smart) {
    afterPending = editor.changed.some((field) => PREVIEWED.has(field))
      ? PREVIEW_SHOWS_UNSAVED
      : null;
    createHint = NAME_IT_THEN_CREATE;
  }
  if (newList) {
    if (needsList) createHint = PICK_A_LIST_FIRST;
    else if (draft.name.trim() === "") createHint = NAME_IT_THEN_CREATE;
    else createHint = SYNCS_ON_CREATE;
  }
  if (needsLibraries && !needsList) {
    afterPending = PICK_A_LIBRARY;
    createHint = PICK_LIBRARIES_FIRST;
  }
  const saveBar = created ? (
    <SaveBar
      placement="page"
      dirtyCount={pending.length}
      visible={editor.isDirty || Boolean(editor.saveError)}
      isSaving={editor.isSaving}
      saveLabel={editor.saveError ? "Try again" : "Save"}
      canSave={
        draft.name.trim() !== "" && !needsLibraries && !listProblem && editor.conflicts.length === 0
      }
      onSave={() => void editor.save()}
      onDiscard={() => {
        editor.discard();
        setDiscards((count) => count + 1);
      }}
      message={
        editor.saveError ? (
          `${SAVE_FAILED} · ${editor.saveError}`
        ) : (
          <>
            {notSavedMessage(pending)}{" "}
            {afterPending ? (
              <span className="text-muted-foreground ml-3 font-normal">{afterPending}</span>
            ) : null}
          </>
        )
      }
    />
  ) : (
    <SaveBar
      placement="page"
      dirtyCount={0}
      visible
      tone="idle"
      isSaving={editor.isSaving}
      saveLabel="Create collection"
      discardLabel="Cancel"
      canSave={canCreate}
      onSave={() => void create()}
      onDiscard={() => navigate(listPath)}
      message={
        editor.saveError ? (
          `${SAVE_FAILED} · ${editor.saveError}`
        ) : (
          <>
            {NOT_CREATED_YET}{" "}
            <span className="text-muted-foreground ml-3 font-normal">{createHint}</span>
          </>
        )
      }
    />
  );

  // The meta line ends with what keeps the collection filled: its rules or its list.
  let metaExtra: string | undefined;
  if (smart) metaExtra = SMART_UPDATES_ITSELF;
  else if (view?.source) metaExtra = SYNCED_SOURCE_LABEL[view.source];

  const previewOffMessage = created ? PICK_A_LIBRARY : PICK_LIBRARIES_FIRST;
  let contents: ReactNode;
  let panel: WithoutLibraries<SyncedListPanelProps> | null = null;
  const common = { scopeKind: scope.kind, onChange: editor.setDraft, capabilities };
  if (newList && draft.synced) {
    panel = { ...common, draft: { ...draft, synced: draft.synced }, initialTab: syncedTab };
  } else if (synced && draft.list && view) {
    panel = {
      ...common,
      draft: { ...draft, list: draft.list },
      saved: { view, syncing, skipped, onSyncNow: canSync ? syncNow : undefined, discards },
    };
  }
  if (panel) {
    contents = isServer ? (
      <SyncedListPanel {...({ ...panel, libraries: libraryOptions } as SyncedListPanelProps)} />
    ) : (
      <PersonalSyncedContents {...panel} />
    );
  } else if (smart && isServer) {
    contents = (
      <SmartContents
        scope={scope}
        draft={draft}
        offMessage={previewOffMessage}
        onChange={editor.setDraft}
        libraries={libraryOptions}
      />
    );
  } else if (smart) {
    contents = (
      <PersonalSmartContents
        scope={scope}
        draft={draft}
        offMessage={previewOffMessage}
        onChange={editor.setDraft}
      />
    );
  } else {
    contents = (
      <ManualContentsPanel
        scope={scope}
        collectionId={editor.id}
        searchLibraries={isServer ? chosenLibraries : []}
        librariesLine={
          isServer ? (
            <LibrariesLine
              lead="Titles from"
              libraries={libraryOptions}
              value={draft.libraryIds}
              onChange={(libraryIds) => editor.setDraft((next) => ({ ...next, libraryIds }))}
              warning={
                untickWarning ? (
                  <p
                    role="note"
                    className="border-warning/50 bg-warning/10 flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-[13px]"
                  >
                    <AlertTriangle aria-hidden className="text-warning mt-0.5 size-4 shrink-0" />
                    {untickWarning}
                  </p>
                ) : null
              }
            />
          ) : null
        }
        staged={staged}
        onStagedChange={(stagedItems) => editor.setDraft((next) => ({ ...next, stagedItems }))}
        onRetryStaged={(position) => void editor.retryStagedItems(position)}
        itemCount={view?.itemCount}
        onItemsChanged={reread}
      />
    );
  }

  return (
    <>
      <UnsavedChangesGuard />
      <CollectionEditorShell
        createMode={!created}
        contentsLabel={synced ? "The list" : smart ? "Rules" : "Titles"}
        header={
          <EditorHeader
            back={{ label: "Collections", href: listPath }}
            kind={kind}
            name={view?.name ?? draft.name}
            created={created}
            shared={view?.personal?.shared}
            posterUrl={view?.posterUrl ?? draft.synced?.posterUrl}
            meta={
              newList ? (
                <p className="text-muted-foreground text-[14px]">{SYNCED_CREATE_SUBTITLE}</p>
              ) : view ? (
                <CollectionMetaLine
                  libraryNames={
                    isServer ? savedLibraries.map((library) => library.name) : undefined
                  }
                  itemCount={view.itemCount}
                  extra={metaExtra}
                />
              ) : null
            }
            open={open}
            sync={canSync ? { syncing, onSyncNow: syncNow } : undefined}
            onDelete={() => setConfirmDelete(true)}
          />
        }
        banner={
          editor.conflicts.length > 0 ? (
            <ConflictBanner
              fields={editor.conflicts.map((field) => DRAFT_FIELD_LABEL[field])}
              onKeepMine={() => editor.resolveConflicts("mine")}
              onUseTheirs={() => editor.resolveConflicts("theirs")}
            />
          ) : null
        }
        contents={contents}
        details={
          <DetailsPanel
            draft={draft}
            onChange={editor.setDraft}
            showOnly={!isServer && !smart}
            nameNote={synced ? syncedNameNote(draft) : undefined}
            artworkSlots={capabilities?.artwork === false ? [] : scope.artworkSlots}
            savedArtwork={{
              // A new Synced list starts with its pick's poster.
              poster: view?.posterUrl ?? draft.synced?.posterUrl,
              backdrop: view?.backdropUrl,
            }}
            artworkErrors={editor.artworkErrors}
            onRetryArtwork={() => void editor.save()}
          />
        }
        where={
          <WhereItShowsPanel
            scopeKind={scope.kind}
            collectionId={created ? editor.id : undefined}
            draft={draft}
            onChange={editor.setDraft}
            libraries={chosenLibraries}
            otherProfileNames={otherProfileNames}
            savedShared={view?.personal?.shared ?? false}
          />
        }
        footer={saveBar}
      />
      {view && editor.etag ? (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Delete "${view.name}"?`}
          description={
            isServer
              ? serverDeleteDescription(savedLibraries.map((library) => library.name))
              : personalDeleteDescription(view.personal?.shared ?? false)
          }
          confirmLabel="Delete"
          variant="destructive"
          isPending={remove.isPending}
          onConfirm={() => remove.mutate({ id: view.id, etag: editor.etag! })}
        />
      ) : null}
    </>
  );
}
