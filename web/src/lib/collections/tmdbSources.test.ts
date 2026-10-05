import { describe, expect, it } from "vitest";

import {
  chartLockReason,
  chartMediaKind,
  chartMediaTypes,
  chartName,
  defaultChart,
  normalizeChart,
  sameChart,
  TMDB_CHARTS,
} from "./tmdbSources";

describe("TMDB charts", () => {
  it("offers Both only for Trending, as the server's validator does", () => {
    for (const { preset } of TMDB_CHARTS) {
      expect(chartMediaTypes(preset).includes("all")).toBe(preset === "trending");
    }
  });

  it("locks Now playing and Upcoming to movies, Airing today and On the air to TV shows", () => {
    expect(chartMediaTypes("now_playing")).toEqual(["movie"]);
    expect(chartMediaTypes("upcoming")).toEqual(["movie"]);
    expect(chartMediaTypes("airing_today")).toEqual(["tv"]);
    expect(chartMediaTypes("on_the_air")).toEqual(["tv"]);
    expect(chartLockReason("upcoming")).toBe("TMDB has this chart for movies only");
    expect(chartLockReason("on_the_air")).toBe("TMDB has this chart for TV shows only");
    expect(chartLockReason("popular")).toBeNull();
  });

  it("keeps Trending over for Trending only and moves Show to one the chart offers", () => {
    expect(normalizeChart({ preset: "popular", mediaType: "all", timeWindow: "week" })).toEqual({
      preset: "popular",
      mediaType: "movie",
    });
    expect(normalizeChart({ preset: "airing_today", mediaType: "movie" })).toEqual({
      preset: "airing_today",
      mediaType: "tv",
    });
    expect(defaultChart("trending")).toEqual({
      preset: "trending",
      mediaType: "all",
      timeWindow: "day",
    });
  });

  it("names a chart and tells which titles it holds", () => {
    expect(chartName({ preset: "trending", mediaType: "movie", timeWindow: "week" })).toBe(
      "Trending Movies This Week",
    );
    expect(chartName({ preset: "trending", mediaType: "all", timeWindow: "day" })).toBe(
      "Trending Today",
    );
    expect(chartName({ preset: "top_rated", mediaType: "tv" })).toBe("Top Rated TV Shows");
    expect(chartMediaKind({ preset: "trending", mediaType: "all" })).toBe("mixed");
    expect(chartMediaKind({ preset: "upcoming", mediaType: "all" })).toBe("movie");
  });

  it("compares charts after normalizing them", () => {
    expect(
      sameChart(
        { preset: "popular", mediaType: "movie", timeWindow: "day" },
        {
          preset: "popular",
          mediaType: "movie",
        },
      ),
    ).toBe(true);
    expect(sameChart(defaultChart("trending"), { preset: "trending", mediaType: "all" })).toBe(
      true,
    );
    expect(
      sameChart(
        { preset: "trending", mediaType: "movie", timeWindow: "week" },
        {
          preset: "trending",
          mediaType: "movie",
          timeWindow: "day",
        },
      ),
    ).toBe(false);
  });
});
