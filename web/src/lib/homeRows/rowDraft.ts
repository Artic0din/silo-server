import type { GalleryPreset, RecipeCatalogResponse, RecipeDefinition } from "@/lib/recipes";
import { rowKindLabel } from "./catalog";
import type { HomeRow } from "./types";
import { applyVariant, variantFamily, variantOf } from "./variants";

/** What the Add row / Edit row form holds while the user edits it. */
export interface RowDraft {
  sectionType: string;
  title: string;
  /** The name is still the preset's, so picking another variant renames the row. */
  titleFollowsVariant: boolean;
  config: Record<string, unknown>;
  itemLimit: number;
  hero: boolean;
}

export const DEFAULT_ITEM_LIMIT = 20;

/** Sorted-key JSON, so two configs with the same content compare equal. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function findRecipe(
  catalog: RecipeCatalogResponse | undefined,
  sectionType: string,
): RecipeDefinition | undefined {
  for (const defs of Object.values(catalog?.categories ?? {})) {
    const found = defs?.find((def) => def.type === sectionType);
    if (found) return found;
  }
  return undefined;
}

function presetName(def: RecipeDefinition | undefined, presetKey: string | null) {
  return presetKey
    ? def?.presets.find((preset) => preset.key === presetKey)?.display_name
    : undefined;
}

/** A new row from a picked preset: exactly the preset's params, as the gallery added them. */
export function draftForPreset(def: RecipeDefinition, preset: GalleryPreset | undefined): RowDraft {
  return {
    sectionType: def.type,
    title: preset?.display_name ?? rowKindLabel(def.type),
    titleFollowsVariant: variantFamily(def.type) !== undefined,
    config: { ...(preset?.default_params ?? {}) },
    itemLimit: DEFAULT_ITEM_LIMIT,
    hero: false,
  };
}

/** An existing row as the form starts it. Opening a row never changes its config. */
export function draftFromRow(row: HomeRow, catalog: RecipeCatalogResponse | undefined): RowDraft {
  const name = presetName(
    findRecipe(catalog, row.sectionType),
    variantOf(row.sectionType, row.config),
  );
  return {
    sectionType: row.sectionType,
    title: row.title,
    titleFollowsVariant: name !== undefined && name === row.title,
    config: { ...row.config },
    itemLimit: row.itemLimit,
    hero: row.hero,
  };
}

/** Picks another variant; the name follows it until the user typed their own. */
export function withVariant(
  draft: RowDraft,
  def: RecipeDefinition | undefined,
  presetKey: string,
): RowDraft {
  const name = presetName(def, presetKey);
  return {
    ...draft,
    config: applyVariant(draft.sectionType, draft.config, presetKey),
    title: draft.titleFollowsVariant && name ? name : draft.title,
  };
}

export function withTitle(draft: RowDraft, title: string): RowDraft {
  return { ...draft, title, titleFollowsVariant: false };
}

/**
 * The name a save sends. A blank name falls back to the variant's preset
 * name, then to the kind's plain name, never to a raw type key.
 */
export function savedTitle(draft: RowDraft, catalog: RecipeCatalogResponse | undefined): string {
  const typed = draft.title.trim();
  if (typed) return typed;
  const def = findRecipe(catalog, draft.sectionType);
  const variant = variantOf(draft.sectionType, draft.config);
  return (
    presetName(def, variant) ??
    (def?.presets.length === 1 ? def.presets[0]?.display_name : undefined) ??
    rowKindLabel(draft.sectionType)
  );
}

/** Whether the server would accept the draft; the form says what is missing. */
export function canSaveDraft(draft: RowDraft): boolean {
  // The server refuses a seasonal row with an empty holiday list and no legacy theme.
  const themes = draft.config.enabled_themes;
  return !(draft.sectionType === "seasonal_themed" && Array.isArray(themes) && themes.length === 0);
}

export type DraftField = "title" | "shows" | "itemLimit" | "hero";

export const DRAFT_FIELD_LABELS: Record<DraftField, string> = {
  title: "Row name",
  shows: "What it shows",
  itemLimit: "Number of titles",
  hero: "Hero banner",
};

const DRAFT_FIELDS: readonly DraftField[] = ["title", "shows", "itemLimit", "hero"];

function fieldValue(draft: RowDraft, field: DraftField): string {
  switch (field) {
    case "title":
      return draft.title;
    case "shows":
      return `${draft.sectionType}\n${stableJson(draft.config)}`;
    case "itemLimit":
      return String(draft.itemLimit);
    case "hero":
      return String(draft.hero);
  }
}

function changedFields(a: RowDraft, b: RowDraft): DraftField[] {
  return DRAFT_FIELDS.filter((field) => fieldValue(a, field) !== fieldValue(b, field));
}

function copyField(target: RowDraft, source: RowDraft, field: DraftField): RowDraft {
  switch (field) {
    case "title":
      return { ...target, title: source.title, titleFollowsVariant: source.titleFollowsVariant };
    case "shows":
      return { ...target, sectionType: source.sectionType, config: source.config };
    case "itemLimit":
      return { ...target, itemLimit: source.itemLimit };
    case "hero":
      return { ...target, hero: source.hero };
  }
}

/**
 * After a save is refused because the row changed elsewhere: every field the
 * user changed keeps their value, every other field takes the row's new
 * value. `changedUpstream` names what changed elsewhere, including fields
 * where the user's value won.
 */
export function mergeReloadedDraft(
  original: RowDraft,
  edited: RowDraft,
  upstream: RowDraft,
): { draft: RowDraft; changedUpstream: DraftField[] } {
  const userChanged = new Set(changedFields(original, edited));
  const draft = DRAFT_FIELDS.reduce(
    (next, field) => (userChanged.has(field) ? next : copyField(next, upstream, field)),
    edited,
  );
  return { draft, changedUpstream: changedFields(original, upstream) };
}
