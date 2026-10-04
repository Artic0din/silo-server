import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useDebounce } from "@/hooks/useDebounce";
import { pageParam } from "@/lib/homeRows/pages";
import { stableJson, type RowDraft } from "@/lib/homeRows/rowDraft";
import type { PageRef } from "@/lib/homeRows/types";
import { previewSection } from "@/lib/recipes";

/** How many titles the step 2 and Edit row strip shows. */
export const PREVIEW_ITEM_LIMIT = 7;
const PREVIEW_DEBOUNCE_MS = 400;

export interface PreviewItem {
  id: string;
  title: string;
  posterUrl?: string;
  thumbhash?: string;
}

export type PreviewState =
  | { status: "off" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; items: PreviewItem[]; totalCount: number };

/**
 * A live preview of a draft row, from the admin preview route. The draft is
 * debounced so typing does not send a request per keystroke, and the last
 * result stays on screen while the next one loads.
 */
export function useRowPreview(
  draft: Pick<RowDraft, "sectionType" | "config">,
  page: PageRef,
  enabled: boolean,
): PreviewState {
  // A string, so a re-render with an equal draft does not restart the wait.
  const current = stableJson({ sectionType: draft.sectionType, config: draft.config });
  const settled = useDebounce(current, PREVIEW_DEBOUNCE_MS);
  const query = useQuery({
    queryKey: ["home-row-preview", pageParam(page), settled, PREVIEW_ITEM_LIMIT],
    queryFn: async () => {
      const { sectionType, config } = JSON.parse(settled) as Pick<
        RowDraft,
        "sectionType" | "config"
      >;
      const result = await previewSection({
        section_type: sectionType,
        config,
        item_limit: PREVIEW_ITEM_LIMIT,
        ...(page.kind === "library" ? { library_id: page.libraryId } : {}),
      });
      return {
        items: result.items.map((item) => ({
          id: item.content_id,
          title: item.title ?? "",
          posterUrl: item.poster_path || undefined,
          thumbhash: item.poster_thumbhash || undefined,
        })),
        totalCount: result.total_count,
      };
    },
    // Only once the draft has stopped changing; the last result stays meanwhile.
    enabled: enabled && settled === current && draft.sectionType !== "",
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  if (!enabled) return { status: "off" };
  if (query.data) return { status: "ready", ...query.data };
  if (query.isError) return { status: "error" };
  return { status: "loading" };
}
