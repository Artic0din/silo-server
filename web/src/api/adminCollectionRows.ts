import { deleteAdminSection, fetchAdminSectionSnapshot } from "@/api/adminSections";
import type { components } from "@/api/v2/schema";
import { v2, V2ProblemError } from "@/api/v2/request";
import type { CollectionRow } from "@/lib/collections/rows";

type AdminCollectionSection = components["schemas"]["AdminCollectionSection"];

export function collectionRowFromV2(value: AdminCollectionSection): CollectionRow {
  const pageRowCount = Math.max(value.page_row_count, 1);
  return {
    id: value.id,
    page:
      value.scope === "library" && value.library_id !== null
        ? { kind: "library", libraryId: Number(value.library_id) }
        : { kind: "home" },
    title: value.title,
    enabled: value.enabled,
    // Stored positions count from 0 and can skip numbers after a delete.
    position: Math.min(value.position + 1, pageRowCount),
    pageRowCount,
  };
}

/** The administrator Home and library page rows that show a server collection. */
export async function fetchAdminCollectionRows(
  id: string,
  signal?: AbortSignal,
): Promise<CollectionRow[]> {
  const page = await v2("GET /api/v2/admin/collections/{id}/sections", {
    path: { id },
    signal,
  });
  return page.items.map(collectionRowFromV2);
}

function isGone(error: unknown) {
  return error instanceof V2ProblemError && error.status === 404;
}

/**
 * Deletes `rows` one at a time, each with the ETag of a fresh read. A row
 * that is already gone counts as deleted. The first failure stops the run:
 * `remaining` holds that row and every row after it, with the error.
 */
export async function deleteAdminCollectionRows(
  rows: readonly CollectionRow[],
): Promise<{ remaining: CollectionRow[]; error?: unknown }> {
  for (const [index, row] of rows.entries()) {
    try {
      const { etag } = await fetchAdminSectionSnapshot(row.id);
      await deleteAdminSection({ id: row.id, etag });
    } catch (error) {
      if (isGone(error)) continue;
      return { remaining: rows.slice(index), error };
    }
  }
  return { remaining: [] };
}
