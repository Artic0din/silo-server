import { describe, expect, it } from "vitest";
import { collapsedRowText, describeRow, rowSwitchLabel, titleCount } from "./describe";
import type { HomeRow } from "./types";

function row(sectionType: string, config: Record<string, unknown> = {}): HomeRow {
  return {
    id: "r1",
    title: "Row",
    sectionType,
    config,
    itemLimit: 20,
    hero: false,
    shown: true,
    own: false,
    legacyTrakt: false,
  };
}

const home = { pageKind: "home" as const };
const library = { pageKind: "library" as const };

function text(parts: ReturnType<typeof describeRow>): string {
  return parts.map((part) => (typeof part === "string" ? part : part.strong)).join("");
}

describe("describeRow", () => {
  it("says personalized rows are picked for each viewer", () => {
    expect(text(describeRow(row("continue_watching"), home))).toBe(
      "What each viewer is partway through",
    );
    expect(text(describeRow(row("recommended_for_you"), home))).toBe(
      "Picked for each viewer from their own watch history",
    );
    expect(text(describeRow(row("next_up"), home))).toBe(
      "The next episode of every show each viewer follows",
    );
  });

  it("follows the preset params of multi-preset rows", () => {
    expect(text(describeRow(row("trending_on_server", { window: "7d" }), home))).toBe(
      "Most played on this server in the last 7 days",
    );
    expect(text(describeRow(row("trending_on_server", { window: "24h" }), library))).toBe(
      "Most played here in the last 24 hours",
    );
    expect(text(describeRow(row("trending_discover", { window: "week" }), home))).toBe(
      "Trending on TMDB this week, from what you have",
    );
    expect(text(describeRow(row("format_showcase", { format: "4k", sort: "recent" }), home))).toBe(
      "The latest 4K additions",
    );
    expect(text(describeRow(row("continue_watching", { continue_type: "listening" }), home))).toBe(
      "Audiobooks each viewer is partway through",
    );
    expect(text(describeRow(row("editorial_spotlight", { subject_type: "director" }), home))).toBe(
      "A different director every week",
    );
    expect(
      text(
        describeRow(row("editorial_spotlight", { subject_type: "era", subject: "1980s" }), home),
      ),
    ).toBe("Titles from the 1980s");
  });

  it("says where recently added rows draw from on each page", () => {
    expect(text(describeRow(row("recently_added"), home))).toBe(
      "Newest movies and episodes from all libraries",
    );
    expect(text(describeRow(row("recently_added", { filter_library_ids: [1, 2] }), home))).toBe(
      "Newest additions from 2 libraries",
    );
    expect(text(describeRow(row("recently_added"), library))).toBe(
      "Newest additions to this library",
    );
  });

  it("names the collection a collection row shows, in bold", () => {
    const parts = describeRow(row("collection", { library_collection_id: "c1" }), {
      ...home,
      collectionTitle: (id) => (id === "c1" ? "Studio Ghibli" : undefined),
    });
    expect(parts).toEqual(["The ", { strong: "Studio Ghibli" }, " collection"]);
    expect(text(describeRow(row("collection", { library_collection_id: "gone" }), home))).toBe(
      "A collection",
    );
  });

  it("counts the rules of a rule row and names what it matches", () => {
    expect(
      text(
        describeRow(
          row("custom_filter", {
            media_scope: "movie",
            groups: [
              { match: "all", rules: [{}, {}] },
              { match: "all", rules: [{}] },
            ],
          }),
          home,
        ),
      ),
    ).toBe("Movies matching 3 rules");
    expect(
      text(describeRow(row("custom_filter", { groups: [{ match: "all", rules: [{}] }] }), home)),
    ).toBe("Titles matching 1 rule");
    expect(text(describeRow(row("custom_filter", { media_scope: "series" }), home))).toBe(
      "All shows",
    );
  });

  it("never shows a raw type key for an unknown kind", () => {
    expect(text(describeRow(row("some_future_type"), home))).toBe("Row");
  });
});

describe("row copy", () => {
  it("counts titles", () => {
    expect(titleCount(20)).toBe("20 titles");
    expect(titleCount(1)).toBe("1 title");
  });

  it("labels the switch by its effect on each surface", () => {
    const shown = row("recently_added");
    expect(rowSwitchLabel("admin", { ...shown, title: "New" }, "Home")).toBe(
      "New is on for everyone",
    );
    expect(rowSwitchLabel("admin", { ...shown, title: "New", shown: false }, "Home")).toBe(
      "New is off for everyone",
    );
    expect(rowSwitchLabel("profile", { ...shown, title: "New" }, "Home")).toBe(
      "Show New on my Home",
    );
    expect(rowSwitchLabel("profile", { ...shown, title: "New" }, "Movies")).toBe(
      "Show New on my Movies page",
    );
  });

  it("says who stops seeing a collapsed row", () => {
    expect(collapsedRowText("admin", "Home")).toBe(" is off. Nobody sees this row.");
    expect(collapsedRowText("profile", "Home")).toBe(" is hidden on your Home.");
    expect(collapsedRowText("profile", "Movies")).toBe(" is hidden on your Movies page.");
  });
});
