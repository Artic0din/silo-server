import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Library, LibraryCollection } from "@/api/types";
import { PIN_LABEL, pinHelp } from "@/lib/collections/copy";

import AdminCollections from "./AdminCollections";

const { state, idle } = vi.hoisted(() => ({
  state: {
    collections: [] as LibraryCollection[],
    snapshot: vi.fn(),
    prepareDeletes: vi.fn(),
    setVisibility: vi.fn(async () => undefined),
  },
  idle: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/api/adminCollections", () => ({
  fetchAdminCollectionSnapshot: state.snapshot,
  fetchAdminGroupSnapshot: vi.fn(),
  fetchAdminBoardOrderSnapshot: vi.fn(),
  prepareAdminCollectionDeletes: state.prepareDeletes,
  adminMutationMessage: (_: unknown, fallback: string) => fallback,
}));
vi.mock("@/hooks/queries/admin/libraries", () => ({
  useAdminLibraries: () => ({
    data: [
      { id: 1, name: "Movies" },
      { id: 2, name: "Kids" },
      { id: 3, name: "4K" },
    ] as Library[],
  }),
}));
vi.mock("@/hooks/queries/admin/collectionGroups", () => ({
  useAdminCollectionsBoard: (libraryId: number | undefined) => ({
    isLoading: false,
    data:
      libraryId === undefined
        ? undefined
        : { groups: [], ungrouped: state.collections, ungroupedSortOrder: 0 },
  }),
  useCreateCollectionGroup: idle,
  useUpdateCollectionGroup: idle,
  useDeleteCollectionGroup: idle,
  useReorderCollectionGroups: idle,
  useReorderCollectionsInGroup: idle,
}));
vi.mock("@/hooks/queries/admin/collections", () => ({
  useAdminCollectionCapabilities: () => ({ data: { groups: false, imports: true } }),
  useAdminCollections: () => ({ data: state.collections, isLoading: false }),
  useDeleteAdminCollections: () => ({ ...idle(), progress: null }),
  useSetAdminCollectionVisibility: () => ({ mutateAsync: state.setVisibility }),
  useSetAdminCollectionPin: idle,
  useTemplateBundleApplyJobs: () => ({ data: [] }),
}));
vi.mock("@/components/realtimeEventsContext", () => ({ useEventChannel: vi.fn() }));
vi.mock("@/components/CollectionTemplateGallery", () => ({
  CollectionTemplateGallery: () => null,
}));

function collection(
  id: string,
  collection_type: LibraryCollection["collection_type"],
  library_ids = [1],
): LibraryCollection {
  return {
    id,
    title: id,
    collection_type,
    library_id: library_ids[0]!,
    library_ids,
    item_count: 0,
    sort_order: 0,
    featured: false,
    visibility: "visible",
  } as LibraryCollection;
}

function renderPage(path: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <AdminCollections />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.snapshot.mockImplementation(async (id: string) => ({
    collection: state.collections.find((entry) => entry.id === id),
    etag: '"rev-1"',
  }));
  state.prepareDeletes.mockImplementation(async (ids: string[]) =>
    ids.map((id) => ({
      id,
      etag: '"rev-1"',
      collection: state.collections.find((entry) => entry.id === id),
    })),
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AdminCollections Arrange actions", () => {
  it("offers Edit, Move to shelf, Pin and the Collections tab on a card, and no Delete or Sync", async () => {
    state.collections = [collection("Top Rated", "mdblist")];
    renderPage("/admin/collections?view=arrange&libraryId=1");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "More for Top Rated" }));
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Edit collection",
      "Move to shelf",
      `${PIN_LABEL}${pinHelp(null)}`,
      "Hide from Collections tab",
    ]);
  });

  it("asks before hiding a collection rows show, from its card", async () => {
    state.collections = [{ ...collection("Top Rated", "mdblist"), row_count: 2 }];
    renderPage("/admin/collections?view=arrange&libraryId=1");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "More for Top Rated" }));
    await user.click(await screen.findByRole("menuitem", { name: "Hide from Collections tab" }));

    expect(
      await screen.findByRole("alertdialog", { name: "Hide Top Rated from Collections tabs?" }),
    ).toHaveTextContent("2 rows still show it");
    expect(state.setVisibility).not.toHaveBeenCalled();
  });

  it("hides a collection no rows show at once, from its card", async () => {
    state.collections = [collection("Solo", "manual")];
    renderPage("/admin/collections?view=arrange&libraryId=1");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "More for Solo" }));
    await user.click(await screen.findByRole("menuitem", { name: "Hide from Collections tab" }));

    expect(state.setVisibility).toHaveBeenCalledWith({ id: "Solo", visible: false });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("deletes only what the List's filters show from More", async () => {
    state.collections = [collection("Top Rated", "mdblist"), collection("Solo", "manual")];
    renderPage("/admin/collections?type=synced");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete all in this view…" }));

    expect(await screen.findByRole("alertdialog")).toHaveTextContent(
      "Delete the 1 collection in this view?",
    );
    expect(state.prepareDeletes).toHaveBeenCalledWith(["Top Rated"]);
  });
});
