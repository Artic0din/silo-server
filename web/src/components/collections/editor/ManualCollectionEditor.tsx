import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useQueries } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SaveBar } from "@/components/SaveBar";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";
import { useAdminCollectionCapabilities } from "@/hooks/queries/admin/collections";
import { useAdminLibraries } from "@/hooks/queries/admin/libraries";
import { createCatalogSearchState, fetchCatalogPage } from "@/hooks/queries/catalog";
import {
  isArtworkStaged,
  useCollectionDraft,
  useScopeDelete,
} from "@/hooks/queries/collectionScope";
import { useCollectionCapabilities } from "@/hooks/queries/collections";
import { catalogKeys } from "@/hooks/queries/keys";
import { useProfiles } from "@/hooks/queries/profiles";
import { useCurrentProfile } from "@/hooks/useCurrentProfile";
import { useHasUnsavedChanges, useReportUnsavedChanges } from "@/hooks/useUnsavedChanges";
import {
  DRAFT_FIELD_LABEL,
  NOT_CREATED_YET,
  SAVE_FAILED,
  TITLES_ALREADY_SAVED,
  joinNames,
  notSavedMessage,
  personalDeleteDescription,
  serverDeleteDescription,
  titlesReadyToAdd,
} from "@/lib/collections/copy";
import type { CollectionScope, EditorSnapshot, WireCollection } from "@/lib/collections/scope";
import { buildLibraryCollectionCatalogHref } from "@/pages/catalogSearchParams";

import { LibrariesLine } from "../fields/LibrariesLine";
import { CollectionEditorShell } from "./CollectionEditorShell";
import { CollectionMetaLine } from "./CollectionMetaLine";
import { ConflictBanner } from "./ConflictBanner";
import { DetailsPanel } from "./DetailsPanel";
import { EditorHeader, type OpenTarget } from "./EditorHeader";
import { ManualContentsPanel } from "./ManualContentsPanel";
import { WhereItShowsPanel } from "./WhereItShowsPanel";

const NO_TITLES: readonly string[] = [];

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

/**
 * The editor page for a Manual collection, both scopes, create and edit.
 * The same instance carries on from `/new` to `/:id/edit` after Create.
 */
export function ManualCollectionEditor<Raw extends WireCollection>({
  scope,
  snapshot,
  libraryId,
  onCreated,
}: {
  scope: CollectionScope<Raw>;
  snapshot?: EditorSnapshot<Raw>;
  /** Create mode: the library the editor was opened from. */
  libraryId?: number | null;
  /** Create mode: told the new id before the page moves to its edit URL. */
  onCreated?: (id: string) => void;
}) {
  const navigate = useNavigate();
  const editor = useCollectionDraft(scope, { snapshot, kind: "manual", libraryId });
  const { draft, view } = editor;
  const created = Boolean(editor.id);
  const isServer = scope.kind === "server";
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
  const listPath = scope.paths.list({ libraryId: isServer ? (draft.libraryIds[0] ?? null) : null });
  const remove = useScopeDelete(scope, { onDeleted: () => setLeaving(listPath) });

  const staged = draft.stagedItems ?? NO_TITLES;
  const createDirty =
    draft.name.trim() !== "" ||
    draft.description.trim() !== "" ||
    staged.length > 0 ||
    Object.values(draft.artwork).some(isArtworkStaged);
  // After Create the page moves to the collection's edit URL. Until it gets
  // there it reports clean, so the guard never asks; a poster that failed to
  // upload then counts as unsaved again.
  const location = useLocation();
  const moving = openEdit !== null && location.pathname !== scope.paths.edit(openEdit);
  useReportUnsavedChanges(!leaving && !moving && (created ? editor.isDirty : createDirty));

  // Leave only once the clean report has reached the guard.
  useEffect(() => {
    if (hasUnsaved) return;
    if (leaving) {
      navigate(leaving, { replace: true });
    } else if (moving && openEdit) {
      navigate(scope.paths.edit(openEdit, { libraryId }), { replace: true });
      document.querySelector<HTMLInputElement>("[data-title-search]")?.focus();
    }
  }, [hasUnsaved, leaving, libraryId, moving, navigate, openEdit, scope]);

  const libraryOptions = adminLibraries.map(({ id, name, type }) => ({ id, name, type }));
  const named = (ids: readonly number[]) =>
    ids.flatMap((id) => {
      const library = libraryOptions.find((entry) => entry.id === id);
      return library ? [{ id, name: library.name }] : [];
    });
  const chosenLibraries = named(draft.libraryIds);
  const savedLibraries = named(view?.libraryIds ?? []);
  const untickWarning = useUntickWarning(
    isServer ? editor.id : undefined,
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
    onCreated?.(result.id);
    setOpenEdit(result.id);
  }

  const canCreate =
    draft.name.trim() !== "" && (!scope.requireLibraries || draft.libraryIds.length > 0);
  const pending = editor.pendingLabels;
  const saveBar = created ? (
    <SaveBar
      placement="page"
      dirtyCount={pending.length}
      visible={editor.isDirty || Boolean(editor.saveError)}
      isSaving={editor.isSaving}
      saveLabel={editor.saveError ? "Try again" : "Save"}
      canSave={draft.name.trim() !== "" && editor.conflicts.length === 0}
      onSave={() => void editor.save()}
      onDiscard={editor.discard}
      message={
        editor.saveError ? (
          `${SAVE_FAILED} · ${editor.saveError}`
        ) : (
          <>
            {notSavedMessage(pending)}{" "}
            <span className="text-muted-foreground ml-3 font-normal">{TITLES_ALREADY_SAVED}</span>
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
            <span className="text-muted-foreground ml-3 font-normal">
              {titlesReadyToAdd(staged.length)}
            </span>
          </>
        )
      }
    />
  );

  return (
    <>
      <UnsavedChangesGuard />
      <CollectionEditorShell
        createMode={!created}
        contentsLabel="Titles"
        header={
          <EditorHeader
            back={{ label: "Collections", href: listPath }}
            kind="manual"
            name={view?.name ?? draft.name}
            created={created}
            shared={view?.personal?.shared}
            posterUrl={view?.posterUrl}
            meta={
              view ? (
                <CollectionMetaLine
                  libraryNames={
                    isServer ? savedLibraries.map((library) => library.name) : undefined
                  }
                  itemCount={view.itemCount}
                />
              ) : null
            }
            open={open}
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
        contents={
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
                        <AlertTriangle
                          aria-hidden
                          className="text-warning mt-0.5 size-4 shrink-0"
                        />
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
            onItemsChanged={() => void editor.syncWithServer()}
          />
        }
        details={
          <DetailsPanel
            draft={draft}
            onChange={editor.setDraft}
            showOnly={!isServer}
            artworkSlots={capabilities?.artwork === false ? [] : scope.artworkSlots}
            savedArtwork={{ poster: view?.posterUrl, backdrop: view?.backdropUrl }}
            artworkErrors={editor.artworkErrors}
            onRetryArtwork={() => void editor.save()}
          />
        }
        where={
          <WhereItShowsPanel
            scopeKind={scope.kind}
            collectionId={editor.id}
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
