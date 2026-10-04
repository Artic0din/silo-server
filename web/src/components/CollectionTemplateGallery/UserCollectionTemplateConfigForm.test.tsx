import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CollectionTemplate } from "@/lib/collectionTemplates";
import { UserCollectionTemplateConfigForm } from "./UserCollectionTemplateConfigForm";

// Radix Select measures with ResizeObserver, which jsdom lacks.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const tmdbImport = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/queries/userCollectionImports", () => ({
  useImportUserTMDBCollection: () => ({ mutate: tmdbImport, isPending: false }),
  useImportUserMDBListCollection: () => ({ mutate: vi.fn(), isPending: false }),
  useImportUserTMDBListCollection: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/queries/libraries", () => ({ useUserLibraries: () => ({ data: [] }) }));
vi.mock("@/components/collections/CollectionDefaultSortField", () => ({
  CollectionDefaultSortField: () => null,
}));

const template = {
  id: "trending",
  title: "Trending",
  description: "What everyone watches",
  icon: "flame",
  category: "trending",
  source: "tmdb",
  media_kind: "movie",
  tmdb: { preset: "trending", media_type: "movie", time_window: "week" },
} as unknown as CollectionTemplate;

describe("UserCollectionTemplateConfigForm", () => {
  it("imports with the same Show to other profiles switch as the editors", () => {
    render(
      <UserCollectionTemplateConfigForm
        template={template}
        onCancel={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    expect(screen.queryByText("Share with other profiles")).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Show to other profiles" }));
    fireEvent.click(screen.getByRole("button", { name: "Create Collection" }));
    expect(tmdbImport).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Trending", is_shared: true }),
      expect.anything(),
    );
  });
});
