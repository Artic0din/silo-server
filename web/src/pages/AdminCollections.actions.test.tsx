import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminJob, Library, LibraryCollection } from "@/api/types";
import { coreApplied, starterPackBundles } from "@/test/fixtures/starterPacks";

import AdminCollections from "./AdminCollections";

const { state, idle } = vi.hoisted(() => ({
  state: {
    collections: [] as LibraryCollection[],
    jobs: [] as AdminJob[],
    snapshot: vi.fn(),
    prepareDeletes: vi.fn(),
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
  useDeleteAdminCollection: idle,
  useDeleteAdminCollections: () => ({ ...idle(), progress: null }),
  useSyncAdminCollection: () => ({ ...idle(), variables: undefined }),
  useTemplateBundleApplyJobs: () => ({ data: state.jobs }),
}));
vi.mock("@/lib/collectionTemplates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/collectionTemplates")>()),
  useCollectionTemplateBundles: () => ({ data: starterPackBundles }),
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
  state.jobs = [];
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
  ])("offers a starter pack when %s has no collections", (_, path) => {
    state.collections = [];
    renderPage(path);

    fireEvent.click(screen.getByRole("button", { name: "Add a starter pack" }));
    expect(screen.getByRole("dialog", { name: "Starter packs" })).toBeInTheDocument();
  });

  it("names the finished starter pack and counts only the lists it shows", () => {
    state.jobs = [
      {
        id: "job-1",
        job_type: "template_bundle_apply",
        status: "completed",
        requested_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        result_payload: coreApplied,
      } as unknown as AdminJob,
    ];
    renderPage("/admin/collections");
    expect(screen.getByText("Core Defaults added")).toBeInTheDocument();
    expect(screen.getByText("Added 3 lists. 1 list couldn't be added.")).toBeInTheDocument();
  });

  it("says a finished starter pack had problems when nothing new landed", () => {
    state.jobs = [
      {
        id: "job-1",
        job_type: "template_bundle_apply",
        status: "completed",
        requested_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        result_payload: { ...coreApplied, created: [], sync_queued: [] },
      } as unknown as AdminJob,
    ];
    renderPage("/admin/collections");
    expect(screen.getByText("Core Defaults finished with problems")).toBeInTheDocument();
    expect(
      screen.getByText("Nothing new was added. 1 list couldn't be added."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Starter pack added/)).toBeNull();
  });

  it("refreshes the collections and Home rows when a starter pack job ends", () => {
    const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    state.jobs = [
      {
        id: "job-1",
        job_type: "template_bundle_apply",
        status: "completed",
        requested_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        result_payload: coreApplied,
      } as unknown as AdminJob,
    ];
    renderPage("/admin/collections");
    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toContainEqual(["admin", "collections"]);
    expect(keys).toContainEqual(["sections"]);
    invalidate.mockRestore();
  });
});
