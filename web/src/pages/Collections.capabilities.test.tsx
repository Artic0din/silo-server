import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Collections from "./Collections";

const capability = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/queries/collections", () => ({
  useCollectionCapabilities: capability,
  useCollections: () => ({ data: [], isLoading: false }),
  useServerCollections: () => ({ data: [] }),
  useDeleteCollection: () => ({}),
  useReorderCollections: () => ({}),
  useSetCollectionShared: () => ({}),
}));
vi.mock("@/hooks/queries/profiles", () => ({ useProfiles: () => ({ data: [] }) }));
vi.mock("@/hooks/useCurrentProfile", () => ({ useCurrentProfile: () => ({ profile: null }) }));
vi.mock("@/hooks/queries/userCollectionImports", () => ({ useSyncUserCollection: () => ({}) }));
vi.mock("@/hooks/useUICustomization", () => ({
  useUICustomization: () => ({ cardPresentation: { poster_size: "medium" } }),
}));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));

function Where() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>;
}

function show(path = "/collections") {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/collections" element={<Collections />} />
          <Route path="/collections/new" element={<Where />} />
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  capability.mockReturnValue({
    data: { imports: true, artwork: true, item_reorder: true, import_sources: ["mdblist"] },
  });
});
afterEach(cleanup);

describe("New collection on the Collections page", () => {
  it("has one New collection button and no Browse Templates", () => {
    show();
    const header = screen.getByRole("heading", { level: 1, name: "Collections" }).parentElement!
      .parentElement!;
    expect(within(header).getAllByRole("button")).toHaveLength(1);
    expect(within(header).getByRole("button", { name: "New collection" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Browse Templates/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Start from a template/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Create from scratch/ })).toBeNull();
  });

  it("gives the empty Your collections one New collection button", () => {
    show();
    const section = screen.getByRole("region", { name: "Your collections" });
    expect(within(section).getAllByRole("button")).toHaveLength(1);
    expect(within(section).getByRole("button", { name: "New collection" })).toBeVisible();
  });

  it("opens the type picker from the header and from the empty state", async () => {
    show();
    const [header, empty] = screen.getAllByRole("button", { name: "New collection" });
    await userEvent.click(header!);
    const dialog = await screen.findByRole("dialog", { name: "New collection" });
    expect(screen.getAllByTestId("location").at(-1)).toHaveTextContent("/collections?dialog=new");
    expect(within(dialog).getByRole("link", { name: "Manual" })).toHaveAttribute(
      "href",
      "/collections/new?type=manual",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByTestId("location").at(-1)).toHaveTextContent(/^\/collections$/);

    await userEvent.click(empty!);
    expect(await screen.findByRole("dialog", { name: "New collection" })).toBeInTheDocument();
  });

  it("opens the type picker from a link", async () => {
    show("/collections?dialog=new");
    const dialog = await screen.findByRole("dialog", { name: "New collection" });
    await userEvent.click(within(dialog).getByRole("link", { name: "Smart" }));
    expect(screen.getAllByTestId("location").at(-1)).toHaveTextContent(
      "/collections/new?type=smart",
    );
  });

  it("keeps Manual and Smart when the server has no import sources", async () => {
    capability.mockReturnValue({
      data: { imports: false, artwork: false, item_reorder: false, import_sources: [] },
    });
    show("/collections?dialog=new");
    const dialog = await screen.findByRole("dialog", { name: "New collection" });
    expect(within(dialog).getAllByRole("link")).toHaveLength(2);
    expect(within(dialog).getByText("Synced lists are off on this server.")).toBeVisible();
  });
});
