import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import golden from "@/lib/homeRows/payloads.golden.json";
import { recipeCatalogFixture } from "@/lib/homeRows/recipeCatalogFixture.test-support";
import AdminHomeRows from "./AdminHomeRows";

const mocks = vi.hoisted(() => ({ request: vi.fn(), error: vi.fn() }));
vi.mock("@/api/v2/request", async () => ({
  ...(await vi.importActual<typeof import("@/api/v2/request")>("@/api/v2/request")),
  v2: mocks.request,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: mocks.error, warning: vi.fn() } }));
vi.mock("@/hooks/queries/admin/libraries", () => ({
  useAdminLibraries: () => ({ data: [{ id: 7, name: "Movies", type: "movies" }] }),
}));
vi.mock("@/hooks/queries/admin/collections", () => ({
  useAdminCollections: () => ({ data: [] }),
}));
vi.mock("@/hooks/queries/collectionSurfaceRefresh", () => ({
  invalidateAdminCollectionQueries: vi.fn(),
}));
vi.mock("@/hooks/queries/useAllUserCollections", () => ({
  useAllUserCollections: () => ({ collections: [], isLoading: false }),
}));
vi.mock("@/lib/recipes", async () => ({
  ...(await vi.importActual<typeof import("@/lib/recipes")>("@/lib/recipes")),
  fetchRecipeCatalog: async () => recipeCatalogFixture,
}));
vi.mock("@/components/collections/CollectionRulesEditor", () => ({ default: () => null }));
vi.mock("@/components/CollectionSearchableSelect", () => ({
  CollectionSearchableSelect: () => <div>Collection picker</div>,
}));

type Row = {
  id: string;
  title: string;
  scope: string;
  library_id: string | null;
  position: number;
  section_type: string;
  item_limit: number;
  featured: boolean;
  enabled: boolean;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
type Args = {
  query?: { scope?: string; library_id?: string };
  path?: { id: string };
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
  onResponse?: (response: Response) => void;
};

function stored(id: string, overrides: Partial<Row> = {}): Row {
  return {
    id,
    title: `Row ${id}`,
    scope: "home",
    library_id: null,
    position: 0,
    section_type: "recently_added",
    item_limit: 20,
    featured: false,
    enabled: true,
    config: {},
    created_at: "2026-09-05T00:00:00Z",
    updated_at: "2026-09-05T00:00:00Z",
    ...overrides,
  };
}

let rows: Row[];
let writes: Array<{ operation: string; args: Args }>;
let previews: Args[];
let preview: boolean;
let holdCreate: Promise<void> | null;

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
  rows = [
    stored("a", { position: 0 }),
    stored("b", {
      position: 4,
      title: "Trending This Week",
      section_type: "trending_on_server",
      config: { window: "7d" },
    }),
  ];
  writes = [];
  previews = [];
  preview = true;
  holdCreate = null;
  mocks.request.mockImplementation(async (operation: string, args: Args = {}) => {
    args.onResponse?.(new Response(null, { headers: { ETag: '"rev-1"' } }));
    const scope = args.query?.scope ?? "home";
    const here = rows.filter((row) => row.scope === scope);
    if (operation === "GET /api/v2/admin/sections/capabilities")
      return { available: true, reset_profiles: false, preview };
    if (operation === "GET /api/v2/admin/sections/order")
      return {
        scope,
        library_id: args.query?.library_id ?? null,
        ordered_ids: here.map((row) => row.id),
      };
    if (operation === "GET /api/v2/admin/sections")
      return { items: here.map((row) => ({ ...row })) };
    if (operation === "GET /api/v2/admin/sections/{id}")
      return { ...rows.find((row) => row.id === args.path?.id)! };
    if (operation === "POST /api/v2/admin/sections/preview") {
      previews.push(args);
      return {
        items: [
          { content_id: "m1", type: "movie", title: "Past Lives", genres: [], keywords: [] },
          { content_id: "m2", type: "movie", title: "Dune: Part Two", genres: [], keywords: [] },
        ],
        total_count: 2,
      };
    }
    writes.push({ operation, args });
    if (operation === "POST /api/v2/admin/sections") {
      if (holdCreate) await holdCreate;
      const created = stored(`new-${writes.length}`, {
        ...(args.body as Partial<Row>),
        library_id: (args.body?.library_id as string | undefined) ?? null,
      });
      rows = [...rows, created];
      return created;
    }
    if (operation === "PATCH /api/v2/admin/sections/{id}") {
      const changes = Object.fromEntries(
        Object.entries(args.body ?? {}).filter(([, value]) => value !== undefined),
      );
      rows = rows.map((row) => (row.id === args.path?.id ? { ...row, ...changes } : row));
      return rows.find((row) => row.id === args.path?.id);
    }
    throw new Error(`Unexpected ${operation}`);
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function setup(entry = "/admin/home-rows") {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
          })
        }
      >
        <AdminHomeRows />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const add = await screen.findByRole("button", { name: "Add row" });
  await waitFor(() => expect(add).toBeEnabled());
  return add;
}

async function openAddRow() {
  await userEvent.click(await setup());
  return screen.findByRole("dialog", { name: "Add a row to Home" });
}

async function editRow(title: string) {
  await userEvent.click(await screen.findByRole("button", { name: `More for ${title}` }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Edit row…" }));
  return screen.findByRole("dialog", { name: "Edit row" });
}

const creates = () => writes.filter((write) => write.operation === "POST /api/v2/admin/sections");

describe("admin Home rows page", () => {
  it("is titled Home rows and says who sees the rows", async () => {
    await setup();
    expect(screen.getByRole("heading", { level: 1, name: "Home rows" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "The rows everyone sees on Home and on library pages. Profiles can still hide, rename or reorder them.",
      ),
    ).toBeInTheDocument();
  });
});

describe("Add row", () => {
  it("adds a picked variant once, at the bottom, with the gallery's body", async () => {
    let release!: () => void;
    holdCreate = new Promise((resolve) => {
      release = resolve;
    });
    const dialog = await openAddRow();
    expect(within(dialog).getByText("New rows go to the bottom of Home")).toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Trending on this server, 30 days" }),
    );
    const form = await screen.findByRole("dialog", { name: "Trending on this server" });
    expect(within(form).getByRole("radio", { name: /Last 30 days/ })).toBeChecked();
    expect(within(form).getByLabelText("Row name")).toHaveValue("Trending This Month");
    expect(
      within(form).getByText("Follows the time window until you type your own name."),
    ).toBeInTheDocument();

    await userEvent.dblClick(within(form).getByRole("button", { name: "Add row" }));
    await waitFor(() => expect(creates()).toHaveLength(1));
    const { position, ...body } = creates()[0]!.args.body!;
    expect(JSON.parse(JSON.stringify(body))).toEqual(
      (golden.adminCreate as Record<string, unknown>)["trending_on_server/tr_30d/home"],
    );
    expect(position).toBe(5);
    await act(async () => release());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(creates()).toHaveLength(1);
    await waitFor(() =>
      expect(
        screen.getAllByRole("listitem").find((item) => item.dataset.rowId === "new-1"),
      ).toHaveAttribute("data-highlighted", "true"),
    );
  });

  it("adds to the library page it is opened on and hides the Home-only library filter", async () => {
    rows.push(stored("lib", { scope: "library", library_id: "7", position: 2 }));
    await userEvent.click(await setup("/admin/home-rows?page=7"));
    const dialog = await screen.findByRole("dialog", { name: "Add a row to Movies" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Recently added" }));
    const form = await screen.findByRole("dialog", { name: "Recently added" });
    expect(within(form).getByText("Goes to the bottom of Movies")).toBeInTheDocument();
    expect(within(form).queryByText("From")).not.toBeInTheDocument();
    await userEvent.click(within(form).getByRole("button", { name: "Add row" }));
    await waitFor(() => expect(creates()).toHaveLength(1));
    expect(creates()[0]!.args.body).toMatchObject({
      scope: "library",
      library_id: "7",
      section_type: "recently_added",
      position: 3,
    });
  });

  it("returns to the picker with the search kept, and shows a live preview of the draft", async () => {
    const dialog = await openAddRow();
    await userEvent.type(within(dialog).getByRole("searchbox", { name: "Search rows" }), "4K");
    expect(
      within(dialog)
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(["Moods & themes1 kinds"]);
    await userEvent.click(within(dialog).getByRole("button", { name: "4K & HDR showcase" }));
    const form = await screen.findByRole("dialog", { name: "4K & HDR showcase" });
    expect(await within(form).findByText("Dune: Part Two")).toBeInTheDocument();
    expect(previews.at(-1)?.body).toMatchObject({
      section_type: "format_showcase",
      config: { format: "4k" },
      item_limit: 7,
    });
    await userEvent.click(within(form).getByRole("button", { name: "All rows" }));
    expect(await screen.findByRole("searchbox", { name: "Search rows" })).toHaveValue("4K");
  });

  it("says when the server has no previews", async () => {
    preview = false;
    const dialog = await openAddRow();
    await userEvent.click(within(dialog).getByRole("button", { name: "Hidden gems" }));
    expect(
      await screen.findByText("Previews aren't available on this server."),
    ).toBeInTheDocument();
    expect(previews).toEqual([]);
  });

  it("opens the older editor for collection rows until the dialog has a collection picker", async () => {
    const dialog = await openAddRow();
    await userEvent.click(within(dialog).getByRole("button", { name: "A collection" }));
    expect(await screen.findByText("Collection picker")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Add a row to Home" })).not.toBeInTheDocument();
  });
});

describe("Edit row", () => {
  it("switches a variant: the config's window and the following name change, nothing else", async () => {
    await setup();
    const dialog = await editRow("Trending This Week");
    expect(within(dialog).getByText("Trending on this server · 7 days")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Changes apply to everyone on Home who hasn't changed this row."),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("radio", { name: /Last 30 days/ }));
    expect(within(dialog).getByLabelText("Row name")).toHaveValue("Trending This Month");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.args.body).toMatchObject({
      section_type: "trending_on_server",
      title: "Trending This Month",
      config: { window: "30d" },
      enabled: true,
    });
    expect(writes[0]!.args.headers?.["If-Match"]).toBe('"rev-1"');
  });

  it("labels a weekly worldwide trending row by its week (#586)", async () => {
    rows[1] = {
      ...rows[1]!,
      title: "Popular now",
      section_type: "trending_discover",
      config: { source: "tmdb", window: "week" },
    };
    await setup();
    const dialog = await editRow("Popular now");
    expect(within(dialog).getByText("Trending worldwide · This week")).toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: /This week/ })).toBeChecked();
    expect(within(dialog).getByRole("radio", { name: /Today/ })).not.toBeChecked();
  });

  it("keeps a legacy single-theme seasonal row's config on a rename", async () => {
    rows[1] = {
      ...rows[1]!,
      title: "Xmas",
      section_type: "seasonal_themed",
      config: { theme: "christmas" },
    };
    await setup();
    const dialog = await editRow("Xmas");
    expect(
      within(dialog)
        .getAllByRole("radio")
        .filter((radio) => radio.getAttribute("aria-checked") === "true"),
    ).toEqual([]);
    expect(within(dialog).queryByText("Holidays", { selector: "legend" })).toBeNull();
    fireEvent.change(within(dialog).getByLabelText("Row name"), { target: { value: "Christmas" } });
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.args.body?.config).toEqual({ theme: "christmas" });
  });

  it("keeps a retired award row editable without a variant", async () => {
    rows[1] = {
      ...rows[1]!,
      title: "Oscars",
      section_type: "award_winners",
      config: { award_type: "oscar" },
    };
    await setup();
    const dialog = await editRow("Oscars");
    expect(within(dialog).getByText("Oscar Winners (no longer offered)")).toBeInTheDocument();
    expect(within(dialog).queryByRole("radiogroup")).toBeNull();
    expect(within(dialog).getByRole("button", { name: /^Change/ })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.args.body).toMatchObject({
      section_type: "award_winners",
      config: { award_type: "oscar" },
    });
  });

  it("shows Continue Reading rows and legacy Trakt rows without a variant or Change", async () => {
    rows[1] = {
      ...rows[1]!,
      title: "Keep reading",
      section_type: "continue_watching",
      config: { continue_type: "reading" },
    };
    rows.push(
      stored("t", {
        position: 5,
        title: "Trakt trending",
        section_type: "trending_discover",
        config: { source: "trakt", window: "week" },
      }),
    );
    await setup();
    let dialog = await editRow("Keep reading");
    expect(within(dialog).getByText("Continue Reading")).toBeInTheDocument();
    expect(within(dialog).queryByRole("radiogroup")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /^Change/ })).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    dialog = await editRow("Trakt trending");
    expect(within(dialog).queryByRole("radiogroup")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /^Change/ })).toBeNull();
  });

  it("changes what a row shows through the picker and saves the new kind's settings", async () => {
    await setup();
    const dialog = await editRow("Trending This Week");
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: "Change what Trending on this server · 7 days shows",
      }),
    );
    const picker = await screen.findByRole("dialog", { name: "Change what this row shows" });
    await userEvent.click(within(picker).getByRole("button", { name: "Mood picks, Mind-bending" }));
    const form = await screen.findByRole("dialog", { name: "Edit row" });
    expect(within(form).getByRole("radio", { name: "Mind-bending" })).toBeChecked();
    await userEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.args.body).toMatchObject({
      section_type: "mood_collection",
      title: "Mind-Bending Sci-Fi",
      config: { mood: "mind_bending" },
    });
  });

  it("opens Delete row… from the dialog footer", async () => {
    await setup();
    const dialog = await editRow("Trending This Week");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete row…" }));
    expect(
      await screen.findByRole("dialog", { name: "Delete Trending This Week?" }),
    ).toBeInTheDocument();
  });

  it("opens collection rows in the older editor", async () => {
    rows[1] = {
      ...rows[1]!,
      title: "Ghibli",
      section_type: "collection",
      config: { library_collection_id: "c1" },
    };
    await setup();
    await userEvent.click(await screen.findByRole("button", { name: "More for Ghibli" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Edit row…" }));
    expect(await screen.findByText("Collection picker")).toBeInTheDocument();
  });
});
