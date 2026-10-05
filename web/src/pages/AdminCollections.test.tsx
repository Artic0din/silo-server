import { describe, expect, it } from "vitest";
import type { LibraryCollection } from "@/api/types";

import {
  buildTMDBPresetSourceInput,
  collectionsInAdminScope,
  parseTMDBPresetSourceConfig,
} from "./adminCollectionsShared";

describe("AdminCollections helpers", () => {
  it("uses the rendered board as the destructive scope for one library", () => {
    const allCollections = [
      { id: "all-only" },
      { id: "ungrouped" },
      { id: "grouped" },
    ] as LibraryCollection[];
    const grouped = { id: "grouped" } as LibraryCollection;
    const ungrouped = { id: "ungrouped" } as LibraryCollection;

    expect(
      collectionsInAdminScope(
        allCollections,
        {
          groups: [{ collections: [grouped] }, { collections: [grouped] }],
          ungrouped: [ungrouped],
        },
        7,
      ).map((collection) => collection.id),
    ).toEqual(["ungrouped", "grouped"]);
  });

  it("uses the unscoped collection list when all libraries are selected", () => {
    const allCollections = [{ id: "one" }, { id: "two" }] as LibraryCollection[];

    expect(collectionsInAdminScope(allCollections, undefined, null)).toEqual(allCollections);
  });

  it("parses a generic tmdb preset source config", () => {
    expect(
      parseTMDBPresetSourceConfig({
        id: "col-1",
        library_id: 1,
        library_ids: [1],
        slug: "popular-movies",
        title: "Popular Movies",
        description: "",
        collection_type: "tmdb",
        visibility: "visible",
        sort_order: 0,
        group_id: null,
        featured: true,
        poster_url: "",
        backdrop_url: "",
        source_url: "tmdb://popular/movie",
        query_definition: {
          library_ids: [1],
          match: "all",
          groups: [],
          sort: { field: "title", order: "asc" },
        },
        sort_config: {},
        source_config: {
          mode: "tmdb_preset",
          preset: "popular",
          media_type: "movie",
          limit: 35,
        },
        last_sync_status: "idle",
        last_sync_message: "",
        item_count: 0,
        created_at: "",
        updated_at: "",
      }),
    ).toEqual({
      preset: "popular",
      mediaType: "movie",
      timeWindow: "day",
      limit: "35",
    });
  });

  it("builds a trending tmdb source input with time window in the config and URL", () => {
    expect(
      buildTMDBPresetSourceInput({
        preset: "trending",
        mediaType: "all",
        timeWindow: "week",
        limit: "50",
      }),
    ).toEqual({
      source_url: "tmdb://trending/all/week",
      source_config: {
        mode: "tmdb_preset",
        preset: "trending",
        media_type: "all",
        time_window: "week",
        limit: 50,
      },
    });
  });

  it("builds a movie-only tmdb source input without time window", () => {
    expect(
      buildTMDBPresetSourceInput({
        preset: "now_playing",
        mediaType: "movie",
        timeWindow: "day",
        limit: "",
      }),
    ).toEqual({
      source_url: "tmdb://now_playing/movie",
      source_config: {
        mode: "tmdb_preset",
        preset: "now_playing",
        media_type: "movie",
      },
    });
  });
});
