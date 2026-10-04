import { Flame, Heart, Layers, Palette, Play, Sparkles, type LucideIcon } from "lucide-react";
import { rowKindGroup, type RowGroup } from "@/lib/homeRows/catalog";

const GROUP_ICONS: Record<RowGroup, LucideIcon> = {
  keep: Play,
  new: Sparkles,
  popular: Flame,
  picked: Heart,
  moods: Palette,
  collections: Layers,
};

/**
 * The art at the start of a row. Until poster peeks load, every row shows the
 * icon of its picker group, which is also the fallback when a peek has no art.
 */
export function RowPeek({ sectionType }: { sectionType: string }) {
  const Icon = GROUP_ICONS[rowKindGroup(sectionType)];
  return (
    <div
      aria-hidden
      data-testid="row-peek"
      className="bg-accent/80 text-muted-foreground ring-border grid h-[50px] w-[74px] place-items-center rounded-xl ring-1 ring-inset"
    >
      <Icon className="size-5" />
    </div>
  );
}
