import { useCallback, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { arrayMove } from "@dnd-kit/sortable";
import { toast } from "sonner";
import type { SectionOverride, SettingsSectionEntry } from "@/api/types";
import { sectionKeys } from "@/hooks/queries/keys";
import {
  replaceProfileSectionOverrides,
  resetProfileSectionOverrides,
  useProfileSectionOverrides,
  useProfileSectionSettings,
} from "@/hooks/queries/sections";
import { HOME_PAGE, samePage } from "@/lib/homeRows/pages";
import { nextAppendPosition } from "@/lib/homeRows/payloads";
import {
  applySectionDeletion,
  buildSectionOverrides,
  canMutateSectionSettings,
  createOverrideIdSource,
  hydrateRemovedSystemSections,
  sectionSaveErrorMessage,
  type RemovedSystemOverride,
} from "@/lib/homeRows/profileOverrides";
import type { PageRef } from "@/lib/homeRows/types";

/** One page as the profile edits it: its rows in order and the server rows it removed. */
interface PageState {
  sections: SettingsSectionEntry[];
  removed: RemovedSystemOverride[];
}

type QueueEntry =
  | { kind: "save"; page: PageRef; state: PageState; changedIds: Set<string> }
  | { kind: "reset"; page: PageRef };

interface SaveQueue {
  running: boolean;
  /** The newest state not yet sent; a later change replaces it. */
  next: QueueEntry | null;
}

const NO_SECTIONS: SettingsSectionEntry[] = [];

function idList(ids: string | readonly string[]): readonly string[] {
  return typeof ids === "string" ? [ids] : ids;
}

function pageQuery(page: PageRef) {
  return {
    scope: page.kind,
    libraryId: page.kind === "library" ? page.libraryId : undefined,
    libraryKey: page.kind === "library" ? String(page.libraryId) : undefined,
  };
}

export interface ProfileHomeRows {
  page: PageRef;
  /** Returns false, and stays on this page, while this page still has saves to send. */
  setPage(ref: PageRef): boolean;
  scope: "home" | "library";
  libraryId: number | undefined;
  /** The page's rows in order, including changes not saved yet. */
  sections: SettingsSectionEntry[];
  /** The page's rows as last read, without changes not saved yet. */
  savedSections: SettingsSectionEntry[];
  /** Both the rows and the saved overrides have loaded. */
  ready: boolean;
  /** The rows are still loading for the first time. */
  loading: boolean;
  /** Why the rows failed to load, when they did and none are on screen. */
  loadError: Error | null;
  /** Reads the rows and the saved overrides again. */
  reload(): Promise<void>;
  /** Changes save only when the page is ready and no reset is in flight. */
  canEdit: boolean;
  /** The saved overrides failed to load, so editing stays off. */
  overridesFailed: boolean;
  /** A save or reset, or the refetch after it, is still in flight. */
  pending: boolean;
  setHidden(id: string, hidden: boolean): void;
  /** Moves `activeId` to where `overId` is. */
  move(activeId: string, overId: string): void;
  /** Replaces the row with the same id, or adds it at the bottom. */
  saveSection(section: SettingsSectionEntry): void;
  /** Removes server rows from this page and deletes the profile's own rows, in one save. */
  remove(ids: string | readonly string[]): void;
  /** Drops every override this profile saved for the page. */
  reset(): void;
  /** When this tab last saved a change to the row, in ms since the epoch. */
  lastWriteAt(rowId: string): number | undefined;
}

/**
 * Settings > Home Screen: one page's rows for this profile, and every write to
 * them. A save replaces the page's whole override set and the server checks no
 * version, so saves go out one at a time: changes made while one is in flight
 * merge into a single next save that carries every row they touched, and the
 * newest state wins. A failed save puts the last saved state back unless a
 * newer change is still to be sent. The page can't be switched until its saves
 * and the refetch after them land.
 */
export function useProfileHomeRows(): ProfileHomeRows {
  const queryClient = useQueryClient();
  const [page, setPageState] = useState<PageRef>(HOME_PAGE);
  const { scope, libraryId } = pageQuery(page);
  const settingsQuery = useProfileSectionSettings(scope, libraryId);
  const rawOverridesQuery = useProfileSectionOverrides(scope, libraryId);

  const [draft, setDraftState] = useState<PageState | null>(null);
  // Mirrors `draft` so changes made in one event build on each other.
  const draftRef = useRef<PageState | null>(null);
  const [pending, setPending] = useState(false);
  const [resetting, setResetting] = useState(false);
  const queue = useRef<SaveQueue>({ running: false, next: null });
  // New override IDs for admin rows on this page, reused until the page changes.
  const newOverrideId = useRef(createOverrideIdSource());
  const writes = useRef(new Map<string, number>());

  const ready = canMutateSectionSettings(settingsQuery, rawOverridesQuery);
  const canEdit = ready && !resetting;

  const setDraft = useCallback((next: PageState | null) => {
    draftRef.current = next;
    setDraftState(next);
  }, []);

  const serverSections = settingsQuery.data?.sections;
  const savedOverrides = rawOverridesQuery.data?.overrides;
  const sections = useMemo(() => draft?.sections ?? serverSections ?? [], [draft, serverSections]);

  const send = useCallback(
    async (entry: QueueEntry) => {
      const { scope, libraryKey } = pageQuery(entry.page);
      if (entry.kind === "reset") {
        await resetProfileSectionOverrides({ scope, libraryId: libraryKey });
        return;
      }
      // Built when sent, against the page and overrides as last read, so it
      // keeps the override IDs the save before it stored and stores only what
      // this profile changed.
      const overrides = buildSectionOverrides(entry.state.sections, entry.state.removed, {
        savedOverrides: queryClient.getQueryData<{ overrides: SectionOverride[] }>(
          sectionKeys.profileOverridesRaw(scope, libraryKey),
        )?.overrides,
        baseline: queryClient.getQueryData<{ sections: SettingsSectionEntry[] }>(
          sectionKeys.profileOverrides(scope, libraryKey),
        )?.sections,
        newId: newOverrideId.current,
        changedSectionIds: entry.changedIds,
      });
      await replaceProfileSectionOverrides({ scope, library_id: libraryKey, overrides });
      const now = Date.now();
      for (const id of entry.changedIds) writes.current.set(id, now);
    },
    [queryClient],
  );

  const drain = useCallback(async () => {
    const q = queue.current;
    if (q.running) return;
    q.running = true;
    setPending(true);
    while (q.next) {
      const entry = q.next;
      q.next = null;
      try {
        await send(entry);
        if (entry.kind === "reset") toast.success("Sections reset to default");
      } catch (error) {
        if (entry.kind === "reset") {
          toast.error("Failed to reset section customizations");
        } else {
          toast.error(sectionSaveErrorMessage(error));
          // A newer change still to be sent carries the user's latest state; keep it.
          if (!q.next) setDraft(null);
        }
      }
      // A failed save may still have landed, so refetch after every attempt.
      await queryClient.invalidateQueries({ queryKey: sectionKeys.all });
    }
    q.running = false;
    setDraft(null);
    setResetting(false);
    setPending(false);
  }, [queryClient, send, setDraft]);

  const change = useCallback(
    (ids: string | readonly string[], edit: (state: PageState) => PageState | null) => {
      if (!canEdit) return;
      const base = draftRef.current ?? {
        sections: serverSections ?? [],
        removed: hydrateRemovedSystemSections(savedOverrides),
      };
      const next = edit(base);
      if (!next) return;
      setDraft(next);
      const q = queue.current;
      const changedIds = new Set(q.next?.kind === "save" ? q.next.changedIds : []);
      for (const id of idList(ids)) changedIds.add(id);
      q.next = { kind: "save", page, state: next, changedIds };
      void drain();
    },
    [canEdit, drain, page, savedOverrides, serverSections, setDraft],
  );

  const setHidden = useCallback(
    (id: string, hidden: boolean) =>
      change(id, (state) => ({
        ...state,
        sections: state.sections.map((s) => (s.id === id ? { ...s, hidden } : s)),
      })),
    [change],
  );

  const move = useCallback(
    (activeId: string, overId: string) =>
      change(activeId, (state) => {
        const from = state.sections.findIndex((s) => s.id === activeId);
        const to = state.sections.findIndex((s) => s.id === overId);
        if (from === -1 || to === -1 || from === to) return null;
        return { ...state, sections: arrayMove(state.sections, from, to) };
      }),
    [change],
  );

  const saveSection = useCallback(
    (section: SettingsSectionEntry) =>
      change(section.id, (state) => ({
        ...state,
        sections: state.sections.some((s) => s.id === section.id)
          ? state.sections.map((s) => (s.id === section.id ? section : s))
          : [
              ...state.sections,
              { ...section, position: nextAppendPosition(state.sections.map((s) => s.position)) },
            ],
      })),
    [change],
  );

  // A removed row is not on the page any more, so naming it changes nothing
  // the save leaves out; it only records the write. Several go in one save:
  // the server refuses a save that still holds any rule row while rule rows
  // are off, so deleting them one save at a time would never get through.
  const remove = useCallback(
    (ids: string | readonly string[]) =>
      change(ids, (state) =>
        idList(ids).reduce<PageState>((current, id) => {
          const next = applySectionDeletion(current.sections, current.removed, id);
          return { sections: next.sections, removed: next.removedSystemSections };
        }, state),
      ),
    [change],
  );

  const reset = useCallback(() => {
    if (!canEdit) return;
    // Edits wait for the reset: until the page refetches they would be built on
    // the overrides it drops and save them again.
    setResetting(true);
    queue.current.next = { kind: "reset", page };
    void drain();
  }, [canEdit, drain, page]);

  const setPage = useCallback(
    (ref: PageRef) => {
      if (queue.current.running) return false;
      if (samePage(ref, page)) return true;
      newOverrideId.current = createOverrideIdSource();
      setDraft(null);
      setPageState(ref);
      return true;
    },
    [page, setDraft],
  );

  const lastWriteAt = useCallback((rowId: string) => writes.current.get(rowId), []);

  const { refetch: refetchSettings } = settingsQuery;
  const { refetch: refetchOverrides } = rawOverridesQuery;
  const reload = useCallback(async () => {
    await Promise.all([refetchSettings(), refetchOverrides()]);
  }, [refetchOverrides, refetchSettings]);

  return {
    page,
    setPage,
    scope,
    libraryId,
    sections,
    savedSections: serverSections ?? NO_SECTIONS,
    ready,
    loading: settingsQuery.isLoading,
    loadError: settingsQuery.data ? null : settingsQuery.error,
    reload,
    canEdit,
    overridesFailed: rawOverridesQuery.isError,
    pending,
    setHidden,
    move,
    saveSection,
    remove,
    reset,
    lastWriteAt,
  };
}
