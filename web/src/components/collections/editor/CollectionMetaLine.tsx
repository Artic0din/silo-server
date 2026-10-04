import { MetaDot } from "@/components/calm/ListRow";
import { cn } from "@/lib/utils";

/** A sync state worth showing: a list that failed, or one syncing now. */
export interface SyncAttention {
  label: string;
  tone: "failed" | "syncing";
  /** The server's message, as a tooltip. */
  message?: string;
}

/**
 * "Movies, Kids · 23 titles" under a collection's name, or "Manual · 23
 * titles" on a card. Sync status is added at the end only when it needs
 * attention.
 */
export function CollectionMetaLine({
  typeLabel,
  libraryNames,
  itemCount,
  attention,
  className,
}: {
  typeLabel?: string;
  libraryNames?: readonly string[];
  itemCount: number;
  attention?: SyncAttention;
  className?: string;
}) {
  return (
    <p className={cn("text-muted-foreground text-[14px]", className)}>
      {libraryNames && libraryNames.length > 0 ? (
        <>
          <b className="text-foreground font-semibold">{libraryNames.join(", ")}</b>
          <MetaDot />
        </>
      ) : null}
      {[typeLabel, `${itemCount} title${itemCount === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
      {attention ? (
        <>
          {" · "}
          <span
            title={attention.message || undefined}
            className={cn(attention.tone === "failed" && "text-destructive font-medium")}
          >
            {attention.label}
          </span>
        </>
      ) : null}
    </p>
  );
}
