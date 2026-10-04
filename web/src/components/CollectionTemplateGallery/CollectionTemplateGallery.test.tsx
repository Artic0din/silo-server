import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Library } from "@/api/types";
import { CollectionTemplateGallery } from "./CollectionTemplateGallery";

// Radix Select reads element sizes via ResizeObserver, which jsdom does not
// provide. A no-op polyfill is enough to render the dialog content.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === "undefined") {
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
    ResizeObserverStub;
}
if (typeof window !== "undefined" && !window.HTMLElement.prototype.hasPointerCapture) {
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.scrollIntoView = () => {};
}

const apiClientMocks = vi.hoisted(() => {
  class ApiClientErrorMock extends Error {
    status: number;

    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }

  return {
    ApiClientErrorMock,
    fetchMock: vi.fn(),
  };
});

const { fetchMock } = apiClientMocks;

vi.mock("@/api/client", () => ({
  ApiClientError: apiClientMocks.ApiClientErrorMock,
  api: (path: string, options?: unknown) => fetchMock(path, options),
}));

vi.mock("@/api/v2/request", async () => {
  const actual = await vi.importActual<typeof import("@/api/v2/request")>("@/api/v2/request");
  return {
    ...actual,
    v2: (operation: string, options?: unknown) =>
      operation === "GET /api/v2/admin/collections/capabilities"
        ? Promise.resolve({ artwork: true, imports: true, groups: true, item_reorder: true })
        : fetchMock(operation, options),
  };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/hooks/queries/profiles", () => ({
  useProfiles: () => ({ data: [] as Array<{ id: string; name: string }> }),
}));

vi.mock("@/hooks/queries/collectionSurfaceRefresh", () => ({
  invalidateAdminCollectionQueries: vi.fn(),
  invalidateUserCollectionQueries: vi.fn(),
}));

vi.mock("@/hooks/queries/libraries", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/queries/libraries")>(
    "@/hooks/queries/libraries",
  );
  return { ...actual, useUserLibraries: () => ({ data: [] }) };
});

const catalogResponse = {
  categories: [
    {
      category: "trending",
      label: "Trending",
      templates: [
        {
          id: "tmdb_trending_movies_week",
          title: "Trending Movies This Week",
          description: "Top trending movies on TMDB.",
          icon: "🎬",
          category: "trending",
          source: "tmdb",
          media_kind: "movie",
          default_limit: 50,
          tmdb: { preset: "trending", media_type: "movie", time_window: "week" },
        },
      ],
    },
    {
      category: "popular",
      label: "Popular",
      templates: [
        {
          id: "trakt_popular_shows",
          title: "Trakt Popular Shows",
          description: "Trakt's most-watched shows.",
          icon: "🌟",
          category: "popular",
          source: "trakt",
          media_kind: "tv",
          trakt: { preset: "popular", media_type: "tv" },
        },
      ],
    },
    {
      category: "custom",
      label: "Custom",
      templates: [
        {
          id: "tmdb_list_custom",
          title: "Custom TMDB List",
          description: "Paste any public TMDB list URL to seed a synced collection.",
          icon: "🎞️",
          category: "custom",
          source: "tmdb_list",
          media_kind: "mixed",
          default_limit: 100,
          tmdb_list: { url: "" },
        },
      ],
    },
  ],
};

const bundlesResponse = {
  bundles: [
    {
      id: "core_defaults",
      title: "Core Defaults",
      description: "A focused starter set of movie and TV collections.",
      template_ids: ["tmdb_trending_movies_week", "trakt_popular_shows"],
    },
  ],
};

const libraries: Library[] = [
  { id: 1, name: "Movies", type: "movies" } as unknown as Library,
  { id: 2, name: "TV Shows", type: "series" } as unknown as Library,
];

function renderGallery() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CollectionTemplateGallery
        open
        onOpenChange={() => {}}
        libraries={libraries}
        initialLibraryId={1}
      />
    </QueryClientProvider>,
  );
}

describe("CollectionTemplateGallery", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation((path: string) => {
      if (path === "GET /api/v2/admin/collections/templates")
        return Promise.resolve(catalogResponse);
      if (path === "GET /api/v2/admin/collections/template-bundles")
        return Promise.resolve(bundlesResponse);
      throw new Error(`unexpected path: ${path}`);
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("loads and displays templates grouped by category", async () => {
    renderGallery();

    await waitFor(() => {
      expect(screen.getByText("Trending Movies This Week")).toBeInTheDocument();
    });
    expect(screen.getByText("Trakt Popular Shows")).toBeInTheDocument();
    // Section labels render once in headings; pills render once each as well.
    expect(screen.getAllByText("Trending").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Popular").length).toBeGreaterThan(0);
    // Bundles live in Starter packs now; the gallery never asks for them.
    expect(screen.queryByText("Core Defaults")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "GET /api/v2/admin/collections/template-bundles",
      expect.anything(),
    );
  });

  it("filters templates by search across title and description", async () => {
    const user = userEvent.setup();
    renderGallery();

    await waitFor(() => {
      expect(screen.getByText("Trending Movies This Week")).toBeInTheDocument();
    });

    await user.type(screen.getByPlaceholderText("Search templates"), "trakt");
    expect(screen.queryByText("Trending Movies This Week")).not.toBeInTheDocument();
    expect(screen.getByText("Trakt Popular Shows")).toBeInTheDocument();
  });

  it("opens the config form when a template card is selected", async () => {
    const user = userEvent.setup();
    renderGallery();

    await waitFor(() => {
      expect(screen.getByText("Trending Movies This Week")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Trending Movies This Week"));
    // The drawer renders the explicit submit button.
    expect(screen.getByRole("button", { name: /Create Collection/i })).toBeInTheDocument();
  });

  it("does not preselect an ineligible initial library for TV templates", async () => {
    const user = userEvent.setup();
    renderGallery();

    await waitFor(() => {
      expect(screen.getByText("Trakt Popular Shows")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Trakt Popular Shows"));

    expect(screen.getByRole("button", { name: /TV Shows/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Movies$/i })).not.toBeInTheDocument();
  });

  it("dispatches to the TMDB import endpoint when submitting a TMDB template", async () => {
    const user = userEvent.setup();
    renderGallery();

    await waitFor(() => {
      expect(screen.getByText("Trending Movies This Week")).toBeInTheDocument();
    });

    fetchMock.mockImplementation((path: string) => {
      if (path === "GET /api/v2/admin/collections/templates")
        return Promise.resolve(catalogResponse);
      if (path === "GET /api/v2/admin/collections/template-bundles")
        return Promise.resolve(bundlesResponse);
      if (path === "POST /api/v2/admin/collections/import/tmdb") {
        return Promise.resolve({
          collection: { id: "x", library_id: "1", library_ids: ["1"], query_definition: {} },
        });
      }
      throw new Error(`unexpected path: ${path}`);
    });

    await user.click(screen.getByText("Trending Movies This Week"));
    await user.click(screen.getByRole("button", { name: /Create Collection/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "POST /api/v2/admin/collections/import/tmdb",
        expect.any(Object),
      );
    });
  });

  it("dispatches to the Trakt import endpoint when submitting a Trakt template", async () => {
    const user = userEvent.setup();
    renderGallery();

    await waitFor(() => {
      expect(screen.getByText("Trakt Popular Shows")).toBeInTheDocument();
    });

    fetchMock.mockImplementation((path: string) => {
      if (path === "GET /api/v2/admin/collections/templates")
        return Promise.resolve(catalogResponse);
      if (path === "GET /api/v2/admin/collections/template-bundles")
        return Promise.resolve(bundlesResponse);
      if (path === "POST /api/v2/admin/collections/import/trakt") {
        return Promise.resolve({ collection: { id: "y" } });
      }
      throw new Error(`unexpected path: ${path}`);
    });

    await user.click(screen.getByText("Trakt Popular Shows"));
    await user.click(screen.getByRole("button", { name: /Create Collection/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "POST /api/v2/admin/collections/import/trakt",
        expect.any(Object),
      );
    });
  });

  it("asks for a TMDB list URL and imports a Custom TMDB List template", async () => {
    const user = userEvent.setup();
    renderGallery();

    await waitFor(() => {
      expect(screen.getByText("Custom TMDB List")).toBeInTheDocument();
    });

    fetchMock.mockImplementation((path: string) => {
      if (path === "GET /api/v2/admin/collections/templates")
        return Promise.resolve(catalogResponse);
      if (path === "GET /api/v2/admin/collections/template-bundles")
        return Promise.resolve(bundlesResponse);
      if (path === "POST /api/v2/admin/collections/import/tmdb-list") {
        return Promise.resolve({ collection: { id: "z" } });
      }
      throw new Error(`unexpected path: ${path}`);
    });

    await user.click(screen.getByText("Custom TMDB List"));
    const submit = screen.getByRole("button", { name: /Create Collection/i });
    expect(submit).toBeDisabled();

    const url = screen.getByLabelText("TMDB list URL");
    await user.type(url, "https://www.themoviedb.org/movie/550");
    expect(url).toHaveAttribute("aria-invalid", "true");
    expect(submit).toBeDisabled();

    await user.clear(url);
    await user.type(url, "https://www.themoviedb.org/list/310-my-movie-list");
    expect(url).not.toHaveAttribute("aria-invalid");
    await user.click(submit);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "POST /api/v2/admin/collections/import/tmdb-list",
        expect.objectContaining({
          body: expect.objectContaining({
            url: "https://www.themoviedb.org/list/310-my-movie-list",
            library_ids: ["1"],
          }),
        }),
      );
    });
  });
});

// Personal mode lists what GET /collections/templates returns, which the server
// limits to sources a personal collection can import (#1640).
describe("CollectionTemplateGallery in user mode", () => {
  const userCatalog = {
    categories: [catalogResponse.categories[0], catalogResponse.categories[2]],
  };

  function renderUserGallery() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <CollectionTemplateGallery mode="user" open onOpenChange={() => {}} />
      </QueryClientProvider>,
    );
  }

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation((path: string) => {
      if (path === "GET /api/v2/collections/templates") return Promise.resolve(userCatalog);
      if (path === "POST /api/v2/collections/import/tmdb") {
        return Promise.resolve({ collection: { id: "personal-1" } });
      }
      throw new Error(`unexpected path: ${path}`);
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates a personal collection from a TMDB template", async () => {
    const user = userEvent.setup();
    renderUserGallery();

    await waitFor(() => {
      expect(screen.getByText("Trending Movies This Week")).toBeInTheDocument();
    });
    expect(screen.queryByText("Core Defaults")).not.toBeInTheDocument();

    await user.click(screen.getByText("Trending Movies This Week"));
    await user.click(screen.getByRole("button", { name: /Create Collection/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "POST /api/v2/collections/import/tmdb",
        expect.objectContaining({
          body: expect.objectContaining({ preset: "trending", media_type: "movie" }),
        }),
      );
    });
  });
});
