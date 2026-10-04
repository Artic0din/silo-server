import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PreviewState } from "@/hooks/queries/homeRows/useRowPreview";
import type { RecipeCatalogResponse } from "@/lib/recipes";
import { savedTitle, withTitle, type RowDraft } from "@/lib/homeRows/rowDraft";
import { variantFamily } from "@/lib/homeRows/variants";
import { ParamFields, type ParamLibrary } from "./ParamFields";
import { MoreOptions } from "./MoreOptions";
import { RowPreview } from "./RowPreview";
import { ShowsSummary } from "./ShowsSummary";
import { VariantChoice } from "./VariantChoice";

export interface ShowsLine {
  label: string;
  sentence: string;
  onChange?: () => void;
}

/**
 * Step 2 and Edit row, top to bottom: the live preview, (Edit) what the row
 * shows, the one choice that matters, the row's name, then More options.
 */
export function RowForm({
  draft,
  onChange,
  catalog,
  preview,
  liveLabel,
  previewOffText,
  shows,
  variantLocked,
  libraries,
  onLibraryPage,
  onVariant,
}: {
  draft: RowDraft;
  onChange: (draft: RowDraft) => void;
  catalog: RecipeCatalogResponse | undefined;
  preview: PreviewState;
  liveLabel: string;
  previewOffText: string;
  /** Edit row only. */
  shows?: ShowsLine;
  /** No variant control: legacy Trakt rows and Continue Reading rows. */
  variantLocked: boolean;
  libraries: ParamLibrary[];
  onLibraryPage: boolean;
  onVariant: (presetKey: string) => void;
}) {
  const nameId = useId();
  const family = variantLocked ? undefined : variantFamily(draft.sectionType);
  const setConfig = (config: Record<string, unknown>) => onChange({ ...draft, config });
  const fieldProps = {
    sectionType: draft.sectionType,
    config: draft.config,
    onChange: setConfig,
    libraries,
    onLibraryPage,
  };
  return (
    <div className="grid gap-5">
      <RowPreview
        title={draft.title.trim() || savedTitle(draft, catalog)}
        sectionType={draft.sectionType}
        state={preview}
        liveLabel={liveLabel}
        offText={previewOffText}
      />
      {shows ? <ShowsSummary sectionType={draft.sectionType} {...shows} /> : null}
      {family ? (
        <VariantChoice sectionType={draft.sectionType} config={draft.config} onChange={onVariant} />
      ) : null}
      <ParamFields {...fieldProps} slot="primary" />
      <div className="grid gap-2">
        <Label htmlFor={nameId}>Row name</Label>
        <Input
          id={nameId}
          className="h-10 text-[15px]"
          value={draft.title}
          placeholder={savedTitle({ ...draft, title: "" }, catalog)}
          onChange={(event) => onChange(withTitle(draft, event.target.value))}
        />
        {family && draft.titleFollowsVariant ? (
          <p className="text-muted-foreground text-[13px]">
            Follows {family.follows} until you type your own name.
          </p>
        ) : null}
      </div>
      <MoreOptions
        itemLimit={draft.itemLimit}
        hero={draft.hero}
        onItemLimitChange={(itemLimit) => onChange({ ...draft, itemLimit })}
        onHeroChange={(hero) => onChange({ ...draft, hero })}
      >
        <ParamFields {...fieldProps} slot="more" />
      </MoreOptions>
    </div>
  );
}
