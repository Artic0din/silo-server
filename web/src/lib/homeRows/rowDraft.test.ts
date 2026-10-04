import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PageSectionConfig } from "@/api/types";
import { createAdminSection, updateAdminSection } from "@/api/adminSections";
import golden from "./payloads.golden.json";
import { buildRowCreateRequest, buildRowUpdateRequest, nextAppendPosition } from "./payloads";
import { everyPreset, recipeCatalogFixture } from "./recipeCatalogFixture.test-support";
import {
  canSaveDraft,
  draftForPreset,
  draftFromRow,
  findRecipe,
  mergeReloadedDraft,
  savedTitle,
  withTitle,
  withVariant,
  type RowDraft,
} from "./rowDraft";
import type { HomeRow, PageRef } from "./types";
import { VARIANT_FAMILIES } from "./variants";

const wire = vi.hoisted(() => ({ last: undefined as unknown }));
vi.mock("@/api/v2/request", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/v2/request")>()),
  v2: vi.fn(async (route: string, init?: { body?: unknown }) => {
    wire.last = { route, body: init?.body };
    throw new Error("request captured");
  }),
}));

beforeEach(() => {
  wire.last = undefined;
});

async function sentBody(send: () => Promise<unknown>): Promise<Record<string, unknown>> {
  await expect(send()).rejects.toThrow("request captured");
  return JSON.parse(JSON.stringify((wire.last as { body: unknown }).body));
}

const PAGES: Array<[string, PageRef]> = [
  ["home", { kind: "home" }],
  ["library", { kind: "library", libraryId: 7 }],
];

function row(overrides: Partial<HomeRow> = {}): HomeRow {
  return {
    id: "row-1",
    title: "Trending This Week",
    sectionType: "trending_on_server",
    config: { window: "7d" },
    itemLimit: 20,
    hero: false,
    shown: true,
    own: false,
    legacyTrakt: false,
    ...overrides,
  };
}

function stored(draft: RowDraft, overrides: Partial<PageSectionConfig> = {}): PageSectionConfig {
  return {
    id: "row-1",
    scope: "home",
    library_id: null,
    position: 3,
    section_type: draft.sectionType,
    title: draft.title,
    featured: draft.hero,
    item_limit: draft.itemLimit,
    config: draft.config,
    enabled: true,
    created_at: "2026-01-02T03:04:05.000Z",
    updated_at: "2026-01-02T03:04:05.000Z",
    ...overrides,
  };
}

describe("adding a row", () => {
  it("sends the gallery's create body for every preset, plus the bottom position", async () => {
    const adminCreate = golden.adminCreate as Record<string, unknown>;
    for (const { def, preset } of everyPreset()) {
      for (const [pageName, page] of PAGES) {
        const key = `${def.type}/${preset.key}/${pageName}`;
        if (!(key in adminCreate)) continue;
        // Start from the family's first preset and pick this one, as a chip or
        // radio does, so the variant switch is part of what is checked.
        let draft = draftForPreset(def, def.presets[0]);
        if (VARIANT_FAMILIES[def.type]) draft = withVariant(draft, def, preset.key);
        const body = await sentBody(() =>
          createAdminSection(
            buildRowCreateRequest(draft, savedTitle(draft, recipeCatalogFixture), page, 9),
          ),
        );
        const { position, ...rest } = body;
        expect(rest, key).toEqual(adminCreate[key]);
        expect(position).toBe(9);
      }
    }
  });

  it("puts a new row after every row on the page", () => {
    expect(nextAppendPosition([])).toBe(0);
    expect(nextAppendPosition([0, 4, 2])).toBe(5);
  });

  it("names a seasonal row after its preset (#585)", () => {
    const def = findRecipe(recipeCatalogFixture, "seasonal_themed")!;
    expect(draftForPreset(def, def.presets[0]).title).toBe("Seasonal Picks");
    expect(
      withVariant(draftForPreset(def, def.presets[0]), def, "se_family_movie_night").title,
    ).toBe("Family Movie Night");
  });
});

describe("row names", () => {
  const def = findRecipe(recipeCatalogFixture, "trending_on_server")!;

  it("follows the variant until the user types a name", () => {
    let draft = draftForPreset(def, def.presets[1]);
    expect(draft.title).toBe("Trending This Week");
    draft = withVariant(draft, def, "tr_24h");
    expect(draft.title).toBe("Trending Now (24h)");
    draft = withVariant(withTitle(draft, "Hot here"), def, "tr_30d");
    expect(draft.title).toBe("Hot here");
  });

  it("follows the variant on an existing row only while its name is the preset's", () => {
    expect(draftFromRow(row(), recipeCatalogFixture).titleFollowsVariant).toBe(true);
    expect(
      draftFromRow(row({ title: "What's hot" }), recipeCatalogFixture).titleFollowsVariant,
    ).toBe(false);
  });

  it("falls back to a plain name for a blank title, never a raw type", () => {
    const blank = { ...draftFromRow(row(), recipeCatalogFixture), title: "  " };
    expect(savedTitle(blank, recipeCatalogFixture)).toBe("Trending This Week");
    expect(savedTitle({ ...blank, config: { window: "90d" } }, recipeCatalogFixture)).toBe(
      "Trending on this server",
    );
    expect(savedTitle({ ...blank, sectionType: "next_up", config: {} }, recipeCatalogFixture)).toBe(
      "On Deck",
    );
    expect(savedTitle({ ...blank, sectionType: "next_up", config: {} }, undefined)).toBe("On deck");
  });
});

describe("editing a row", () => {
  it("never changes the config of a row that is only renamed", async () => {
    const configs = [
      { theme: "christmas", mode: "" },
      { subject_type: "era", subject: "1990s" },
      { continue_type: "reading" },
      { window: "7d", filter_library_ids: [3], generated_source: "home" },
    ];
    for (const config of configs) {
      const draft = withTitle(draftFromRow(row({ config }), recipeCatalogFixture), "New name");
      const body = await sentBody(() =>
        updateAdminSection({
          ...buildRowUpdateRequest(stored(draft), draft, draft.title),
          id: "row-1",
          etag: '"1"',
        }),
      );
      expect(body.config).toEqual(config);
      expect(body.title).toBe("New name");
    }
  });

  it("drops keys a variant change removed instead of merging the stored config back", () => {
    const def = findRecipe(recipeCatalogFixture, "editorial_spotlight");
    const original = draftFromRow(
      row({
        sectionType: "editorial_spotlight",
        config: { subject_type: "era", subject: "1990s" },
      }),
      recipeCatalogFixture,
    );
    const draft = withVariant(original, def, "es_director_auto");
    const request = buildRowUpdateRequest(stored(original), draft, "Directors");
    expect(request.config).toEqual({
      subject_type: "director",
      auto_rotate: true,
      rotation_cadence: "weekly",
    });
  });

  it("saves over the stored on/off state", () => {
    const draft = draftFromRow(row(), recipeCatalogFixture);
    expect(buildRowUpdateRequest(stored(draft, { enabled: false }), draft, "x").enabled).toBe(
      false,
    );
  });
});

describe("reloading after a conflict", () => {
  const original = draftFromRow(row(), recipeCatalogFixture);

  it("keeps the user's changes, takes the rest from the server and names what moved", () => {
    const edited = { ...withTitle(original, "My draft"), hero: true };
    const upstream = { ...original, title: "Remote title", itemLimit: 40 };
    const { draft, changedUpstream } = mergeReloadedDraft(original, edited, upstream);
    expect(draft).toMatchObject({ title: "My draft", hero: true, itemLimit: 40 });
    expect(changedUpstream).toEqual(["title", "itemLimit"]);
  });

  it("takes an upstream variant change when the user left the variant alone", () => {
    const upstream = { ...original, config: { window: "30d" } };
    const { draft, changedUpstream } = mergeReloadedDraft(original, original, upstream);
    expect(draft.config).toEqual({ window: "30d" });
    expect(changedUpstream).toEqual(["shows"]);
  });
});

describe("saving a draft", () => {
  const seasonal = (config: Record<string, unknown>): RowDraft => ({
    sectionType: "seasonal_themed",
    title: "Seasonal Picks",
    titleFollowsVariant: true,
    config,
    itemLimit: 20,
    hero: false,
  });

  it("refuses a seasonal row with no holiday, which the server would reject", () => {
    expect(canSaveDraft(seasonal({ enabled_themes: [] }))).toBe(false);
    expect(canSaveDraft(seasonal({ enabled_themes: ["christmas"] }))).toBe(true);
    expect(canSaveDraft(seasonal({ theme: "christmas" }))).toBe(true);
  });
});
