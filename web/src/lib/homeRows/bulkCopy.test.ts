import { describe, expect, it } from "vitest";
import { canCopyToLibraries, libraryCopyIds } from "./bulkCopy";
import { recipeCatalogFixture } from "./recipeCatalogFixture.test-support";

const LIBRARY = { kind: "library", libraryId: 7 } as const;

function readyMadeTypes(): string[] {
  return Object.values(recipeCatalogFixture.categories ?? {})
    .flat()
    .map((def) => def!.type)
    .filter((type) => !["collection", "custom_filter", "admin_curated_list"].includes(type));
}

describe("canCopyToLibraries", () => {
  it("allows every ready-made kind whose settings name no library", () => {
    const types = readyMadeTypes();
    expect(types.length).toBeGreaterThan(20);
    for (const sectionType of types) {
      expect(canCopyToLibraries({ sectionType, config: {} }), sectionType).toBe(true);
    }
  });

  it.each(["collection", "custom_filter", "admin_curated_list", "genre", "award_winners"])(
    "refuses %s rows, whose settings belong to one page",
    (sectionType) => {
      expect(canCopyToLibraries({ sectionType, config: {} })).toBe(false);
    },
  );

  it.each([
    ["filter_library_ids", { filter_library_ids: [7] }],
    ["filter_library_id", { filter_library_id: 7 }],
    ["library_ids", { library_ids: [7] }],
    ["generated_library_id", { generated_source: "home_library", generated_library_id: 7 }],
    ["library_id", { subject_type: "director", library_id: 7 }],
  ])("refuses a row whose settings name a library through %s", (_key, config) => {
    expect(canCopyToLibraries({ sectionType: "recently_added", config })).toBe(false);
  });

  it("refuses a legacy Trakt row, which the server won't create again", () => {
    expect(
      canCopyToLibraries({ sectionType: "trending_discover", config: { source: "trakt" } }),
    ).toBe(false);
  });
});

describe("libraryCopyIds", () => {
  const draft = { sectionType: "trending_on_server", config: { window: "7d" }, hero: false };

  it("returns the other pages picked, without the current one or repeats", () => {
    expect(libraryCopyIds({ ...draft, extraLibraryIds: [8, 7, 9, 8] }, LIBRARY)).toEqual([8, 9]);
  });

  it("returns nothing on Home, for a hero row, or for a kind that can't be copied", () => {
    expect(libraryCopyIds({ ...draft, extraLibraryIds: [8] }, { kind: "home" })).toEqual([]);
    expect(libraryCopyIds({ ...draft, hero: true, extraLibraryIds: [8] }, LIBRARY)).toEqual([]);
    expect(
      libraryCopyIds(
        { sectionType: "collection", config: {}, hero: false, extraLibraryIds: [8] },
        LIBRARY,
      ),
    ).toEqual([]);
    expect(libraryCopyIds(draft, LIBRARY)).toEqual([]);
  });
});
