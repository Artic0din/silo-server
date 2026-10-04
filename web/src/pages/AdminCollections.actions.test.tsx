import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
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
  useAdminCollectionCapabilities: () => ({
    data: { groups: false, imports: true, import_sources: ["mdblist", "tmdb", "tmdb_list"] },
  }),
  useAdminCollections: () => ({ data: state.collections, isLoading: false }),
  useDeleteAdminCollection: idle,
  useDeleteAdminCollections: () => ({ ...idle(), progress: null }),
  useSyncAdminCollection: () => ({ ...idle(), variables: undefined }),
  useTemplateBundleApplyJobs: () => ({ data: [] }),
}));
vi.mock("@/components/realtimeEventsContext", () => ({ useEventChannel: vi.fn() }));
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

function Where() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}

function renderPage(path: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <AdminCollections />
        <Where />
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

describe("AdminCollections actions", () => {
  it("offers Sync on the all-libraries list only for list-backed collections", () => {
    state.collections = [
      collection("Top Rated", "mdblist"),
      collection("Action Night", "smart"),
      collection("Staff Picks", "manual"),
    ];
    renderPage("/admin/collections");

    expect(screen.getByRole("button", { name: "Sync Top Rated" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sync Action Night" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sync Staff Picks" })).not.toBeInTheDocument();
  });

  it("says a library board delete removes a shared collection from every library", async () => {
    state.collections = [collection("Shared", "manual", [1, 2, 3])];
    renderPage("/admin/collections?libraryId=1");

    fireEvent.click(screen.getByRole("button", { name: "Delete collection" }));

    expect(await screen.findByRole("alertdialog")).toHaveTextContent(
      'Delete collection "Shared"? It will be removed from all 3 libraries it belongs to.',
    );
  });

  it("does not mention other libraries for a single-library collection", async () => {
    state.collections = [collection("Solo", "manual")];
    renderPage("/admin/collections?libraryId=1");

    fireEvent.click(screen.getByRole("button", { name: "Delete collection" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent('Delete collection "Solo"? This action cannot be undone.');
    expect(dialog).not.toHaveTextContent("libraries");
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

  it("warns on the all-libraries list when a selected collection is in more than one library", async () => {
    state.collections = [collection("Shared", "manual", [1, 2]), collection("Solo", "manual")];
    renderPage("/admin/collections");

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Shared in Movies" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Selected" }));

    expect(await screen.findByRole("alertdialog")).toHaveTextContent(
      "Delete 1 selected collection? Collections in more than one library will be removed from all of them.",
    );
  });

  it("does not mention other libraries when no selected collection is shared", async () => {
    state.collections = [collection("Shared", "manual", [1, 2]), collection("Solo", "manual")];
    renderPage("/admin/collections?libraryId=1");

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Solo" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Selected" }));

    expect(await screen.findByRole("alertdialog")).not.toHaveTextContent("other libraries");
  });

  it("opens Starter packs from the header and closes it again", () => {
    state.collections = [collection("Top Rated", "mdblist")];
    renderPage("/admin/collections?libraryId=2");

    expect(screen.queryByRole("dialog", { name: "Starter packs" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Starter packs…" }));
    expect(screen.getByRole("dialog", { name: "Starter packs" })).toHaveTextContent("Opened on 2");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Starter packs" })).toBeNull();
  });

  it("leaves the page on Back after Starter packs closes, instead of reopening it", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Starter packs…" }));
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
  ])("offers a starter pack from the picker when %s has no collections", async (_, path) => {
    state.collections = [];
    renderPage(path);

    const empty = screen.getByText("No collections yet").parentElement!.parentElement!;
    await userEvent.click(within(empty).getByRole("button", { name: "New collection" }));
    const picker = await screen.findByRole("dialog", { name: "New collection" });
    await userEvent.click(await within(picker).findByRole("link", { name: "Add a starter pack" }));
    expect(await screen.findByRole("dialog", { name: "Starter packs" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "New collection" })).toBeNull();
  });
});

describe("AdminCollections New collection", () => {
  function emptyState() {
    return screen.getByText("No collections yet").parentElement!.parentElement!;
  }

  it("has one New collection button in the header and no Browse Templates", () => {
    state.collections = [collection("Staff Picks", "manual")];
    renderPage("/admin/collections");
    expect(screen.getAllByRole("button", { name: "New collection" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Browse Templates/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Add Collection/ })).toBeNull();
  });

  it("opens the type picker on the selected library", async () => {
    state.collections = [collection("Staff Picks", "manual")];
    renderPage("/admin/collections?libraryId=1");
    await userEvent.click(screen.getByRole("button", { name: "New collection" }));
    const dialog = await screen.findByRole("dialog", { name: "New collection" });
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/admin/collections?libraryId=1&dialog=new",
    );
    expect(within(dialog).getByRole("link", { name: "Manual" })).toHaveAttribute(
      "href",
      "/admin/collections/new?type=manual&libraryId=1",
    );
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/admin\/collections\?libraryId=1$/);
  });

  it("opens the type picker from a link", async () => {
    state.collections = [];
    renderPage("/admin/collections?dialog=new");
    expect(await screen.findByRole("dialog", { name: "New collection" })).toBeInTheDocument();
  });

  it.each([
    ["every library", "/admin/collections"],
    ["one library", "/admin/collections?libraryId=1"],
  ])("gives the empty list for %s one button, which opens the picker", async (_, path) => {
    state.collections = [];
    renderPage(path);
    const empty = emptyState();
    expect(within(empty).getAllByRole("button")).toHaveLength(1);
    await userEvent.click(within(empty).getByRole("button", { name: "New collection" }));
    expect(await screen.findByRole("dialog", { name: "New collection" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Start from a template/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Create from scratch/ })).toBeNull();
  });
});
