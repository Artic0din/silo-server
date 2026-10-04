/**
 * Poster peeks: the first few titles shown at the start of each row in the
 * Home rows list. Each peek is one request, so they load only once their row
 * is on screen, stay fresh for a few minutes, and share one small budget of
 * requests in flight.
 */
import { previewSection } from "@/lib/recipes";
import { pageParam } from "./pages";
import { stableJson, type RowDraft } from "./rowDraft";
import type { HomeRow, PageRef } from "./types";

/** Titles a peek asks for. Phones show the first two. */
export const PEEK_ITEM_LIMIT = 3;
/** Peeks loading at once across the page. */
export const PEEK_MAX_IN_FLIGHT = 4;
export const PEEK_STALE_MS = 5 * 60 * 1000;
export const PEEK_GC_MS = 30 * 60 * 1000;

/** One title in a peek or a preview strip. */
export interface PreviewItem {
  id: string;
  title: string;
  posterUrl?: string;
  thumbhash?: string;
}

/**
 * The admin preview of a row definition on a page: its first `limit` titles
 * and how many match in all.
 */
export async function fetchRowPreview(
  row: Pick<RowDraft, "sectionType" | "config">,
  page: PageRef,
  limit: number,
  signal?: AbortSignal,
): Promise<{ items: PreviewItem[]; totalCount: number }> {
  const result = await previewSection(
    {
      section_type: row.sectionType,
      config: row.config,
      item_limit: limit,
      ...(page.kind === "library" ? { library_id: page.libraryId } : {}),
    },
    signal,
  );
  return {
    items: result.items.map((item) => ({
      id: item.content_id,
      title: item.title ?? "",
      posterUrl: item.poster_path || undefined,
      thumbhash: item.poster_thumbhash || undefined,
    })),
    totalCount: result.total_count,
  };
}

/** What a surface hands a row's peek: a cache key that names the row's definition, and its fetch. */
export interface PeekRequest {
  queryKey: readonly unknown[];
  fetch(signal: AbortSignal): Promise<PreviewItem[]>;
}

/**
 * An admin peek previews the row's definition, so the key carries everything
 * the preview reads: the page, the kind and the config. Kept outside
 * `sectionKeys`, which every row write invalidates.
 */
export function adminPeekKey(page: PageRef, row: HomeRow): readonly unknown[] {
  return [
    "home-row-peek",
    "admin",
    pageParam(page),
    row.id,
    row.sectionType,
    stableJson(row.config),
  ];
}

/**
 * Runs at most `max` tasks at once; the rest wait in order. A waiting task
 * whose signal aborts leaves the line without ever running.
 */
export function createLimiter(max: number) {
  let running = 0;
  const waiting: Array<() => void> = [];

  function release() {
    // Hand the slot straight to the next task so nothing can slip in between.
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  }

  function acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (running < max) {
      running += 1;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const start = () => {
        signal?.removeEventListener("abort", leave);
        resolve();
      };
      const leave = () => {
        waiting.splice(waiting.indexOf(start), 1);
        reject(signal?.reason);
      };
      waiting.push(start);
      signal?.addEventListener("abort", leave, { once: true });
    });
  }

  return async function run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await acquire(signal);
    try {
      return await task();
    } finally {
      release();
    }
  };
}

/** The one budget every peek on the page shares. */
export const runPeek = createLimiter(PEEK_MAX_IN_FLIGHT);
