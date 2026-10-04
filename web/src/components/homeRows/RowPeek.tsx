import { rowKindGroup } from "@/lib/homeRows/catalog";
import { GROUP_ICONS } from "./rowIcons";

/**
 * The art at the start of a row. Until poster peeks load, every row shows the
 * icon of its picker group, which is also the fallback when a peek has no art.
 */
export function RowPeek({ sectionType }: { sectionType: string }) {
  const Icon = GROUP_ICONS[rowKindGroup(sectionType)];
  return (
    <div
      aria-hidden
      className="bg-accent/80 text-muted-foreground ring-border grid h-[50px] w-12 place-items-center rounded-xl ring-1 ring-inset sm:w-[74px]"
    >
      <Icon className="size-5" />
    </div>
  );
}
