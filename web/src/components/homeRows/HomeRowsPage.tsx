import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { ArrowDownToLine, ArrowUpToLine, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { describeRow, type DescribeContext } from "@/lib/homeRows/describe";
import { pageLabel } from "@/lib/homeRows/pages";
import type { HomeRow, HomeRowsAdapter } from "@/lib/homeRows/types";
import { cn } from "@/lib/utils";
import { MobileDockBar } from "./MobileDockBar";
import { ConflictBanner, LibraryPageNote, ReorderHint } from "./notes";
import { PageMoreMenu, type PageMoreMenuItem } from "./PageMoreMenu";
import { PageSwitcher } from "./PageSwitcher";
import { RowLine } from "./RowLine";
import { RowList } from "./RowList";
import { RowMenu, type RowMenuItem } from "./RowMenu";
import { SelectAllHeader } from "./SelectModeBar";
import type { RowFocus } from "./useRowFocus";

/** Select mode. While it is on, rows carry checkboxes instead of grips and cannot be dragged. */
export interface HomeRowsSelection {
  selectedIds: ReadonlySet<string>;
  onChange: (rowId: string, checked: boolean, extendRange: boolean) => void;
  onSelectAll: (checked: boolean) => void;
  /** Leaves select mode (Done or Escape). */
  onExit: () => void;
  label: (row: HomeRow) => string;
  /** The floating bar with what to do to the selected rows. */
  bar: ReactNode;
}

/** Under this width the page's buttons move to a bar docked at the bottom. */
const NARROW_QUERY = "(max-width: 1023px)";

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
  moreItems,
  onMoreOpenChange,
  addRow,
  notices,
  rowMenuItems,
  onOpenRow,
  collection,
  selection,
  focus,
  highlightRowId,
  children,
}: {
  adapter: HomeRowsAdapter;
  title: string;
  subtitle: string;
  /** The More menu's items. */
  moreItems: PageMoreMenuItem[];
  /** The More menu opened or closed, for items that read their state while it is open. */
  onMoreOpenChange?: (open: boolean) => void;
  addRow: { onClick: () => void; disabled?: boolean };
  notices?: ReactNode;
  rowMenuItems: (row: HomeRow, shared: SharedRowMenuItems) => RowMenuItem[];
  onOpenRow?: (row: HomeRow) => void;
  collection?: DescribeContext["collection"];
  /** Present while select mode is on. */
  selection?: HomeRowsSelection;
  focus: RowFocus;
  /** A row just added: scrolled into view and briefly highlighted. */
  highlightRowId?: string | null;
  children?: ReactNode;
}) {
  const dragging = useRef(false);
  const list = useRef<HTMLDivElement>(null);
  const narrow = useMediaQuery(NARROW_QUERY);
  const moreTrigger = useRef<HTMLButtonElement>(null);
  const selectAll = useRef<HTMLButtonElement>(null);
  const selectMode = selection !== undefined;
  const wasSelectMode = useRef(selectMode);

  // Entering select mode puts focus on Select all; leaving it, on More, since
  // the Done button or checkbox that had focus is gone.
  useEffect(() => {
    if (wasSelectMode.current === selectMode) return;
    wasSelectMode.current = selectMode;
    (selectMode ? selectAll : moreTrigger).current?.focus();
  }, [selectMode]);
  const highlightShown = Boolean(
    highlightRowId && adapter.rows.some((row) => row.id === highlightRowId),
  );

  useEffect(() => {
    if (!highlightShown || !highlightRowId) return;
    list.current
      ?.querySelector(`[data-row-id=${JSON.stringify(highlightRowId)}]`)
      ?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [highlightRowId, highlightShown]);
  const { rows, surface, page } = adapter;
  const label = pageLabel(page, adapter.pages);
  const shownCount = rows.filter((row) => row.shown).length;
  const summary =
    adapter.status === "ready"
      ? `${rows.length} ${rows.length === 1 ? "row" : "rows"} · ${shownCount} ${surface === "admin" ? "on" : "shown"}`
      : undefined;
  const describeContext: DescribeContext = { pageKind: page.kind, surface, collection };

  function move(row: HomeRow, to: "top" | "bottom") {
    const others = rows.map((entry) => entry.id).filter((id) => id !== row.id);
    void adapter.reorder(
      to === "top" ? [row.id, ...others] : [...others, row.id],
      undefined,
      row.id,
    );
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

  // Escape leaves select mode, but only for keys pressed inside the list or
  // its bar: menus and dialogs render in portals outside them, and an Escape
  // that cancels a keyboard drag must not also leave select mode.
  function handleListKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (
      event.key !== "Escape" ||
      event.defaultPrevented ||
      dragging.current ||
      !selection ||
      !event.currentTarget.contains(event.target as Node)
    )
      return;
    selection.onExit();
  }

  const { attachAddButton } = focus;
  const selectedCount = rows.filter((row) => selection?.selectedIds.has(row.id)).length;
  const more = (
    <PageMoreMenu
      items={moreItems}
      compact={narrow}
      triggerRef={moreTrigger}
      onOpenChange={onMoreOpenChange}
    />
  );
  const addButton = (
    <Button
      ref={attachAddButton}
      size={narrow ? "lg" : "sm"}
      disabled={addRow.disabled}
      onClick={addRow.onClick}
      className={cn(narrow && "h-12 rounded-[14px] text-[15px]")}
    >
      <Plus /> Add row
    </Button>
  );

  return (
    <div className={cn("mx-auto grid max-w-[1000px] gap-7", (narrow || selectMode) && "pb-24")}>
      <header className="page-header gap-5">
        {surface === "admin" ? (
          <div className="space-y-3">
            <h1 className="page-title text-[clamp(2rem,4vw,3rem)]">{title}</h1>
            <p className="page-subtitle max-w-[76ch] text-sm sm:text-base">{subtitle}</p>
          </div>
        ) : (
          // Settings > Home Screen sits under the Settings page's own heading.
          <div className="space-y-3">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
            <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">{subtitle}</p>
          </div>
        )}
        {narrow ? null : (
          // Stays at the right when the header wraps, so More's menu opens over the list.
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {more}
            {addButton}
          </div>
        )}
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
        <div className="grid gap-4" onKeyDown={handleListKeyDown}>
          <div ref={list} className="surface-panel rounded-[26px] p-1.5">
            {selection ? (
              <SelectAllHeader
                ref={selectAll}
                rowCount={rows.length}
                selectedCount={selectedCount}
                onSelectAll={selection.onSelectAll}
                onDone={selection.onExit}
              />
            ) : null}
            {rows.length === 0 ? (
              <p className="text-muted-foreground px-[18px] py-8 text-center text-sm">
                No rows on {label} yet.
              </p>
            ) : (
              <>
                <RowList
                  rows={rows}
                  canReorder={adapter.canReorder && !selectMode}
                  orderToken={adapter.orderToken}
                  label={`Rows on ${label}`}
                  onReorder={(ids, token, movedId) => void adapter.reorder(ids, token, movedId)}
                  onDragActiveChange={(active) => {
                    dragging.current = active;
                  }}
                >
                  {(row, sortable) => (
                    <RowLine
                      key={row.id}
                      {...sortable}
                      row={row}
                      highlighted={row.id === highlightRowId}
                      surface={surface}
                      pageLabel={label}
                      description={describeRow(row, describeContext)}
                      peek={adapter.peek?.(row) ?? null}
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
                {selectMode ? null : <ReorderHint />}
              </>
            )}
          </div>
          {selection?.bar}
        </div>
      )}
      {narrow && !selectMode ? <MobileDockBar more={more} addRow={addButton} /> : null}
      {children}
    </div>
  );
}
