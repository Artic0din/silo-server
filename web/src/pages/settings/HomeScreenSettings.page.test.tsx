import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SectionOverride, SettingsSectionEntry } from "@/api/types";
import HomeScreenSettings from "./HomeScreenSettings";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/api/v2/request", async () => ({
  ...(await vi.importActual<typeof import("@/api/v2/request")>("@/api/v2/request")),
  v2: mocks.request,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useAuth", () => ({ useOptionalAuth: () => null }));
vi.mock("@/hooks/queries/libraries", () => ({
  useUserLibraries: () => ({ data: [{ id: 7, name: "Movies" }] }),
}));
vi.mock("@/hooks/queries/settingValues", () => ({
  useEffectiveSettings: () => ({ data: {}, isLoading: false }),
  useSetSettingValue: () => ({ mutate: vi.fn(), isPending: false }),
}));
// Export and import reads other routes and is not part of these saves.
vi.mock("@/components/sections/HomeLayoutTransfer", () => ({ default: () => null }));

type Args = { query?: { scope?: string }; body?: { overrides: SectionOverride[] } };

function entry(id: string, position: number): SettingsSectionEntry {
  return {
    id,
    section_type: "recently_added",
    title: `Row ${id}`,
    featured: false,
    item_limit: 20,
    hidden: false,
    is_custom: false,
    customized: false,
    position,
    config: {},
  };
}

let saved: SectionOverride[];
let puts: SectionOverride[][];
let held: Map<string, Array<() => void>>;

function hold(operation: string) {
  held.set(operation, []);
}

async function release(operation: string) {
  await waitFor(() => expect(held.get(operation)?.length).toBeGreaterThan(0));
  const resume = held.get(operation)!.shift()!;
  await act(async () => resume());
}

beforeEach(() => {
  vi.clearAllMocks();
  saved = [];
  puts = [];
  held = new Map();
  mocks.request.mockImplementation(async (operation: string, args: Args = {}) => {
    const queue = held.get(operation);
    if (queue) await new Promise<void>((resume) => queue.push(resume));
    if (args.query?.scope === "library") {
      if (operation === "GET /api/v2/profile/sections/settings") return { items: [] };
      if (operation === "GET /api/v2/profile/sections") return { items: [] };
    }
    switch (operation) {
      case "GET /api/v2/sections/recipes":
        return { categories: [] };
      case "GET /api/v2/profile/sections/flags":
        return { allow_profile_custom_sections: false };
      case "GET /api/v2/profile/sections/settings": {
        const byRow = new Map(saved.map((o) => [o.section_id, o]));
        return {
          items: [entry("a", 0), entry("b", 1)]
            .filter((row) => !byRow.get(row.id)?.removed)
            .map((row) => ({ ...row, hidden: byRow.get(row.id)?.hidden ?? row.hidden })),
        };
      }
      case "GET /api/v2/profile/sections":
        return { items: saved };
      case "PUT /api/v2/profile/sections":
        puts.push(args.body!.overrides);
        saved = args.body!.overrides;
        return { items: saved };
      case "DELETE /api/v2/profile/sections":
        saved = [];
        return undefined;
    }
    throw new Error(`Unexpected ${operation}`);
  });
});

async function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <HomeScreenSettings />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByRole("button", { name: "Hide Row a" })).toBeEnabled());
}

const pagePicker = () => screen.getByRole("combobox");
const loadingNote = () => screen.queryByText(/Loading saved section state/);

describe("HomeScreenSettings page", () => {
  it("saves a hidden row and keeps the page picker off until the save lands", async () => {
    const user = userEvent.setup();
    await renderPage();
    hold("PUT /api/v2/profile/sections");

    await user.click(screen.getByRole("button", { name: "Hide Row a" }));

    expect(screen.getByRole("button", { name: "Show Row a" })).toBeInTheDocument();
    // A page switch made now would be refused, so the picker says so.
    expect(pagePicker()).toBeDisabled();
    await release("PUT /api/v2/profile/sections");
    await waitFor(() => expect(pagePicker()).toBeEnabled());
    expect(puts).toHaveLength(1);
    expect(puts[0]!.find((o) => o.section_id === "a")).toMatchObject({ hidden: true });
  });

  it("removes a row after the delete confirmation", async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByRole("button", { name: "Delete Row b" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toContainEqual(expect.objectContaining({ section_id: "b", removed: true }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Hide Row b" })).not.toBeInTheDocument(),
    );
  });

  it("disables editing during a reset without calling it loading", async () => {
    const user = userEvent.setup();
    await renderPage();
    hold("DELETE /api/v2/profile/sections");

    await user.click(screen.getByRole("button", { name: "Reset to Default" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Reset" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Hide Row a" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Reset to Default" })).toBeDisabled();
    expect(pagePicker()).toBeDisabled();
    expect(loadingNote()).not.toBeInTheDocument();

    await release("DELETE /api/v2/profile/sections");
    await waitFor(() => expect(screen.getByRole("button", { name: "Hide Row a" })).toBeEnabled());
    expect(pagePicker()).toBeEnabled();
  });
});
