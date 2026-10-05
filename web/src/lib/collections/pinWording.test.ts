// @vitest-environment node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `featured` on a server collection is "Pin to the start of its shelf" in
 * every collections surface, so no collections UI string may say "Featured".
 * Comments and identifiers (`homeFeatured`, `FeaturedRequest`) don't count.
 */
const SOURCE_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const ROOTS = ["components/collections", "components/CollectionTemplateGallery", "lib/collections"];

/** Pages are flat: every page whose file name says collection. */
const PAGES = readdirSync(join(SOURCE_ROOT, "pages"))
  .filter((name) => /collection/i.test(name))
  .map((name) => join("pages", name));

function sourceFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return /\.tsx?$/.test(path) ? [path] : [];
  return readdirSync(path).flatMap((entry) => sourceFiles(join(path, entry)));
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("collections wording", () => {
  it('never labels Pin "Featured"', () => {
    const offenders = [...ROOTS, ...PAGES]
      .flatMap((root) => sourceFiles(join(SOURCE_ROOT, root)))
      .map((path) => relative(SOURCE_ROOT, path))
      .filter((path) => !/\.test\.tsx?$/.test(path))
      .filter((path) =>
        /\bFeatured\b/.test(withoutComments(readFileSync(join(SOURCE_ROOT, path), "utf8"))),
      );
    expect(offenders).toEqual([]);
  });
});
