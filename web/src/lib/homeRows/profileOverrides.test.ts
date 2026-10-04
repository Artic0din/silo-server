import { describe, expect, it } from "vitest";
import type { SettingsSectionEntry } from "@/api/types";
import { buildSectionOverrides } from "./profileOverrides";

function entry(id: string, overrides: Partial<SettingsSectionEntry> = {}): SettingsSectionEntry {
  return {
    id,
    section_type: "recently_added",
    title: id,
    featured: false,
    item_limit: 20,
    hidden: false,
    is_custom: false,
    customized: false,
    position: 0,
    config: {},
    ...overrides,
  };
}

describe("buildSectionOverrides with several changed rows", () => {
  const trakt = { source: "trakt", list: "trending" };
  const sections = [
    entry("a"),
    entry("trakt-1", { position: 1, config: trakt }),
    entry("trakt-2", { position: 2, config: trakt }),
  ];
  const newId = (id: string) => `new-${id}`;

  it("sends each shown legacy Trakt row the merged changes name, and leaves out the rest", () => {
    const overrides = buildSectionOverrides(sections, [], {
      newId,
      changedSectionIds: new Set(["a", "trakt-2"]),
    });
    expect(overrides.map((o) => [o.section_id, o.position])).toEqual([
      ["a", 0],
      ["trakt-2", 2],
    ]);
  });

  it("matches the single changed row form when the set holds one id", () => {
    expect(
      buildSectionOverrides(sections, [], { newId, changedSectionIds: new Set(["trakt-1"]) }),
    ).toEqual(buildSectionOverrides(sections, [], { newId, changedSectionId: "trakt-1" }));
  });
});
