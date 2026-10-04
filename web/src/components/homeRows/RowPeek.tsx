import { useState, type Ref } from "react";
import { usePeek } from "@/hooks/queries/homeRows/usePeek";
import { useIntersectionObserver } from "@/hooks/useIntersectionObserver";
import { rowKindGroup } from "@/lib/homeRows/catalog";
import type { PeekRequest } from "@/lib/homeRows/peek";
import { cn } from "@/lib/utils";
import { PosterArt } from "./PosterTile";
import { GROUP_ICONS } from "./rowIcons";

/** Fanned like the row on Home; the third poster drops on phones. */
const POSITIONS = ["left-0", "left-[21px]", "left-[42px] max-sm:hidden"];

function IconTile({ sectionType, ref }: { sectionType: string; ref?: Ref<HTMLDivElement> }) {
  const Icon = GROUP_ICONS[rowKindGroup(sectionType)];
  return (
    <div
      ref={ref}
      aria-hidden
      className="bg-accent/80 text-muted-foreground ring-border grid h-[50px] w-12 place-items-center rounded-xl ring-1 ring-inset sm:w-[74px]"
    >
      <Icon className="size-5" />
    </div>
  );
}

function Posters({ sectionType, request }: { sectionType: string; request: PeekRequest }) {
  const [seen, setSeen] = useState(false);
  const observe = useIntersectionObserver({
    onIntersect: () => setSeen(true),
    enabled: !seen,
    rootMargin: "200px",
  });
  const items = usePeek(request, seen);
  if (items.length === 0) return <IconTile ref={observe} sectionType={sectionType} />;
  return (
    <div aria-hidden className="relative h-[42px] w-12 sm:h-[50px] sm:w-[74px]">
      {items.slice(0, POSITIONS.length).map((item, index) => (
        <PosterArt
          key={item.id}
          posterUrl={item.posterUrl}
          thumbhash={item.thumbhash}
          className={cn(
            "ring-surface absolute top-px h-10 w-[27px] rounded-[5px] shadow-[0_6px_12px_-6px_rgb(0_0_0/0.9)] ring-2 sm:top-0.5 sm:h-[46px] sm:w-8 sm:rounded-md",
            POSITIONS[index],
          )}
        />
      ))}
    </div>
  );
}

/**
 * The art at the start of a row: its first titles' posters once the row has
 * reached the screen, or the icon of its picker group while they load and
 * when there are none to show (no peek on this surface, an error, an empty row).
 */
export function RowPeek({
  sectionType,
  request,
}: {
  sectionType: string;
  request: PeekRequest | null;
}) {
  return request ? (
    <Posters sectionType={sectionType} request={request} />
  ) : (
    <IconTile sectionType={sectionType} />
  );
}
