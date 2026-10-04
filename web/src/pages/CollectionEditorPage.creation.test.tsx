import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { LibraryCollection } from "@/api/types";
import { V2ProblemError } from "@/api/v2/request";
import type { CollectionBuilderProps } from "@/components/collections/CollectionBuilder";
import type { CollectionScope, EditorSnapshot } from "@/lib/collections/scope";
import { preloadLegacyCollectionEditors } from "@/test/preloadCollectionEditors";
import CollectionEditorPage from "./CollectionEditorPage";

beforeAll(preloadLegacyCollectionEditors);

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  adminCreate: vi.fn(),
  collection: null as LibraryCollection | null,
  editSnapshotError: null as Error | null,
  adminSnapshotError: null as Error | null,
}));
vi.mock("@/hooks/queries/collectionScope", () => ({
  // The admin page opens mocks.collection; the personal page opens nothing.
  useScopeEditor: (scope: CollectionScope<LibraryCollection>) => {
    const admin = scope.kind === "server";
    const collection = admin ? mocks.collection : null;
    return {
      snapshot: collection ? { view: scope.toView(collection), etag: '"revision"' } : undefined,
      isLoading: false,
      isFetching: false,
      error: admin ? mocks.adminSnapshotError : mocks.editSnapshotError,
      refetch: vi.fn(),
    };
  },
}));
vi.mock("@/hooks/queries/collections", () => ({
  useCollectionCapabilities: () => ({ data: {} }),
  useCreateCollection: () => ({ mutate: mocks.create }),
  useUpdateCollection: () => ({}),
}));
vi.mock("@/hooks/queries/admin/collections", () => ({
  useAdminCollectionCapabilities: () => ({ data: {} }),
  useCreateAdminCollection: () => ({ mutate: mocks.adminCreate }),
  useUpdateAdminCollection: () => ({}),
}));
vi.mock("@/hooks/queries/profiles", () => ({ useProfiles: () => ({ data: [] }) }));
vi.mock("@/hooks/queries/libraries", () => ({ useUserLibraries: () => ({ data: [] }) }));
vi.mock("@/hooks/queries/admin/libraries", () => ({ useAdminLibraries: () => ({ data: [] }) }));
vi.mock("@/hooks/useCurrentProfile", () => ({
  useCurrentProfile: () => ({ profile: { id: "p" }, isLoading: false }),
}));
vi.mock("@/components/CollectionTemplateGallery", () => ({
  CollectionTemplateGallery: () => null,
}));
vi.mock("@/components/ImageUploadField", () => ({ ImageUploadField: () => null }));
vi.mock("./SmartCollectionWizard", () => ({ default: () => <div>Smart wizard</div> }));
vi.mock("@/components/collections/CollectionBuilder", async () => ({
  ...(await vi.importActual<typeof import("@/components/collections/CollectionBuilder")>(
    "@/components/collections/CollectionBuilder",
  )),
  default: ({ value, onChange, onSubmit, lockCollectionType }: CollectionBuilderProps) => (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <input
        aria-label="Name"
        value={value.title}
        onChange={(event) => onChange({ ...value, title: event.target.value })}
      />
      <select
        aria-label="Collection Mode"
        disabled={lockCollectionType}
        value={value.collection_type}
        onChange={(event) =>
          onChange({ ...value, collection_type: event.target.value as "manual" | "smart" })
        }
      >
        <option value="smart">Smart</option>
        <option value="manual">Manual</option>
      </select>
      <button>Save Collection</button>
    </form>
  ),
}));
vi.mock("@/components/collections/editor/ManualCollectionEditor", () => ({
  ManualCollectionEditor: ({
    scope,
    snapshot,
    libraryId,
  }: {
    scope: CollectionScope;
    snapshot?: EditorSnapshot;
    libraryId?: number | null;
  }) => (
    <div
      data-testid="manual-editor"
      data-source={scope.itemSource}
      data-collection={snapshot?.view.id ?? ""}
      data-library={libraryId ?? ""}
    />
  ),
}));
function Location() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.collection = null;
  mocks.editSnapshotError = null;
  mocks.adminSnapshotError = null;
});
function show(admin = false, edit = false) {
  const base = admin ? "/admin/collections" : "/collections";
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[edit ? `${base}/collection-1/edit` : `${base}/new`]}>
        <Routes>
          <Route element={<CollectionEditorPage scope={admin ? "server" : "personal"} />}>
            <Route path={`${base}/new`} />
            <Route path={`${base}/:id/edit`} />
          </Route>
        </Routes>
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
it("creates a personal smart collection from the new collection route", async () => {
  show();
  fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "My picks" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Collection" }));
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining({
      body: expect.objectContaining({ name: "My picks", collection_type: "smart" }),
    }),
    expect.anything(),
  );
});

it("opens the editor page when Manual is chosen for a new personal collection", async () => {
  show();
  fireEvent.change(await screen.findByLabelText("Collection Mode"), {
    target: { value: "manual" },
  });
  expect(screen.getByTestId("location")).toHaveTextContent("/collections/new?type=manual");
  expect(screen.getByTestId("manual-editor")).toHaveAttribute("data-source", "user");
  expect(mocks.create).not.toHaveBeenCalled();
});

it("opens the editor page from the admin Manual card, keeping the library", async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/admin/collections/new?libraryId=7"]}>
        <Routes>
          <Route element={<CollectionEditorPage scope="server" />}>
            <Route path="/admin/collections/new" />
          </Route>
        </Routes>
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /Manual Curate items by hand/ }));
  expect(screen.getByTestId("location")).toHaveTextContent(
    "/admin/collections/new?type=manual&libraryId=7",
  );
  const editor = screen.getByTestId("manual-editor");
  expect(editor).toHaveAttribute("data-source", "library");
  expect(editor).toHaveAttribute("data-library", "7");
});

it("creates an admin smart collection from the Smart card", async () => {
  show(true);
  fireEvent.click(await screen.findByRole("button", { name: /Smart Match titles with rules/ }));
  expect(screen.getByLabelText("Collection Mode")).toHaveValue("smart");
  expect(screen.getByLabelText("Collection Mode")).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Staff picks" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Collection" }));
  expect(mocks.adminCreate).toHaveBeenCalledWith(
    expect.objectContaining({
      body: expect.objectContaining({ title: "Staff picks", collection_type: "smart" }),
    }),
    expect.anything(),
  );
});

it("opens a saved manual collection in the editor page", () => {
  mocks.collection = {
    id: "collection-1",
    title: "Staff picks",
    collection_type: "manual",
    library_ids: [1],
  } as LibraryCollection;
  show(true, true);
  const editor = screen.getByTestId("manual-editor");
  expect(editor).toHaveAttribute("data-source", "library");
  expect(editor).toHaveAttribute("data-collection", "collection-1");
});

function showPersonalEdit() {
  show(false, true);
}

function collectionProblem(status: number) {
  return new V2ProblemError("getPersonalCollection", {
    type: `https://silo.example/problems/${status === 404 ? "not_found" : "internal_error"}`,
    title: status === 404 ? "Not Found" : "Internal Server Error",
    status,
    detail: status === 404 ? "Collection not found." : "Collections are unavailable.",
    instance: "/api/v2/collections/collection-1",
  });
}

it("points a missing personal collection back to the collection list", () => {
  mocks.editSnapshotError = collectionProblem(404);
  showPersonalEdit();
  expect(
    screen.getByRole("heading", { level: 1, name: "This collection isn't available" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "All collections" })).toHaveAttribute(
    "href",
    "/collections",
  );
});

it("offers a retry when a personal collection fails to load", () => {
  mocks.editSnapshotError = collectionProblem(500);
  showPersonalEdit();
  expect(
    screen.getByRole("heading", { level: 1, name: "Couldn't load this collection" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});

it("points a missing admin collection back to the collection board", () => {
  mocks.adminSnapshotError = collectionProblem(404);
  show(true, true);
  expect(
    screen.getByRole("heading", { level: 1, name: "Collection not found" }),
  ).toBeInTheDocument();
  expect(document.title).toMatch(/^Not found · /);
  expect(screen.getByRole("link", { name: "All collections" })).toHaveAttribute(
    "href",
    "/admin/collections",
  );
});

it("offers a retry when an admin collection fails to load", () => {
  mocks.adminSnapshotError = collectionProblem(500);
  show(true, true);
  expect(
    screen.getByRole("heading", { level: 1, name: "Couldn't load this collection" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});
