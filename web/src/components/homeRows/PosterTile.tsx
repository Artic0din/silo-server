import { decodeThumbhash } from "@/lib/thumbhash";
import { cn } from "@/lib/utils";

/**
 * One title's art in a preview strip. The admin preview sends only
 * thumbhashes today, so most tiles are blurred colour with the title on top;
 * once it sends poster URLs the same tile shows the poster.
 */
export function PosterTile({
  title,
  posterUrl,
  thumbhash,
  className,
}: {
  title: string;
  posterUrl?: string;
  thumbhash?: string;
  className?: string;
}) {
  let blur = "";
  try {
    blur = thumbhash ? decodeThumbhash(thumbhash) : "";
  } catch {
    // A malformed thumbhash falls back to the plain tile.
  }
  return (
    <figure
      className={cn(
        "bg-muted ring-border/60 relative aspect-[2/3] shrink-0 overflow-hidden rounded-[10px] bg-cover bg-center ring-1 ring-inset",
        className,
      )}
      style={blur ? { backgroundImage: `url(${blur})` } : undefined}
    >
      {posterUrl ? (
        <img
          src={posterUrl}
          alt=""
          loading="lazy"
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
      <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pt-6 pb-2 text-[11.5px] leading-tight font-semibold text-white">
        <span className="line-clamp-2">{title}</span>
      </figcaption>
    </figure>
  );
}
