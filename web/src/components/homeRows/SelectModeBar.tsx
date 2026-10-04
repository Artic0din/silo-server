import type { Ref } from "react";
import { Eye, EyeOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SelectCheckbox } from "./SelectCheckbox";

/** The most rows one select-mode action works on, matching the server's bulk limits. */
export const MAX_SELECTED_ROWS = 100;

/**
 * The floating bar of select mode: how many rows are picked and what can be
 * done to them. Actions refuse more than 100 rows at a time.
 */
export function SelectModeBar({
  count,
  busy = false,
  onTurnOn,
  onTurnOff,
  onDelete,
}: {
  count: number;
  busy?: boolean;
  onTurnOn: () => void;
  onTurnOff: () => void;
  onDelete: () => void;
}) {
  const tooMany = count > MAX_SELECTED_ROWS;
  const disabled = busy || count === 0 || tooMany;
  return (
    <div
      role="toolbar"
      aria-label={`${count} ${count === 1 ? "row" : "rows"} selected`}
      className="bg-popover/95 border-border sticky bottom-4 z-20 flex max-w-full flex-wrap items-center justify-center gap-1 justify-self-center rounded-2xl border py-[7px] pr-[7px] pl-4 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.9)] backdrop-blur"
    >
      <span role="status" className="mr-2 text-sm font-semibold whitespace-nowrap">
        {count} selected
        {tooMany ? (
          <span className="text-warning ml-2 font-normal">
            Select up to {MAX_SELECTED_ROWS} rows at a time.
          </span>
        ) : null}
      </span>
      <Button variant="ghost" size="sm" disabled={disabled} onClick={onTurnOn}>
        <Eye />
        <span className="max-sm:sr-only">Turn on</span>
      </Button>
      <Button variant="ghost" size="sm" disabled={disabled} onClick={onTurnOff}>
        <EyeOff />
        <span className="max-sm:sr-only">Turn off</span>
      </Button>
      <span aria-hidden className="bg-border mx-1 h-[22px] w-px" />
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={onDelete}
        className="text-destructive hover:text-destructive [&_svg]:text-destructive"
      >
        <Trash2 />
        <span className="max-sm:sr-only">Delete…</span>
      </Button>
    </div>
  );
}

/** The top line of the list in select mode: Select all, the limit, and Done. */
export function SelectAllHeader({
  rowCount,
  selectedCount,
  onSelectAll,
  onDone,
  ref,
}: {
  rowCount: number;
  selectedCount: number;
  onSelectAll: (checked: boolean) => void;
  onDone: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  let checked: boolean | "indeterminate" = false;
  if (rowCount > 0 && selectedCount === rowCount) checked = true;
  else if (selectedCount > 0) checked = "indeterminate";
  return (
    <div className="border-border/75 mb-0.5 flex items-center gap-3 border-b py-2.5 pr-3.5 pl-2 text-[13.5px]">
      <span className="grid w-7 place-items-center">
        <SelectCheckbox
          ref={ref}
          label="Select all"
          disabled={rowCount === 0}
          checked={checked}
          onChange={onSelectAll}
        />
      </span>
      <span aria-hidden className="font-medium">
        Select all
      </span>
      <span className="text-muted-foreground text-[13px]">
        Up to {MAX_SELECTED_ROWS} rows at a time
      </span>
      <Button size="sm" variant="ghost" className="ml-auto" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}
