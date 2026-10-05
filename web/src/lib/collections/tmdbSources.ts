/**
 * TMDB charts a Synced list can follow, and the choices TMDB accepts for each.
 * Mirrors `validateTMDB` in internal/collections/templates/validate.go, so the
 * editor never offers a combination the server refuses.
 */
import type { ImportTMDBCollectionRequest } from "@/api/types";

export type TMDBChartPreset = ImportTMDBCollectionRequest["preset"];
export type TMDBChartMediaType = ImportTMDBCollectionRequest["media_type"];
export type TMDBChartTimeWindow = NonNullable<ImportTMDBCollectionRequest["time_window"]>;

export interface TMDBChart {
  preset: TMDBChartPreset;
  mediaType: TMDBChartMediaType;
  /** Trending only. */
  timeWindow?: TMDBChartTimeWindow;
}

export const TMDB_CHARTS: ReadonlyArray<{ preset: TMDBChartPreset; label: string; hint: string }> =
  [
    { preset: "trending", label: "Trending", hint: "What's hot now" },
    { preset: "popular", label: "Popular", hint: "Most viewed" },
    { preset: "top_rated", label: "Top rated", hint: "Best scores" },
    { preset: "now_playing", label: "Now playing", hint: "Movies in cinemas" },
    { preset: "upcoming", label: "Upcoming", hint: "Movies coming soon" },
    { preset: "airing_today", label: "Airing today", hint: "TV, today" },
    { preset: "on_the_air", label: "On the air", hint: "TV, this week" },
  ];

export const CHART_MEDIA_LABEL: Readonly<Record<TMDBChartMediaType, string>> = {
  movie: "Movies",
  tv: "TV shows",
  all: "Both",
};

export const CHART_WINDOW_LABEL: Readonly<Record<TMDBChartTimeWindow, string>> = {
  day: "Today",
  week: "This week",
};

/** What Show offers for a chart; Both only for Trending. */
export function chartMediaTypes(preset: TMDBChartPreset): TMDBChartMediaType[] {
  switch (preset) {
    case "trending":
      return ["movie", "tv", "all"];
    case "popular":
    case "top_rated":
      return ["movie", "tv"];
    case "now_playing":
    case "upcoming":
      return ["movie"];
    case "airing_today":
    case "on_the_air":
      return ["tv"];
  }
}

/** "Trending over" applies to Trending only. */
export function chartHasTimeWindow(preset: TMDBChartPreset): boolean {
  return preset === "trending";
}

/** Why Show is fixed for a chart TMDB has for one kind only; null when it isn't. */
export function chartLockReason(preset: TMDBChartPreset): string | null {
  const [only, ...more] = chartMediaTypes(preset);
  if (more.length > 0) return null;
  return `TMDB has this chart for ${only === "movie" ? "movies" : "TV shows"} only`;
}

/**
 * The chart with choices TMDB accepts: a Show it doesn't offer falls back to
 * the first it does, and "Trending over" is kept for Trending only.
 */
export function normalizeChart(chart: TMDBChart): TMDBChart {
  const allowed = chartMediaTypes(chart.preset);
  const mediaType = allowed.includes(chart.mediaType) ? chart.mediaType : allowed[0]!;
  if (!chartHasTimeWindow(chart.preset)) return { preset: chart.preset, mediaType };
  return { preset: chart.preset, mediaType, timeWindow: chart.timeWindow ?? "day" };
}

/** A chart picked without choices yet: Trending starts on Both, today. */
export function defaultChart(preset: TMDBChartPreset): TMDBChart {
  return normalizeChart({ preset, mediaType: "all" });
}

export function sameChart(a: TMDBChart, b: TMDBChart): boolean {
  const left = normalizeChart(a);
  const right = normalizeChart(b);
  return (
    left.preset === right.preset &&
    left.mediaType === right.mediaType &&
    left.timeWindow === right.timeWindow
  );
}

/** The name a chart gets when no ready-made pick matches it: "Trending Movies Today". */
export function chartName(chart: TMDBChart): string {
  const { preset, mediaType, timeWindow } = normalizeChart(chart);
  const label = TMDB_CHARTS.find((entry) => entry.preset === preset)!.label;
  const title = label.replace(/\b\w/g, (letter) => letter.toUpperCase());
  const media = { movie: "Movies", tv: "TV Shows", all: "" }[mediaType];
  const when = timeWindow === "week" ? "This Week" : timeWindow === "day" ? "Today" : "";
  return [title, media, when].filter(Boolean).join(" ");
}

/** The kind of titles a chart holds, for which libraries it can match into. */
export function chartMediaKind(chart: TMDBChart): "movie" | "tv" | "mixed" {
  const { mediaType } = normalizeChart(chart);
  return mediaType === "all" ? "mixed" : mediaType;
}
