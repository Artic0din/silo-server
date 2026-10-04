import { sectionLibraryFilterIds } from "@/lib/sectionLibraryFilter";
import { isTraktConfig } from "@/lib/sectionTypes";
import type { RowDraft } from "./rowDraft";
import type { PageRef } from "./types";

/**
 * Kinds whose settings belong to the page they were made on: a collection or
 * hand-picked titles from one library, rules written for one library, and
 * the kinds no longer offered for new rows.
 */
const PAGE_BOUND_TYPES: ReadonlySet<string> = new Set([
  "collection",
  "custom_filter",
  "admin_curated_list",
  "genre",
  "award_winners",
]);

function namesLibrary(config: Record<string, unknown>): boolean {
  const hasLibraryId = (key: string) => {
    const value = config[key];
    return typeof value === "number" && value > 0;
  };
  return (
    sectionLibraryFilterIds(config).length > 0 ||
    hasLibraryId("generated_library_id") ||
    hasLibraryId("library_id")
  );
}

/**
 * Whether a row can be copied to other library pages as it is. The bulk
 * create sends one config to every page, so only ready-made kinds whose
 * settings name no library qualify. Legacy Trakt rows can't be created again.
 * Hero rows are handled by the caller: a new hero row stays on its own page,
 * and copies of an existing one are never heroes.
 */
export function canCopyToLibraries(row: {
  sectionType: string;
  config: Record<string, unknown>;
}): boolean {
  return (
    !PAGE_BOUND_TYPES.has(row.sectionType) &&
    !namesLibrary(row.config) &&
    !isTraktConfig(row.config)
  );
}

/**
 * The other library pages an Add row draft also goes to: none on Home, for a
 * hero row, or for a kind that can't be copied. Never the current page.
 */
export function libraryCopyIds(
  draft: Pick<RowDraft, "sectionType" | "config" | "hero" | "extraLibraryIds">,
  page: PageRef,
): number[] {
  if (page.kind !== "library" || draft.hero || !canCopyToLibraries(draft)) return [];
  return [...new Set(draft.extraLibraryIds ?? [])].filter((id) => id !== page.libraryId);
}
