/**
 * The override set a profile saves for one page (`PUT /api/v2/profile/sections`)
 * and the page state it is built from. Pure, so the Home Screen hook and every
 * test build it the same way.
 */
import type { SectionOverride, SettingsSectionEntry } from "@/api/types";
import { V2ProblemError } from "@/api/v2/request";
import { isTraktConfig } from "@/lib/sectionTypes";
import { randomUUID } from "@/lib/uuid";

export interface RemovedSystemOverride {
  id: string;
}

export interface SectionOverrideIds {
  /** The profile's saved overrides for the page. */
  savedOverrides?: SectionOverride[];
  /** An ID for an admin section the profile has no saved override for. */
  newId?: (sectionId: string) => string;
  /** The section the change being saved is to, if it is to one section. */
  changedSectionId?: string;
  /** Every section the changes being saved are to, when several are saved at once. */
  changedSectionIds?: ReadonlySet<string>;
}

/**
 * The override set to save for one page. A change to an admin section keeps
 * the ID of the profile's saved override for that section, or gets one from
 * `newId`: the server's section source policy refuses a legacy Trakt admin
 * section's override without an ID. It also refuses a new override that
 * leaves such a section showing, so a shown one without a saved override is
 * left out and keeps its admin position, unless a change being saved is to
 * that section; the refusal then reaches the user instead of the change
 * silently not saving. Positions are only as close to the list order as that
 * held position allows.
 */
export function buildSectionOverrides(
  sections: SettingsSectionEntry[],
  removedSystemSections: RemovedSystemOverride[] = [],
  {
    savedOverrides = [],
    newId = () => randomUUID(),
    changedSectionId,
    changedSectionIds,
  }: SectionOverrideIds = {},
): SectionOverride[] {
  // The server resolves the last saved override for a section.
  const savedIds = new Map<string, string>();
  for (const override of savedOverrides) {
    if (override.section_id && override.id) savedIds.set(override.section_id, override.id);
  }
  const changed = (id: string) => id === changedSectionId || Boolean(changedSectionIds?.has(id));
  const leftOut = (s: SettingsSectionEntry) =>
    !s.is_custom && !s.hidden && !savedIds.has(s.id) && !changed(s.id) && isTraktConfig(s.config);
  // A section left out keeps its admin position, so the others are numbered
  // in list order around it and never on it: the server orders sections with
  // equal positions arbitrarily.
  const heldPositions = new Set(sections.filter(leftOut).map((s) => s.position));
  const overrides: SectionOverride[] = [];
  let position = 0;
  for (const s of sections) {
    if (leftOut(s)) {
      position = Math.max(position, s.position + 1);
      continue;
    }
    while (heldPositions.has(position)) position += 1;
    overrides.push({
      section_id: s.is_custom ? undefined : s.id,
      id: s.is_custom ? s.id : (savedIds.get(s.id) ?? newId(s.id)),
      position: position++,
      hidden: s.hidden,
      title: s.title,
      featured: s.featured,
      item_limit: s.item_limit,
      section_type: s.is_custom ? s.section_type : undefined,
      config: s.config,
    });
  }
  for (const section of removedSystemSections) {
    overrides.push({
      section_id: section.id,
      id: savedIds.get(section.id) ?? newId(section.id),
      removed: true,
    });
  }
  return overrides;
}

/**
 * Gives each admin section one new override ID and returns the same one on
 * later calls, so a quick second save on a page reuses the IDs of the first
 * before the saved overrides refetch.
 */
export function createOverrideIdSource(): (sectionId: string) => string {
  const ids = new Map<string, string>();
  return (sectionId) => {
    const id = ids.get(sectionId) ?? randomUUID();
    ids.set(sectionId, id);
    return id;
  };
}

export function applySectionDeletion(
  sections: SettingsSectionEntry[],
  removedSystemSections: RemovedSystemOverride[],
  id: string,
): { sections: SettingsSectionEntry[]; removedSystemSections: RemovedSystemOverride[] } {
  const target = sections.find((section) => section.id === id);
  if (!target) {
    return { sections, removedSystemSections };
  }

  const nextSections = sections.filter((section) => section.id !== id);
  if (target.is_custom) {
    return { sections: nextSections, removedSystemSections };
  }

  if (removedSystemSections.some((section) => section.id === id)) {
    return { sections: nextSections, removedSystemSections };
  }

  return {
    sections: nextSections,
    removedSystemSections: [...removedSystemSections, { id }],
  };
}

export function hydrateRemovedSystemSections(
  overrides: SectionOverride[] = [],
): RemovedSystemOverride[] {
  return Array.from(
    new Set(
      overrides
        .filter((override) => override.removed && Boolean(override.section_id))
        .map((override) => override.section_id as string),
    ),
  ).map((id) => ({ id }));
}

interface ReadyQueryState {
  isSuccess: boolean;
  isError: boolean;
}

export function canMutateSectionSettings(
  settingsQuery?: ReadyQueryState,
  rawOverridesQuery?: ReadyQueryState,
): boolean {
  return Boolean(
    settingsQuery?.isSuccess &&
    !settingsQuery.isError &&
    rawOverridesQuery?.isSuccess &&
    !rawOverridesQuery.isError,
  );
}

export function shouldRestoreSelectionState(
  currentSelectionValue: string,
  selectionValueAtSave: string,
): boolean {
  return currentSelectionValue === selectionValueAtSave;
}

export function shouldRestoreLatestSaveFailure(
  currentSelectionValue: string,
  selectionValueAtSave: string,
  latestAttemptId: number,
  failedAttemptId: number,
): boolean {
  return (
    shouldRestoreSelectionState(currentSelectionValue, selectionValueAtSave) &&
    latestAttemptId === failedAttemptId
  );
}

/**
 * A permission denial carries its cause in the detail: the custom-sections
 * refusal and the demo-mode gate both answer 403 permission_denied.
 */
export function sectionSaveErrorMessage(error: unknown): string {
  const detail =
    error instanceof V2ProblemError && error.problemType === "permission_denied"
      ? error.problem.detail?.trim()
      : undefined;
  return detail ? `Failed to save section changes: ${detail}` : "Failed to save section changes";
}
