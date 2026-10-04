import { useCallback, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import {
  adminSectionMutationMessage,
  fetchAdminSectionSnapshot,
  reorderAdminSections,
  updateAdminSection,
  type fetchAdminSections,
} from "@/api/adminSections";
import type { PageSectionConfig } from "@/api/types";
import { V2ProblemError } from "@/api/v2/request";
import { useAdminLibraries } from "@/hooks/queries/admin/libraries";
import { sectionKeys } from "@/hooks/queries/keys";
import { useAdminSectionCapabilities, useAdminSections } from "@/hooks/queries/sections";
import { pageParam, parsePageParam, samePage } from "@/lib/homeRows/pages";
import type {
  HomeRow,
  HomeRowsAdapter,
  HomeRowsConflict,
  HomeRowsPageOption,
  PageRef,
} from "@/lib/homeRows/types";
import { isTraktConfig } from "@/lib/sectionTypes";

type AdminSectionList = Awaited<ReturnType<typeof fetchAdminSections>>;
type QuickField = "shown" | "hero";

/** Lists stay under 10,000 rows; past that a full-order PUT is refused anyway. */
const MAX_REORDER_ROWS = 10000;

function toHomeRow(section: PageSectionConfig): HomeRow {
  return {
    id: section.id,
    title: section.title,
    sectionType: section.section_type,
    config: section.config ?? {},
    itemLimit: section.item_limit,
    hero: section.featured,
    shown: section.enabled,
    own: false,
    legacyTrakt: isTraktConfig(section.config),
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Whether the row the server holds now is the row this page is showing. */
function sameRow(a: PageSectionConfig, b: PageSectionConfig): boolean {
  return (
    a.title === b.title &&
    a.section_type === b.section_type &&
    a.enabled === b.enabled &&
    a.featured === b.featured &&
    a.item_limit === b.item_limit &&
    stableJson(a.config) === stableJson(b.config)
  );
}

function orderRows(sections: PageSectionConfig[], draft: string[] | null): PageSectionConfig[] {
  if (!draft) return sections;
  const byId = new Map(sections.map((section) => [section.id, section]));
  const ordered = draft.flatMap((id) => byId.get(id) ?? []);
  const placed = new Set(draft);
  return [...ordered, ...sections.filter((section) => !placed.has(section.id))];
}

/** The row or page moved on (412), or the row is gone (404). */
function isStale(error: unknown) {
  return error instanceof V2ProblemError && (error.status === 412 || error.status === 404);
}

export interface AdminHomeRows extends HomeRowsAdapter {
  scope: "home" | "library";
  libraryId: number | undefined;
  /** The page's rows as the server sent them, for the edit and delete flows. */
  sections: PageSectionConfig[];
  capabilities: ReturnType<typeof useAdminSectionCapabilities>["data"];
}

/**
 * The admin Home rows adapter. Reads one page's rows and runs every list write
 * (switch, hero, reorder) one at a time. Each write keeps `pending` set until
 * the refetch after it lands, because any row write bumps the page version a
 * reorder is checked against. Quick actions first read the row and refuse to
 * write when it no longer matches what the page shows.
 */
export function useAdminHomeRows(): AdminHomeRows {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: librariesData } = useAdminLibraries();
  const libraries = useMemo(() => librariesData ?? [], [librariesData]);
  const rawPage = searchParams.get("page");
  // A library link can only be checked once the libraries load; until then the
  // page waits instead of showing Home for a moment.
  const pageKnown = librariesData !== undefined || rawPage === null || rawPage === "home";
  const page = parsePageParam(
    rawPage,
    libraries.map((library) => library.id),
  );
  const scope = page.kind;
  const libraryId = page.kind === "library" ? page.libraryId : undefined;
  const pages = useMemo<HomeRowsPageOption[]>(
    () => [
      { ref: { kind: "home" }, label: "Home" },
      ...libraries.map((library) => ({
        ref: { kind: "library" as const, libraryId: library.id },
        label: library.name,
      })),
    ],
    [libraries],
  );

  const list = useAdminSections(scope, libraryId, pageKnown);
  const { data: capabilities } = useAdminSectionCapabilities();
  const [draft, setDraft] = useState<string[] | null>(null);
  const [conflict, setConflict] = useState<HomeRowsConflict>(null);
  const [optimistic, setOptimistic] = useState<
    Record<string, Partial<Record<QuickField, boolean>>>
  >({});
  const [pendingCount, setPendingCount] = useState(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = pendingCount > 0;

  const sections = useMemo(() => list.data?.sections ?? [], [list.data?.sections]);
  const rows = useMemo(
    () =>
      orderRows(sections, draft).map((section) => {
        const override = optimistic[section.id];
        const mapped = toHomeRow(section);
        return override ? { ...mapped, ...override } : mapped;
      }),
    [sections, draft, optimistic],
  );

  const status: HomeRowsAdapter["status"] =
    !pageKnown || list.isLoading ? "loading" : list.isError && !list.data ? "error" : "ready";
  // A refetch that fails after a good read (for example "Sections changed while
  // loading") keeps the old rows on screen but marks them out of date.
  const effectiveConflict: HomeRowsConflict =
    conflict ?? (list.isError && list.data ? { scope: "page" } : null);
  const canEdit = status === "ready" && !list.isError && Boolean(capabilities?.available);
  const canReorder =
    canEdit &&
    !pending &&
    effectiveConflict === null &&
    draft === null &&
    Boolean(list.data?.etag) &&
    rows.length <= MAX_REORDER_ROWS;

  const enqueue = useCallback((job: () => Promise<void>) => {
    setPendingCount((count) => count + 1);
    const run = queue.current.then(job).finally(() => setPendingCount((count) => count - 1));
    queue.current = run.catch(() => undefined);
    return run;
  }, []);

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: sectionKeys.all }),
    [queryClient],
  );

  const currentList = useCallback(
    () =>
      queryClient.getQueryData<AdminSectionList>(sectionKeys.adminList(scope, libraryId))
        ?.sections ?? [],
    [queryClient, scope, libraryId],
  );

  const quickAction = useCallback(
    (id: string, field: QuickField, value: boolean) => {
      const clearOptimistic = () =>
        setOptimistic((current) => {
          const { [field]: _dropped, ...rest } = current[id] ?? {};
          const next = { ...current };
          if (Object.keys(rest).length > 0) next[id] = rest;
          else delete next[id];
          return next;
        });
      setOptimistic((current) => ({ ...current, [id]: { ...current[id], [field]: value } }));
      return enqueue(async () => {
        try {
          const onScreen = currentList().find((section) => section.id === id);
          const snapshot = await fetchAdminSectionSnapshot(id);
          if (!onScreen || !sameRow(snapshot.section, onScreen)) {
            setConflict({ scope: "row", rowId: id });
            return;
          }
          await updateAdminSection({
            id,
            etag: snapshot.etag,
            ...(field === "shown" ? { enabled: value } : { featured: value }),
          });
          await refresh();
        } catch (error) {
          if (isStale(error)) setConflict({ scope: "row", rowId: id });
          else toast.error(adminSectionMutationMessage(error, "Could not save this row"));
        } finally {
          clearOptimistic();
        }
      });
    },
    [currentList, enqueue, refresh],
  );

  const reorder = useCallback(
    (orderedIds: string[], orderToken?: unknown) => {
      const etag = typeof orderToken === "string" ? orderToken : (list.data?.etag ?? "");
      setDraft(orderedIds);
      return enqueue(async () => {
        try {
          await reorderAdminSections({
            scope,
            library_id: libraryId,
            etag,
            ordered_ids: orderedIds,
          });
          await refresh();
          setDraft(null);
        } catch (error) {
          if (isStale(error)) {
            setConflict({ scope: "page" });
          } else {
            setDraft(null);
            toast.error(adminSectionMutationMessage(error, "Could not move this row"));
          }
        }
      });
    },
    [enqueue, libraryId, list.data?.etag, refresh, scope],
  );

  const reload = useCallback(async () => {
    const result = await list.refetch();
    if (!result.isError) {
      setConflict(null);
      setDraft(null);
    }
  }, [list]);

  const setPage = useCallback(
    (ref: PageRef) => {
      if (pending || samePage(ref, page)) return;
      setDraft(null);
      setConflict(null);
      setOptimistic({});
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set("page", pageParam(ref));
          return next;
        },
        { replace: true },
      );
    },
    [page, pending, setSearchParams],
  );

  return {
    surface: "admin",
    page,
    pages,
    setPage,
    status,
    error: list.error instanceof Error ? list.error.message : null,
    canEdit,
    rows,
    pending,
    conflict: effectiveConflict,
    reload,
    canReorder,
    orderToken: list.data?.etag,
    reorder,
    setShown: (id, shown) => quickAction(id, "shown", shown),
    setHero: (id, hero) => quickAction(id, "hero", hero),
    scope,
    libraryId,
    sections,
    capabilities,
  };
}
