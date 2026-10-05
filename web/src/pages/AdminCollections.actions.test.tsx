import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
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
  useAdminCollections: () => ({
    data: state.collections,
    isLoading: false,
    refetch: async () => ({ data: state.collections }),
  }),
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
