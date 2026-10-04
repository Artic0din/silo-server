import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Collections from "./Collections";

const capability = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/queries/collections", () => ({
  useCollectionCapabilities: capability,
  useCollections: () => ({ data: [], isLoading: false }),
  useServerCollections: () => ({ data: [] }),
  useDeleteCollection: () => ({}),
  useReorderCollections: () => ({}),
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
  return <p>{`${location.pathname}${location.search}`}</p>;
}

function show() {
  render(
    <MemoryRouter initialEntries={["/collections"]}>
      <Routes>
        <Route path="/collections" element={<Collections />} />
        <Route path="/collections/new" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("collection capability controls", () => {
  beforeEach(() => vi.clearAllMocks());
  it("keeps manual creation while hiding unsupported imports", () => {
    capability.mockReturnValue({
      data: { imports: false, artwork: false, item_reorder: false },
    });
    show();
    expect(screen.getByRole("button", { name: "New Collection" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Browse Templates" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Start from a template" })).toBeNull();
  });
  it("shows import entry points when the store supports them", () => {
    capability.mockReturnValue({
      data: { imports: true, artwork: true, item_reorder: true },
    });
    show();
    fireEvent.click(screen.getByRole("button", { name: "Browse Templates" }));
    // Templates are ready-made picks in the editor's Synced list step.
    expect(screen.getByText("/collections/new?type=synced")).toBeTruthy();
  });
});
