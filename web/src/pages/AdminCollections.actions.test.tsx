import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
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
  useAdminCollectionCapabilities: () => ({
    data: { groups: false, imports: true, import_sources: ["mdblist", "tmdb", "tmdb_list"] },
  }),
  useAdminCollections: () => ({ data: state.collections, isLoading: false }),
  useDeleteAdminCollections: () => ({ ...idle(), progress: null }),
  useSetAdminCollectionVisibility: () => ({ mutateAsync: state.setVisibility }),
  useSetAdminCollectionPin: idle,
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
      "Delete 1 synced list in this view?",
    );
    expect(state.prepareDeletes).toHaveBeenCalledWith(["Top Rated"]);
  });
});

describe("AdminCollections Starter packs", () => {
  async function openFromMore() {
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /^Starter packs…/ }));
    // The menu runs it once it has closed.
    return screen.findByRole("dialog", { name: "Starter packs" });
  }

  it("opens Starter packs from More and closes it again", async () => {
    state.collections = [collection("Top Rated", "mdblist")];
    renderPage("/admin/collections?libraryId=2");

    expect(screen.queryByRole("dialog", { name: "Starter packs" })).toBeNull();
    expect(await openFromMore()).toHaveTextContent("Opened on 2");

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

    await openFromMore();
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
    ["every library", "/admin/collections", "No collections yet"],
    ["one library", "/admin/collections?libraryId=1", "No collections in Movies yet"],
  ])("offers a starter pack from the picker when %s has no collections", async (_, path, text) => {
    state.collections = [];
    renderPage(path);

    const empty = screen.getByText(text).parentElement!;
    await userEvent.click(within(empty).getByRole("button", { name: "New collection" }));
    const picker = await screen.findByRole("dialog", { name: "New collection" });
    await userEvent.click(await within(picker).findByRole("link", { name: "Add a starter pack" }));
    expect(await screen.findByRole("dialog", { name: "Starter packs" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "New collection" })).toBeNull();
  });
});

describe("AdminCollections New collection", () => {
  function emptyState(text: string) {
    return screen.getByText(text).parentElement!;
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
    ["every library", "/admin/collections", "No collections yet"],
    ["one library", "/admin/collections?libraryId=1", "No collections in Movies yet"],
  ])("gives the empty list for %s one button, which opens the picker", async (_, path, text) => {
    state.collections = [];
    renderPage(path);
    const empty = emptyState(text);
    expect(within(empty).getAllByRole("button")).toHaveLength(1);
    await userEvent.click(within(empty).getByRole("button", { name: "New collection" }));
    expect(await screen.findByRole("dialog", { name: "New collection" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Start from a template/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Create from scratch/ })).toBeNull();
  });
});
