import { describe, expect, it } from "vitest";

import type { RecipeCatalogResponse } from "@/lib/recipes";

import { recipeLabel } from "./EditableSectionRows";

describe("recipeLabel", () => {
  const catalog: RecipeCatalogResponse = {
    categories: {
      social: [
        {
          type: "trending_discover",
          category: "social",
          avoid_duplicates: false,
          supports_rotation: false,
          admin_only: false,
          presets: [
            {
              key: "tdisc_tmdb_day",
              display_name: "TMDB Trending Today",
              icon: "",
              description_short: "",
              default_params: { source: "tmdb", window: "day" },
            },
            {
              key: "tdisc_tmdb_week",
              display_name: "TMDB Trending This Week",
              icon: "",
              description_short: "",
              default_params: { source: "tmdb", window: "week" },
            },
          ],
        },
      ],
    },
  };

  it("names the preset that matches the section config", () => {
    expect(recipeLabel(catalog, "trending_discover", { source: "tmdb", window: "week" })).toBe(
      "TMDB Trending This Week",
    );
    expect(recipeLabel(catalog, "trending_discover", { source: "tmdb", window: "day" })).toBe(
      "TMDB Trending Today",
    );
  });

  it("falls back to the first preset when no preset matches", () => {
    expect(recipeLabel(catalog, "trending_discover")).toBe("TMDB Trending Today");
  });
});
