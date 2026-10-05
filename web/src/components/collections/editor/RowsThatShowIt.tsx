import { useId, type ReactNode } from "react";
import { Link } from "react-router";
import { ArrowUpRight } from "lucide-react";

import { CollectionRowSummary } from "@/components/collections/CollectionRowSummary";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  NO_ROWS_YET,
  ROWS_FAILED,
  ROWS_NOT_LISTED,
  ROWS_THAT_SHOW_IT,
  rowCountLabel,
} from "@/lib/collections/copy";
import { openRowPath, rowMeta, type RowsState } from "@/lib/collections/rows";
import { cn } from "@/lib/utils";

/** The heading, the rows (or their loading and error states) and the note under them. */
function RowsList({
  headingId,
  rows,
  libraryNames,
  highlightId,
}: {
  headingId: string;
  rows: RowsState;
  libraryNames: ReadonlyMap<number, string>;
  highlightId?: string | null;
}) {
  const listed = rows.status === "ready" ? rows.rows : null;
  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={headingId} className="text-[13.5px] font-semibold">
          {ROWS_THAT_SHOW_IT}
        </h3>
        {listed && listed.length > 0 ? (
          <span className="text-muted-foreground text-[12.5px]">
            {rowCountLabel(listed.length)}
          </span>
        ) : null}
      </div>
      {rows.status === "loading" ? (
        <div className="grid gap-1.5" aria-hidden>
          <Skeleton className="h-12 rounded-xl" />
          <Skeleton className="h-12 rounded-xl" />
        </div>
      ) : null}
      {rows.status === "error" ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-[13px]">
          <span className="text-muted-foreground">{ROWS_FAILED}</span>
          <Button variant="outline" size="sm" onClick={rows.onRetry}>
            Retry
          </Button>
        </div>
      ) : null}
      {listed && listed.length === 0 ? (
        <p className="text-muted-foreground text-[13px]">{NO_ROWS_YET}</p>
      ) : null}
      {listed && listed.length > 0 ? (
        <ul className="border-border/80 divide-border/70 grid divide-y overflow-hidden rounded-xl border">
          {listed.map((row) => {
            const meta = rowMeta(row, libraryNames);
            const fresh = row.id === highlightId;
            return (
              <li key={row.id} data-highlighted={fresh || undefined}>
                <Link
                  to={openRowPath(row)}
                  aria-label={`${row.title}, ${meta}`}
                  className={cn(
                    "hover:bg-accent/40 focus-visible:ring-ring/50 flex items-center gap-3 px-3 py-2.5 outline-none focus-visible:ring-[3px] focus-visible:ring-inset",
                    fresh && "bg-emerald-500/10 ring-1 ring-emerald-500/50 ring-inset",
                    !row.enabled && "opacity-70",
                  )}
                >
                  <CollectionRowSummary row={row} libraryNames={libraryNames} />
                  <ArrowUpRight aria-hidden className="text-muted-foreground size-4 shrink-0" />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
      <p className="text-muted-foreground text-[12.5px]">{ROWS_NOT_LISTED}</p>
    </>
  );
}

/**
 * The admin Home and library page rows that show a server collection, styled
 * like Home rows: a house for Home, a library for a library page, each a link
 * that opens the row in Home rows. `rows` is null when the server doesn't
 * report them; the Add as a row menu (`children`) shows either way, and stays
 * mounted while the rows load.
 */
export function RowsThatShowIt({
  rows,
  libraryNames,
  highlightId,
  children,
}: {
  rows: RowsState | null;
  libraryNames: ReadonlyMap<number, string>;
  /** A row just added from here, highlighted for a moment. */
  highlightId?: string | null;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <div
      className="grid gap-2.5"
      role={rows ? "group" : undefined}
      aria-labelledby={rows ? headingId : undefined}
    >
      {rows ? (
        <RowsList
          headingId={headingId}
          rows={rows}
          libraryNames={libraryNames}
          highlightId={highlightId}
        />
      ) : null}
      {children}
    </div>
  );
}
