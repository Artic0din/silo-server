import { describe, expect, it } from "vitest";

import { readRowLinks, safeReturnPath } from "@/lib/homeRows/rowLinks";

import { SERVER_SCOPE } from "./scope";
import {
  addRowPath,
  onRowsLine,
  openRowPath,
  rowMeta,
  rowPages,
  rowPlaces,
  type CollectionRow,
} from "./rows";

const NAMES = new Map([
  [1, "Movies"],
  [2, "Kids"],
  [3, "4K Movies"],
]);

function row(overrides: Partial<CollectionRow>): CollectionRow {
  return {
    id: "s1",
    page: { kind: "home" },
    title: "Studio Ghibli",
    enabled: true,
    position: 6,
    pageRowCount: 9,
    ...overrides,
  };
}

function paramsOf(path: string) {
  return new URL(path, "https://silo.test").searchParams;
}

describe("collection rows", () => {
  it("says where each row is and its place on the page", () => {
    expect(rowMeta(row({}), NAMES)).toBe("Home · row 6 of 9");
    expect(
      rowMeta(
        row({ page: { kind: "library", libraryId: 2 }, position: 3, pageRowCount: 7 }),
        NAMES,
      ),
    ).toBe("Kids page · row 3 of 7");
    expect(rowMeta(row({ enabled: false }), NAMES)).toBe("Home · row 6 of 9 · Turned off");
  });

  it("names the pages viewers see it on, leaving turned-off rows out", () => {
    const rows = [
      row({ id: "a" }),
      row({ id: "b", page: { kind: "library", libraryId: 2 } }),
      row({ id: "c", page: { kind: "library", libraryId: 3 }, enabled: false }),
    ];
    expect(onRowsLine(rows, NAMES)).toBe("On Home and the Kids page");
    expect(rowPlaces(rows, NAMES)).toBe("Home and the Kids and 4K Movies pages");
    expect(onRowsLine([row({ enabled: false })], NAMES)).toBeNull();
    expect(onRowsLine([], NAMES)).toBeNull();
  });

  it("offers the collection's own libraries first, then the others", () => {
    const all = [
      { id: 1, name: "Movies" },
      { id: 2, name: "Kids" },
      { id: 3, name: "4K Movies" },
    ];
    expect(rowPages([{ id: 2, name: "Kids" }], all)).toEqual({
      bound: [{ id: 2, name: "Kids" }],
      others: [
        { id: 1, name: "Movies" },
        { id: 3, name: "4K Movies" },
      ],
    });
  });

  it("links into admin Home rows on the right page, with a return the Home rows page accepts", () => {
    for (const libraryId of [null, 7]) {
      const editor = SERVER_SCOPE.paths.edit("c 1/x", { libraryId });
      const path = addRowPath("c 1/x", { kind: "library", libraryId: 2 }, editor);
      expect(path.startsWith("/admin/home-rows?")).toBe(true);
      const params = paramsOf(path);
      expect(params.get("page")).toBe("2");
      expect(params.get("add")).toBe("collection:library:c 1/x");
      expect(safeReturnPath(params.get("return"))).toBe(editor);
      expect(readRowLinks(params, "admin")).toEqual({
        add: { source: "library", id: "c 1/x" },
        edit: null,
        returnTo: editor,
      });
    }
    const home = paramsOf(addRowPath("c1", { kind: "home" }));
    expect(home.get("page")).toBe("home");
    expect(home.has("return")).toBe(false);
  });

  it("opens a row in Edit row on its page", () => {
    const params = paramsOf(openRowPath({ id: "s9", page: { kind: "library", libraryId: 2 } }));
    expect(params.get("page")).toBe("2");
    expect(params.get("edit")).toBe("s9");
  });
});
