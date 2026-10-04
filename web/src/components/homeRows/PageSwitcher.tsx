import { Fragment } from "react";
import { House } from "lucide-react";
import { pageParam, samePage } from "@/lib/homeRows/pages";
import type { HomeRowsPageOption, PageRef } from "@/lib/homeRows/types";
import { cn } from "@/lib/utils";

/**
 * Pills for Home and each library page, with the page's row count on the
 * right. On phones the pills take the whole width and scroll, and the count
 * drops to the line below.
 */
export function PageSwitcher({
  pages,
  value,
  onChange,
  disabled,
  summary,
}: {
  pages: HomeRowsPageOption[];
  value: PageRef;
  onChange: (ref: PageRef) => void;
  disabled?: boolean;
  summary?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <div
        role="group"
        aria-label="Page"
        className="-mx-1 flex min-w-0 flex-1 items-center gap-2 overflow-x-auto px-1 py-1 max-sm:basis-full"
      >
        {pages.map((page, index) => {
          const pressed = samePage(page.ref, value);
          return (
            <Fragment key={pageParam(page.ref)}>
              {index === 1 ? (
                <span aria-hidden className="bg-border mx-1.5 h-5 w-px shrink-0" />
              ) : null}
              <button
                type="button"
                aria-pressed={pressed}
                disabled={disabled}
                onClick={() => {
                  if (!pressed) onChange(page.ref);
                }}
                className={cn(
                  "focus-visible:ring-ring/50 inline-flex h-[34px] shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-60",
                  pressed
                    ? "bg-primary text-primary-foreground border-transparent shadow-sm"
                    : "border-border text-foreground/80 hover:bg-accent",
                )}
              >
                {page.ref.kind === "home" ? (
                  <House aria-hidden className="size-[15px] opacity-80" />
                ) : null}
                {page.label}
              </button>
            </Fragment>
          );
        })}
      </div>
      {summary ? (
        <p className="text-muted-foreground shrink-0 text-[13px] whitespace-nowrap">{summary}</p>
      ) : null}
    </div>
  );
}
