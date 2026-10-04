import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { v2Problem } from "@/api/v2/problems.test-support";
import { sectionKeys } from "@/hooks/queries/keys";
import AdminHomeRows from "./AdminHomeRows";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  importCollection: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  collectionOptions: [] as string[],
}));
vi.mock("@/api/v2/request", async () => ({
  ...(await vi.importActual<typeof import("@/api/v2/request")>("@/api/v2/request")),
  v2: mocks.request,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: mocks.error, warning: mocks.warning },
}));
vi.mock("@/hooks/queries/admin/libraries", () => ({
  useAdminLibraries: () => ({ data: libraries }),
}));
vi.mock("@/hooks/queries/admin/collections", () => ({
  useAdminCollections: () => ({ data: collections }),
  useImportTraktCollection: () => ({ mutateAsync: mocks.importCollection }),
}));
vi.mock("@/hooks/queries/collectionSurfaceRefresh", () => ({
  invalidateAdminCollectionQueries: vi.fn(),
}));
vi.mock("@/hooks/queries/useAllUserCollections", () => ({
  useAllUserCollections: () => ({
    collections: [
      { id: "private", source: "user" },
      { id: "public", source: "library" },
    ],
    isLoading: false,
  }),
}));
vi.mock("@/lib/recipes", () => ({ fetchRecipeCatalog: async () => ({ categories: {} }) }));
vi.mock("@/components/collections/CollectionRulesEditor", () => ({ default: () => null }));
vi.mock("@/components/LibraryMultiSelect", () => ({ default: () => null }));
vi.mock("@/components/RecipeGallery/RecipeParamFields", () => ({ default: () => null }));
vi.mock("@/components/RecipeGallery/RecipeGalleryModal", () => ({
  default: ({
    open,
    onPick,
  }: {
    open: boolean;
    onPick: (def: unknown, preset: unknown) => void;
  }) =>
    open ? (
      <button onClick={() => onPick({ type: "collection" }, { display_name: "Trakt" })}>
        Choose Trakt recipe
      </button>
    ) : null,
}));
vi.mock("@/components/RecipeGallery/RecipeConfigDrawer", () => ({
  default: ({ onAdd }: { onAdd: (payload: unknown) => Promise<void> }) => (
    <button
      onClick={() =>
        void onAdd({
          section_type: "collection",
          title: "Trakt picks",
          item_limit: 20,
          featured: false,
          enabled: true,
          config: { source_provider: "trakt", source_preset: "popular", media_type: "movie" },
          library_ids: [7, 8],
        })
      }
    >
      Create Trakt sections
    </button>
  ),
}));
vi.mock("@/components/CollectionSearchableSelect", () => ({
  CollectionSearchableSelect: ({ options }: { options: { id: string }[] }) => {
    mocks.collectionOptions = options.map((option) => option.id);
    return <div>Collection picker</div>;
  },
}));
// The real list and sortable rows render; only the drag gesture is replaced by
// two buttons, so a test can start a drag, refetch, and then drop.
vi.mock("@dnd-kit/core", async () => {
  const actual = await vi.importActual<typeof import("@dnd-kit/core")>("@dnd-kit/core");
  return {
    ...actual,
    DndContext: ({
      children,
      onDragStart,
      onDragEnd,
      ...rest
    }: Parameters<typeof actual.DndContext>[0] & { children: ReactNode }) => (
      <actual.DndContext {...rest}>
        <button onClick={() => onDragStart?.({ active: { id: "a" } } as never)}>Start drag</button>
        <button onClick={() => onDragEnd?.({ active: { id: "a" }, over: { id: "b" } } as never)}>
          End drag
        </button>
        {children}
      </actual.DndContext>
    ),
  };
});
const libraries = [{ id: 7, name: "Movies", type: "movies" }];
const collections: never[] = [];
const initial = (id: string) => ({
  id,
  title: `Original ${id.toUpperCase()}`,
  scope: "home",
  library_id: null,
  position: id === "a" ? 0 : 1,
  section_type: "recently_added",
  item_limit: 20,
  featured: false,
  enabled: true,
  config: {},
  created_at: "2026-09-05T00:00:00Z",
  updated_at: "2026-09-05T00:00:00Z",
});
let rows: ReturnType<typeof initial>[];
let revision: number;
let resetSupported: boolean;
let failID: string | null;
let writes: Array<{ operation: string; args: Args }>;
type Args = {
  query?: { scope?: string; library_id?: string };
  path?: { id: string };
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
  onResponse?: (response: Response) => void;
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  rows = [initial("a"), initial("b")];
  revision = 1;
  resetSupported = false;
  failID = null;
  writes = [];
  mocks.request.mockImplementation(async (operation: string, args: Args = {}) => {
    args.onResponse?.(new Response(null, { headers: { ETag: `"rev-${revision}"` } }));
    if (operation === "GET /api/v2/admin/sections/capabilities")
      return { available: true, reset_profiles: resetSupported, preview: true };
    if (operation === "GET /api/v2/admin/sections/order")
      return { scope: "home", library_id: null, ordered_ids: rows.map((row) => row.id) };
    if (operation === "GET /api/v2/admin/sections")
      return { items: rows.map((row) => ({ ...row })) };
    if (operation === "GET /api/v2/admin/sections/{id}")
      return { ...rows.find((row) => row.id === args.path?.id)! };
    writes.push({ operation, args });
    if (args.headers?.["If-Match"] !== `"rev-${revision}"` || args.path?.id === failID)
      throw v2Problem(412, "precondition_failed", "Changed on another client");
    if (operation === "PATCH /api/v2/admin/sections/{id}") {
      const changes = Object.fromEntries(
        Object.entries(args.body ?? {}).filter(([, value]) => value !== undefined),
      );
      rows = rows.map((row) => (row.id === args.path?.id ? { ...row, ...changes } : row));
      return rows.find((row) => row.id === args.path?.id);
    }
    if (operation === "DELETE /api/v2/admin/sections/{id}") {
      rows = rows.filter((row) => row.id !== args.path?.id);
      return undefined;
    }
    if (operation === "PUT /api/v2/admin/sections/order")
      return { scope: "home", library_id: null, ordered_ids: args.body?.ordered_ids };
    if (operation === "PUT /api/v2/admin/sections/defaults") return { items: rows };
    throw new Error(`Unexpected ${operation}`);
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
async function setup(waitForRows = true, entry = "/admin/home-rows") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <MemoryRouter initialEntries={[entry]}>
      <QueryClientProvider client={client}>
        <AdminHomeRows />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  if (waitForRows) {
    await screen.findByRole("button", { name: "More for Original A" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Add Section" })).toBeEnabled());
  }
  return client;
}
async function chooseRowAction(title: string, action: string) {
  await userEvent.click(screen.getByRole("button", { name: `More for ${title}` }));
  await userEvent.click(await screen.findByRole("menuitem", { name: action }));
}
const rowOrder = () => screen.getAllByRole("listitem").map((item) => item.dataset.rowId);
async function refresh(client: QueryClient) {
  await act(async () => {
    await client.invalidateQueries({ queryKey: sectionKeys.all });
  });
}

describe("admin section captured snapshots", () => {
  it("keeps the real editor draft and original validator through refetch and 412, then reloads explicitly", async () => {
    const client = await setup();
    await chooseRowAction("Original A", "Edit row…");
    const title = await screen.findByDisplayValue("Original A");
    fireEvent.change(title, { target: { value: "My draft" } });
    revision = 2;
    rows = rows.map((row) => ({ ...row, title: "Remote title" }));
    await refresh(client);
    expect(screen.getByDisplayValue("My draft")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/Your draft is preserved/);
    expect(writes[0]!.args.headers?.["If-Match"]).toBe('"rev-1"');
    expect(writes).toHaveLength(1);
    expect(screen.getByDisplayValue("My draft")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Reload section" }));
    await screen.findByDisplayValue("Remote title");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]!.args.headers?.["If-Match"]).toBe('"rev-2"');
  });
  it("freezes single-delete confirmation and requires explicit reload after 412", async () => {
    await setup();
    await chooseRowAction("Original A", "Delete row…");
    const dialog = await screen.findByRole("dialog", { name: "Delete Original A?" });
    revision = 2;
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete row" }));
    await screen.findByText(/Reload it before deleting/);
    expect(writes[0]!.args.headers?.["If-Match"]).toBe('"rev-1"');
    expect(writes).toHaveLength(1);
    expect(dialog).toBeInTheDocument();
  });
  it("captures bulk targets before confirmation and retains failed selection", async () => {
    const client = await setup();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Original A" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Original B" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Selected" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete selected sections" });
    rows.push(initial("c"));
    failID = "b";
    await refresh(client);
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete 2 sections" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(writes.map((write) => write.args.path?.id)).toEqual(["a", "b"]);
    expect(screen.getByRole("checkbox", { name: "Select Original B" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select Original C" })).not.toBeChecked();
  });
  it("does not replace an active drag on refetch and preserves attempted order on 412", async () => {
    const client = await setup();
    fireEvent.click(screen.getByRole("button", { name: "Start drag" }));
    revision = 2;
    rows = [rows[1]!, rows[0]!];
    await refresh(client);
    expect(rowOrder()).toEqual(["a", "b"]);
    fireEvent.click(screen.getByRole("button", { name: "End drag" }));
    await screen.findByRole("button", { name: "Reload rows" });
    expect(writes[0]!.args.headers?.["If-Match"]).toBe('"rev-1"');
    expect(writes[0]!.args.body?.ordered_ids).toEqual(["b", "a"]);
    expect(rowOrder()).toEqual(["b", "a"]);
  });
  it("disables unsupported profile reset and keeps restore confirmation after stale save", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: "Restore Defaults" }));
    const dialog = await screen.findByRole("dialog", { name: "Restore Default Sections" });
    expect(within(dialog).getByRole("switch")).toBeDisabled();
    revision = 2;
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore Defaults" }));
    await screen.findByText(/Reload the current scope/);
    expect(writes[0]!.args.headers?.["If-Match"]).toBe('"rev-1"');
    expect(writes[0]!.args.body?.reset_profiles).toBe(false);
    expect(dialog).toBeInTheDocument();
  });
  it("restricts the admin editor collection picker to library collections", async () => {
    rows[0]!.section_type = "collection";
    rows[0]!.config = { library_collection_id: "public" };
    await setup();
    await chooseRowAction("Original A", "Edit row…");
    await screen.findByText("Collection picker");
    expect(mocks.collectionOptions).toEqual(["public"]);
  });
  it("preserves collection recipe metadata on a title-only save", async () => {
    rows[0]!.section_type = "collection";
    rows[0]!.config = {
      library_collection_id: "public",
      source_provider: "trakt",
      source_preset: "popular",
      extra: { retained: true },
    };
    await setup();
    await chooseRowAction("Original A", "Edit row…");
    fireEvent.change(await screen.findByDisplayValue("Original A"), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.args.body?.config).toEqual({
      library_collection_id: "public",
      source_provider: "trakt",
      source_preset: "popular",
      extra: { retained: true },
    });
  });
  it("does not reopen an editor when a canceled reload completes", async () => {
    await setup();
    await chooseRowAction("Original A", "Edit row…");
    await screen.findByDisplayValue("Original A");
    revision = 2;
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/Your draft is preserved/);
    const implementation = mocks.request.getMockImplementation()!;
    let finish!: () => void;
    mocks.request.mockImplementation((operation: string, args: Args) =>
      operation === "GET /api/v2/admin/sections/{id}"
        ? new Promise((resolve) => {
            finish = () => resolve(implementation(operation, args));
          })
        : implementation(operation, args),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reload section" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => {
      finish();
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("retains pending reorder draft even when a background refresh finishes before rejection", async () => {
    const client = await setup();
    const implementation = mocks.request.getMockImplementation()!;
    let fail!: () => void;
    mocks.request.mockImplementation((operation: string, args: Args) =>
      operation === "PUT /api/v2/admin/sections/order"
        ? new Promise((_resolve, reject) => {
            fail = () => reject(v2Problem(412, "precondition_failed", "Stale order"));
          })
        : implementation(operation, args),
    );
    fireEvent.click(screen.getByRole("button", { name: "Start drag" }));
    fireEvent.click(screen.getByRole("button", { name: "End drag" }));
    await waitFor(() => expect(fail).toBeTypeOf("function"));
    revision = 2;
    await refresh(client);
    expect(rowOrder()).toEqual(["b", "a"]);
    await act(async () => {
      fail();
    });
    await screen.findByRole("button", { name: "Reload rows" });
    expect(rowOrder()).toEqual(["b", "a"]);
  });
  it("keeps scope controls fixed during a pending reorder and adopts the next scope after rejection", async () => {
    await setup();
    const implementation = mocks.request.getMockImplementation()!;
    let fail!: () => void;
    mocks.request.mockImplementation((operation: string, args: Args = {}) => {
      if (operation === "PUT /api/v2/admin/sections/order")
        return new Promise((_resolve, reject) => {
          fail = () => reject(v2Problem(412, "precondition_failed", "Stale home order"));
        });
      if (args.query?.scope === "library") {
        args.onResponse?.(new Response(null, { headers: { ETag: '"library-1"' } }));
        if (operation === "GET /api/v2/admin/sections/order")
          return { scope: "library", library_id: "7", ordered_ids: ["library-row"] };
        if (operation === "GET /api/v2/admin/sections")
          return {
            items: [
              {
                ...initial("library-row"),
                scope: "library",
                library_id: "7",
                title: "Library section",
              },
            ],
          };
      }
      return implementation(operation, args);
    });
    fireEvent.click(screen.getByRole("button", { name: "Start drag" }));
    fireEvent.click(screen.getByRole("button", { name: "End drag" }));
    await waitFor(() => expect(fail).toBeTypeOf("function"));
    fireEvent.click(screen.getByRole("button", { name: "Movies" }));
    expect(screen.getByRole("button", { name: "Home" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Movies" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute("aria-pressed", "true");
    await act(async () => {
      fail();
    });
    await screen.findByRole("button", { name: "Reload rows" });
    expect(screen.getByRole("button", { name: "Movies" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Movies" }));
    expect(screen.queryByRole("button", { name: "More for Original A" })).not.toBeInTheDocument();
    await screen.findByRole("button", { name: "More for Library section" });
    expect(screen.queryByRole("button", { name: "More for Original A" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reload rows" })).not.toBeInTheDocument();
  });
  it("shows a failed initial read instead of an empty editable scope", async () => {
    const implementation = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation((operation: string, args: Args) =>
      operation === "GET /api/v2/admin/sections"
        ? Promise.reject(new Error("Read unavailable"))
        : implementation(operation, args),
    );
    await setup(false);
    await screen.findByText("Read unavailable");
    expect(screen.queryByText(/No rows on/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Section" })).toBeDisabled();
  });

  it("retains imported IDs and completed targets when retrying a later Trakt section failure", async () => {
    let imports = 0;
    mocks.importCollection.mockImplementation(async () => ({
      collection: { id: `import-${++imports}` },
    }));
    const implementation = mocks.request.getMockImplementation()!;
    const creates: Record<string, unknown>[] = [];
    mocks.request.mockImplementation((operation: string, args: Args) => {
      if (operation !== "POST /api/v2/admin/sections") return implementation(operation, args);
      creates.push(args.body!);
      if (creates.length === 2)
        return Promise.reject(v2Problem(422, "validation_failed", "Fix section first"));
      return Promise.resolve({ ...initial(`created-${creates.length}`), ...args.body });
    });
    await setup();
    fireEvent.click(screen.getByRole("button", { name: "Add from Gallery" }));
    fireEvent.click(await screen.findByRole("button", { name: "Choose Trakt recipe" }));
    fireEvent.click(screen.getByRole("button", { name: "Create Trakt sections" }));
    await screen.findByText('1 of 2 sections created for "Trakt picks".');
    expect(screen.getByText(/Collection import-2/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add from Gallery" })).toBeDisabled();
    expect(imports).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Retry remaining sections" }));
    await screen.findByText('2 of 2 sections created for "Trakt picks".');
    expect(imports).toBe(2);
    expect(creates).toHaveLength(3);
    expect(creates[0]?.config).toMatchObject({ library_collection_id: "import-1" });
    expect(creates[1]?.config).toMatchObject({ library_collection_id: "import-2" });
    expect(creates[2]?.config).toMatchObject({ library_collection_id: "import-2" });
  });
});

describe("admin Home rows list", () => {
  it("turns a row off with the version it read and holds reordering until the list refetches", async () => {
    await setup();
    const implementation = mocks.request.getMockImplementation()!;
    let releaseList: (() => void) | null = null;
    let patched = false;
    mocks.request.mockImplementation((operation: string, args: Args) => {
      if (operation === "PATCH /api/v2/admin/sections/{id}") patched = true;
      if (patched && operation === "GET /api/v2/admin/sections")
        return new Promise((resolve) => {
          releaseList = () => resolve(implementation(operation, args));
        });
      return implementation(operation, args);
    });
    const toggle = screen.getByRole("switch", { name: "Original A is on for everyone" });
    toggle.focus();
    await userEvent.keyboard(" ");
    expect(await screen.findByText(/is off\. Nobody sees this row\./)).toBeInTheDocument();
    await waitFor(() => expect(releaseList).toBeTypeOf("function"));
    expect(writes).toHaveLength(1);
    expect(writes[0]!.operation).toBe("PATCH /api/v2/admin/sections/{id}");
    expect(writes[0]!.args.headers?.["If-Match"]).toBe('"rev-1"');
    expect(writes[0]!.args.body).toEqual({ enabled: false });
    expect(screen.getByRole("button", { name: "Move Original B" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("button", { name: "Home" })).toBeDisabled();
    await act(async () => releaseList!());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Move Original B" })).toHaveAttribute(
        "aria-disabled",
        "false",
      ),
    );
    expect(document.activeElement).toBe(
      screen.getByRole("switch", { name: "Original A is off for everyone" }),
    );
  });

  it("shows the conflict banner instead of writing when the row changed elsewhere", async () => {
    await setup();
    rows = rows.map((row) => (row.id === "a" ? { ...row, title: "Renamed elsewhere" } : row));
    fireEvent.click(screen.getByRole("switch", { name: "Original A is on for everyone" }));
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("Home rows changed since you opened this page.");
    expect(writes).toEqual([]);
    expect(screen.getByRole("switch", { name: "Original A is on for everyone" })).toBeChecked();
    fireEvent.click(within(banner).getByRole("button", { name: "Reload rows" }));
    await screen.findByRole("switch", { name: "Renamed elsewhere is on for everyone" });
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("uses a row as the hero banner from its menu", async () => {
    await setup();
    await chooseRowAction("Original B", "Use as hero banner");
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.args.path?.id).toBe("b");
    expect(writes[0]!.args.body).toEqual({ featured: true });
    await waitFor(() =>
      expect(
        screen.getAllByRole("listitem").find((item) => item.dataset.rowId === "b"),
      ).toHaveTextContent("Hero banner"),
    );
  });

  it("moves focus to the next row's menu after a delete, or to Add Section after the last", async () => {
    await setup();
    await chooseRowAction("Original A", "Delete row…");
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete row" }),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "More for Original B" }),
      ),
    );
    await chooseRowAction("Original B", "Delete row…");
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete row" }),
    );
    await screen.findByText("No rows on Home yet.");
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add Section" })),
    );
  });

  it("opens the library page a ?page= link names", async () => {
    mocks.request.mockImplementation(
      (
        (implementation) =>
        (operation: string, args: Args = {}) => {
          if (args.query?.scope === "library") {
            args.onResponse?.(new Response(null, { headers: { ETag: '"library-1"' } }));
            if (operation === "GET /api/v2/admin/sections/order")
              return Promise.resolve({ scope: "library", library_id: "7", ordered_ids: ["lib"] });
            if (operation === "GET /api/v2/admin/sections")
              return Promise.resolve({
                items: [
                  { ...initial("lib"), scope: "library", library_id: "7", title: "Movie row" },
                ],
              });
          }
          return implementation(operation, args);
        }
      )(mocks.request.getMockImplementation()!),
    );
    await setup(false, "/admin/home-rows?page=7");
    await screen.findByRole("button", { name: "More for Movie row" });
    expect(screen.getByRole("button", { name: "Movies" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("These rows show above the full Movies grid.")).toBeInTheDocument();
  });
});
