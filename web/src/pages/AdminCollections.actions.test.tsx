import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Library, LibraryCollection } from "@/api/types";

import AdminCollections from "./AdminCollections";

const { state, idle } = vi.hoisted(() => ({
  state: { collections: [] as LibraryCollection[], snapshot: vi.fn(), prepareDeletes: vi.fn() },
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
  useSetAdminCollectionVisibility: idle,
  useTemplateBundleApplyJobs: () => ({ data: [] }),
}));
vi.mock("@/components/realtimeEventsContext", () => ({ useEventChannel: vi.fn() }));
vi.mock("@/components/CollectionTemplateGallery", () => ({
  CollectionTemplateGallery: () => null,
}));
vi.mock("@/components/collections/StarterPacksDialog", () => ({
  StarterPacksDialog: ({
    initialLibraryId,
    onClose,
  }: {
    initialLibraryId: number | null;
    onClose: () => void;
  }) => (
    <div role="dialog" aria-label="Starter packs">
      Opened on {String(initialLibraryId)}
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  ),
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

async function openStarterPacksFromMore() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "More" }));
  await user.click(await screen.findByRole("menuitem", { name: "Starter packs…" }));
  // More runs a dialog-opening item only once the menu has closed.
  return screen.findByRole("dialog", { name: "Starter packs" });
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
  it("says a board delete removes a shared collection from every library it's in", async () => {
    state.collections = [collection("Shared", "manual", [1, 2, 3])];
    renderPage("/admin/collections?libraryId=1");

    fireEvent.click(screen.getByRole("button", { name: "Delete collection" }));

    const dialog = await screen.findByRole("alertdialog", { name: "Delete Shared?" });
    expect(dialog).toHaveTextContent(
      "It's removed from Movies, Kids and 4K for everyone. This can't be undone.",
    );
  });

  it("names only its own library for a single-library collection", async () => {
    state.collections = [collection("Solo", "manual")];
    renderPage("/admin/collections?libraryId=1");

    fireEvent.click(screen.getByRole("button", { name: "Delete collection" }));

    const dialog = await screen.findByRole("alertdialog", { name: "Delete Solo?" });
    expect(dialog).toHaveTextContent("It's removed from Movies for everyone.");
    expect(dialog).not.toHaveTextContent("Kids");
  });

  it("says a library board bulk delete removes shared collections from their other libraries", async () => {
    state.collections = [collection("Shared", "manual", [1, 2]), collection("Solo", "manual")];
    renderPage("/admin/collections?libraryId=1");

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Shared" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Selected" }));

    expect(await screen.findByRole("alertdialog")).toHaveTextContent(
      "Delete 1 selected collection? Shared collections will also be removed from their other libraries.",
    );
  });

  it("warns from the fetched collection when a selected one became shared after the board loaded", async () => {
    state.collections = [collection("Solo", "manual")];
    state.prepareDeletes.mockImplementation(async (ids: string[]) =>
      ids.map((id) => ({ id, etag: '"rev-2"', collection: collection(id, "manual", [1, 2]) })),
    );
    renderPage("/admin/collections?libraryId=1");

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Solo" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Selected" }));

    expect(await screen.findByRole("alertdialog")).toHaveTextContent(
      "Delete 1 selected collection? Shared collections will also be removed from their other libraries.",
    );
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

  it("does not mention other libraries when no selected collection is shared", async () => {
    state.collections = [collection("Shared", "manual", [1, 2]), collection("Solo", "manual")];
    renderPage("/admin/collections?libraryId=1");

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Solo" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Selected" }));

    expect(await screen.findByRole("alertdialog")).not.toHaveTextContent("other libraries");
  });

  it("opens Starter packs from More and closes it again", async () => {
    state.collections = [collection("Top Rated", "mdblist")];
    renderPage("/admin/collections?libraryId=2");

    expect(screen.queryByRole("dialog", { name: "Starter packs" })).toBeNull();
    expect(await openStarterPacksFromMore()).toHaveTextContent("Opened on 2");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Starter packs" })).toBeNull();
  });

  it("leaves the page on Back after Starter packs closes, instead of reopening it", async () => {
    state.collections = [collection("Top Rated", "mdblist")];
    function BackButton() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => void navigate(-1)}>
          Back
        </button>
      );
    }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/admin", "/admin/collections"]} initialIndex={1}>
          <Routes>
            <Route path="/admin" element={<p>Admin home</p>} />
            <Route
              path="/admin/collections"
              element={
                <>
                  <BackButton />
                  <AdminCollections />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await openStarterPacksFromMore();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Admin home")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Starter packs" })).toBeNull();
  });

  it("opens Starter packs from a link", () => {
    state.collections = [collection("Top Rated", "mdblist")];
    renderPage("/admin/collections?dialog=starter-packs");

    expect(screen.getByRole("dialog", { name: "Starter packs" })).toHaveTextContent(
      "Opened on null",
    );
  });

  it.each([
    ["every library", "/admin/collections"],
    ["one library", "/admin/collections?libraryId=1"],
  ])("offers a starter pack when %s has no collections", (_, path) => {
    state.collections = [];
    renderPage(path);

    fireEvent.click(screen.getByRole("button", { name: "Add a starter pack" }));
    expect(screen.getByRole("dialog", { name: "Starter packs" })).toBeInTheDocument();
  });
});
