import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter, useSearchParams } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { v2Problem } from "@/api/v2/problems.test-support";
import { useAdminHomeRows } from "./useAdminHomeRows";

const mocks = vi.hoisted(() => ({ request: vi.fn(), error: vi.fn() }));
vi.mock("@/api/v2/request", async () => ({
  ...(await vi.importActual<typeof import("@/api/v2/request")>("@/api/v2/request")),
  v2: mocks.request,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: mocks.error, warning: vi.fn() } }));
vi.mock("@/hooks/queries/admin/libraries", () => ({
  useAdminLibraries: () => ({ data: [{ id: 7, name: "Movies", type: "movies" }] }),
}));
vi.mock("@/hooks/queries/collectionSurfaceRefresh", () => ({
  invalidateAdminCollectionQueries: vi.fn(),
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

function row(id: string, overrides: Partial<Row> = {}): Row {
  return {
    id,
    title: `Title ${id}`,
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
let libraryRows: Row[];
let revision: number;
let calls: Array<{ operation: string; args: Args }>;
/** Lets a test hold one operation open until it resolves it. */
let hold: { operation: string; release?: () => void } | null;

beforeEach(() => {
  vi.clearAllMocks();
  rows = [row("a"), row("b")];
  libraryRows = [row("lib", { scope: "library", library_id: "7", title: "Library row" })];
  revision = 1;
  calls = [];
  hold = null;
  mocks.request.mockImplementation(async (operation: string, args: Args = {}) => {
    calls.push({ operation, args });
    if (hold && hold.operation === operation) {
      await new Promise<void>((resolve) => {
        hold!.release = resolve;
      });
    }
    args.onResponse?.(new Response(null, { headers: { ETag: `"rev-${revision}"` } }));
    const scopeRows = args.query?.scope === "library" ? libraryRows : rows;
    if (operation === "GET /api/v2/admin/sections/capabilities")
      return { available: true, reset_profiles: false, preview: true };
    if (operation === "GET /api/v2/admin/sections/order")
      return { scope: "home", library_id: null, ordered_ids: scopeRows.map((entry) => entry.id) };
    if (operation === "GET /api/v2/admin/sections")
      return { items: scopeRows.map((entry) => ({ ...entry })) };
    if (operation === "GET /api/v2/admin/sections/{id}")
      return { ...rows.find((entry) => entry.id === args.path?.id)! };
    if (args.headers?.["If-Match"] !== `"rev-${revision}"`)
      throw v2Problem(412, "precondition_failed", "Changed on another client");
    if (operation === "PATCH /api/v2/admin/sections/{id}") {
      revision++;
      const changes = Object.fromEntries(
        Object.entries(args.body ?? {}).filter(([, value]) => value !== undefined),
      );
      rows = rows.map((entry) => (entry.id === args.path?.id ? { ...entry, ...changes } : entry));
      return rows.find((entry) => entry.id === args.path?.id);
    }
    if (operation === "PUT /api/v2/admin/sections/order") {
      revision++;
      const ids = args.body?.ordered_ids as string[];
      rows = ids.map((id) => rows.find((entry) => entry.id === id)!);
      return { scope: "home", library_id: null, ordered_ids: ids };
    }
    throw new Error(`Unexpected ${operation}`);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup(initialEntry = "/admin/home-rows") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
  const hook = renderHook(() => ({ adapter: useAdminHomeRows(), params: useSearchParams()[0] }), {
    wrapper,
  });
  return { ...hook, client };
}

async function ready(result: ReturnType<typeof setup>["result"]) {
  await waitFor(() => expect(result.current.adapter.status).toBe("ready"));
  await waitFor(() => expect(result.current.adapter.canEdit).toBe(true));
}

const writes = () =>
  calls.filter(
    (call) => !call.operation.startsWith("GET ") && call.operation !== "POST /api/v2/sections",
  );

describe("useAdminHomeRows", () => {
  it("maps the page's rows in server order", async () => {
    rows = [
      row("a", { featured: true }),
      row("b", { enabled: false, config: { source_provider: "trakt" } }),
    ];
    const { result } = setup();
    await ready(result);
    expect(result.current.adapter.rows).toEqual([
      expect.objectContaining({ id: "a", title: "Title a", hero: true, shown: true }),
      expect.objectContaining({ id: "b", shown: false, legacyTrakt: true, own: false }),
    ]);
    expect(result.current.adapter.pages).toEqual([
      { ref: { kind: "home" }, label: "Home" },
      { ref: { kind: "library", libraryId: 7 }, label: "Movies" },
    ]);
  });

  it("reads the page from ?page= and falls back to Home for an unknown page", async () => {
    const library = setup("/admin/home-rows?page=7");
    await ready(library.result);
    expect(library.result.current.adapter.page).toEqual({ kind: "library", libraryId: 7 });
    expect(library.result.current.adapter.rows.map((entry) => entry.id)).toEqual(["lib"]);
    library.unmount();

    const unknown = setup("/admin/home-rows?page=99");
    await ready(unknown.result);
    expect(unknown.result.current.adapter.page).toEqual({ kind: "home" });
  });

  it("writes the page to ?page= when the admin switches pages", async () => {
    const { result } = setup("/admin/home-rows?keep=1");
    await ready(result);
    act(() => result.current.adapter.setPage({ kind: "library", libraryId: 7 }));
    await waitFor(() => expect(result.current.params.get("page")).toBe("7"));
    expect(result.current.params.get("keep")).toBe("1");
    await waitFor(() =>
      expect(result.current.adapter.rows.map((entry) => entry.id)).toEqual(["lib"]),
    );
  });

  it("reports a failed first read as an error, not an empty page", async () => {
    const implementation = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation((operation: string, args: Args) =>
      operation === "GET /api/v2/admin/sections"
        ? Promise.reject(new Error("Read unavailable"))
        : implementation(operation, args),
    );
    const { result } = setup();
    await waitFor(() => expect(result.current.adapter.status).toBe("error"));
    expect(result.current.adapter.error).toBe("Read unavailable");
    expect(result.current.adapter.canEdit).toBe(false);
  });

  it("turns a row off with the version it read, and stays pending until the list refetches", async () => {
    const { result } = setup();
    await ready(result);
    hold = { operation: "GET /api/v2/admin/sections" };
    let done!: Promise<void>;
    act(() => {
      done = result.current.adapter.setShown("a", false);
    });
    expect(result.current.adapter.rows[0]!.shown).toBe(false);
    expect(result.current.adapter.pending).toBe(true);
    await waitFor(() => expect(hold?.release).toBeTypeOf("function"));
    expect(writes()).toEqual([
      expect.objectContaining({ operation: "PATCH /api/v2/admin/sections/{id}" }),
    ]);
    expect(writes()[0]!.args.headers?.["If-Match"]).toBe('"rev-1"');
    expect(writes()[0]!.args.body).toEqual({ enabled: false });
    expect(result.current.adapter.pending).toBe(true);
    expect(result.current.adapter.canReorder).toBe(false);
    hold.release!();
    hold = null;
    await act(async () => done);
    expect(result.current.adapter.pending).toBe(false);
    expect(result.current.adapter.rows[0]!.shown).toBe(false);
    expect(result.current.adapter.canReorder).toBe(true);
  });

  it("refuses a quick action when the row changed since the page loaded", async () => {
    const { result } = setup();
    await ready(result);
    rows = rows.map((entry) =>
      entry.id === "a" ? { ...entry, title: "Renamed elsewhere" } : entry,
    );
    revision = 2;
    await act(async () => result.current.adapter.setHero("a", true));
    expect(writes()).toEqual([]);
    expect(result.current.adapter.conflict).toEqual({ scope: "row", rowId: "a" });
    expect(result.current.adapter.rows[0]!.hero).toBe(false);
  });

  it("runs writes one at a time, each against the version after the last", async () => {
    const { result } = setup();
    await ready(result);
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.adapter.setShown("a", false);
      second = result.current.adapter.setHero("b", true);
    });
    await act(async () => Promise.all([first, second]));
    expect(writes().map((call) => [call.args.path?.id, call.args.headers?.["If-Match"]])).toEqual([
      ["a", '"rev-1"'],
      ["b", '"rev-2"'],
    ]);
    expect(result.current.adapter.conflict).toBeNull();
    expect(result.current.adapter.rows.map((entry) => [entry.shown, entry.hero])).toEqual([
      [false, false],
      [true, true],
    ]);
  });

  it("keeps the attempted order after a 412 and drops it on reload", async () => {
    const { result } = setup();
    await ready(result);
    const token = result.current.adapter.orderToken;
    revision = 2;
    await act(async () => result.current.adapter.reorder(["b", "a"], token));
    expect(writes()[0]!.args.headers?.["If-Match"]).toBe('"rev-1"');
    expect(result.current.adapter.conflict).toEqual({ scope: "page" });
    expect(result.current.adapter.rows.map((entry) => entry.id)).toEqual(["b", "a"]);
    expect(result.current.adapter.canReorder).toBe(false);
    await act(async () => result.current.adapter.reload());
    expect(result.current.adapter.conflict).toBeNull();
    expect(result.current.adapter.rows.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("ignores a page switch while a write is pending", async () => {
    const { result } = setup();
    await ready(result);
    hold = { operation: "PUT /api/v2/admin/sections/order" };
    let done!: Promise<void>;
    act(() => {
      done = result.current.adapter.reorder(["b", "a"]);
    });
    act(() => result.current.adapter.setPage({ kind: "library", libraryId: 7 }));
    expect(result.current.adapter.page).toEqual({ kind: "home" });
    await waitFor(() => expect(hold?.release).toBeTypeOf("function"));
    hold.release!();
    hold = null;
    await act(async () => done);
    expect(result.current.adapter.rows.map((entry) => entry.id)).toEqual(["b", "a"]);
  });
});
