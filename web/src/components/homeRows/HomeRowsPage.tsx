import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { ArrowDownToLine, ArrowUpToLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { describeRow, type DescribeContext } from "@/lib/homeRows/describe";
import { pageLabel } from "@/lib/homeRows/pages";
import type { HomeRow, HomeRowsAdapter } from "@/lib/homeRows/types";
import { ConflictBanner, LibraryPageNote, ReorderHint } from "./notes";
import { PageSwitcher } from "./PageSwitcher";
import { RowLine } from "./RowLine";
import { RowList } from "./RowList";
import { RowMenu, type RowMenuItem } from "./RowMenu";
import type { RowFocus } from "./useRowFocus";

export interface HomeRowsSelection {
  selectedIds: ReadonlySet<string>;
  onChange: (rowId: string, checked: boolean, extendRange: boolean) => void;
  onClear: () => void;
  label: (row: HomeRow) => string;
}

/** Menu items every surface offers; the surface decides where they go. */
export interface SharedRowMenuItems {
  moveToTop: RowMenuItem;
  moveToBottom: RowMenuItem;
}

/**
 * The Home rows page shell shared by admin Home rows and Settings > Home
 * Screen. Everything surface-specific comes from the adapter and the props;
 * nothing here reads the account role.
 */
export function HomeRowsPage({
  adapter,
  title,
  subtitle,
  actions,
  notices,
  rowMenuItems,
  onOpenRow,
  collectionTitle,
  selection,
  focus,
  children,
}: {
  adapter: HomeRowsAdapter;
  title: string;
  subtitle: string;
  actions?: ReactNode;
  notices?: ReactNode;
  rowMenuItems: (row: HomeRow, shared: SharedRowMenuItems) => RowMenuItem[];
  onOpenRow?: (row: HomeRow) => void;
  collectionTitle?: DescribeContext["collectionTitle"];
  selection?: HomeRowsSelection;
  focus: RowFocus;
  children?: ReactNode;
}) {
  const dragging = useRef(false);
  const { rows, surface, page } = adapter;
  const label = pageLabel(page, adapter.pages);
  const shownCount = rows.filter((row) => row.shown).length;
  const summary =
    adapter.status === "ready"
      ? `${rows.length} ${rows.length === 1 ? "row" : "rows"} · ${shownCount} ${surface === "admin" ? "on" : "shown"}`
      : undefined;
  const describeContext: DescribeContext = { pageKind: page.kind, collectionTitle };

  function move(row: HomeRow, to: "top" | "bottom") {
    const others = rows.map((entry) => entry.id).filter((id) => id !== row.id);
    void adapter.reorder(to === "top" ? [row.id, ...others] : [...others, row.id]);
    focus.afterMove(row.id);
  }

  function sharedItems(row: HomeRow, index: number): SharedRowMenuItems {
    return {
      moveToTop: {
        key: "move-top",
        label: "Move to top",
        icon: ArrowUpToLine,
        group: true,
        disabled: !adapter.canReorder || index === 0,
        onSelect: () => move(row, "top"),
      },
      moveToBottom: {
        key: "move-bottom",
        label: "Move to bottom",
        icon: ArrowDownToLine,
        disabled: !adapter.canReorder || index === rows.length - 1,
        onSelect: () => move(row, "bottom"),
      },
    };
  }

  // Escape clears the selection, but only for keys pressed inside the list
  // itself: menus and dialogs render in portals outside it, and an Escape
  // that cancels a keyboard drag must not also drop the selection.
  function handleListKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (
      event.key !== "Escape" ||
      event.defaultPrevented ||
      dragging.current ||
      !selection ||
      selection.selectedIds.size === 0 ||
      !event.currentTarget.contains(event.target as Node)
    )
      return;
    selection.onClear();
  }

  return (
    <div className="mx-auto grid max-w-[1000px] gap-7">
      <header className="page-header gap-5">
        <div className="space-y-3">
          <h1 className="page-title text-[clamp(2rem,4vw,3rem)]">{title}</h1>
          <p className="page-subtitle max-w-[76ch] text-sm sm:text-base">{subtitle}</p>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </header>

      {notices}

      <PageSwitcher
        pages={adapter.pages}
        value={page}
        onChange={adapter.setPage}
        disabled={adapter.pending}
        summary={summary}
      />
      {page.kind === "library" ? <LibraryPageNote libraryName={label} /> : null}
      {adapter.conflict ? (
        <ConflictBanner busy={adapter.pending} onReload={() => void adapter.reload()} />
      ) : null}

      {adapter.status === "error" ? (
        <div role="alert" className="surface-panel space-y-3 rounded-2xl p-6">
          <p>{adapter.error ?? "Could not load these rows."}</p>
          <Button variant="outline" onClick={() => void adapter.reload()}>
            Reload rows
          </Button>
        </div>
      ) : adapter.status === "loading" ? (
        <p role="status" className="text-muted-foreground px-1 text-sm">
          Loading rows…
        </p>
      ) : (
        <section
          aria-label={`Rows on ${label}`}
          className="surface-panel rounded-[26px] p-1.5"
          onKeyDown={handleListKeyDown}
        >
          {rows.length === 0 ? (
            <p className="text-muted-foreground px-[18px] py-8 text-center text-sm">
              No rows on {label} yet.
            </p>
          ) : (
            <>
              <RowList
                rows={rows}
                canReorder={adapter.canReorder}
                orderToken={adapter.orderToken}
                label={`Rows on ${label}`}
                onReorder={(ids, token) => void adapter.reorder(ids, token)}
                onDragActiveChange={(active) => {
                  dragging.current = active;
                }}
              >
                {(row, sortable) => (
                  <RowLine
                    key={row.id}
                    {...sortable}
                    row={row}
                    surface={surface}
                    pageLabel={label}
                    description={describeRow(row, describeContext)}
                    selection={
                      selection
                        ? {
                            selected: selection.selectedIds.has(row.id),
                            label: selection.label(row),
                            onChange: (checked, extend) =>
                              selection.onChange(row.id, checked, extend),
                          }
                        : undefined
                    }
                    switchDisabled={!adapter.canEdit || (row.legacyTrakt && !row.shown)}
                    onShownChange={(shown) => void adapter.setShown(row.id, shown)}
                    onOpen={onOpenRow ? () => onOpenRow(row) : undefined}
                    menu={
                      <RowMenu
                        rowTitle={row.title}
                        triggerRef={focus.attachMenuTrigger(row.id)}
                        items={rowMenuItems(row, sharedItems(row, rows.indexOf(row)))}
                      />
                    }
                  />
                )}
              </RowList>
              <ReorderHint />
            </>
          )}
        </section>
      )}
      {children}
    </div>
  );
}
