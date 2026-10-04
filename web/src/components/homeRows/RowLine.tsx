import type { ButtonHTMLAttributes, CSSProperties, ReactNode, Ref } from "react";
import { EyeOff, GripVertical, Star } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  collapsedRowText,
  rowSwitchLabel,
  titleCount,
  type DescriptionPart,
} from "@/lib/homeRows/describe";
import type { PeekRequest } from "@/lib/homeRows/peek";
import type { HomeRow, Surface } from "@/lib/homeRows/types";
import { cn } from "@/lib/utils";
import { RowPeek } from "./RowPeek";
import { SelectCheckbox } from "./SelectCheckbox";

export interface RowSelection {
  selected: boolean;
  label: string;
  onChange: (checked: boolean, extendRange: boolean) => void;
}

export interface RowLineProps {
  row: HomeRow;
  surface: Surface;
  pageLabel: string;
  description: DescriptionPart[];
  /** Where the row's poster peek comes from; null keeps its icon. */
  peek: PeekRequest | null;
  /** Props for the grip button, from the sortable list. */
  handleProps: ButtonHTMLAttributes<HTMLButtonElement> & { ref?: Ref<HTMLButtonElement> };
  /** Select mode: a checkbox takes the grip's place. */
  selection?: RowSelection;
  switchDisabled?: boolean;
  onShownChange: (shown: boolean) => void;
  menu: ReactNode;
  /** A click on the row body opens it; keyboard users use the menu's Edit row…. */
  onOpen?: () => void;
  ref?: Ref<HTMLLIElement>;
  style?: CSSProperties;
  dragging?: boolean;
  /** Just added: a short highlight so the eye finds it. */
  highlighted?: boolean;
}

function Dot() {
  return (
    <span aria-hidden className="mx-[7px] inline-block opacity-55">
      ·
    </span>
  );
}

function Description({ parts }: { parts: DescriptionPart[] }) {
  return parts.map((part, index) =>
    typeof part === "string" ? (
      part
    ) : (
      <b key={index} className="text-foreground/75 font-medium">
        {part.strong}
      </b>
    ),
  );
}

/**
 * One row of the list: grip (checkbox in select mode), art, name and
 * sentence, switch, ⋯.
 *
 * Off (admin) and hidden (profile) rows collapse to a dashed line, but the
 * element at every position keeps its type and the switch keeps its key, so
 * toggling a row never moves keyboard focus off its switch.
 */
export function RowLine({
  row,
  surface,
  pageLabel,
  description,
  peek,
  handleProps,
  selection,
  switchDisabled,
  onShownChange,
  menu,
  onOpen,
  ref,
  style,
  dragging,
  highlighted,
}: RowLineProps) {
  const collapsed = !row.shown;
  const { ref: handleRef, className: handleClassName, ...handleRest } = handleProps;
  return (
    <li
      ref={ref}
      style={style}
      data-row-id={row.id}
      data-highlighted={highlighted || undefined}
      className={cn(
        "hover:bg-accent/60 relative grid items-center gap-2 rounded-[18px] py-[11px] pr-3 pl-2 sm:gap-3.5",
        "before:bg-border/75 before:absolute before:top-0 before:right-4 before:left-[124px] before:h-px first:before:hidden hover:before:hidden [&:hover+li]:before:hidden",
        // Under 1024px the ⋯ column widens to a 44px touch target.
        "grid-cols-[28px_48px_minmax(0,1fr)_auto_44px] sm:grid-cols-[28px_74px_minmax(0,1fr)_auto_44px] lg:grid-cols-[28px_74px_minmax(0,1fr)_auto_36px]",
        collapsed &&
          "border-muted-foreground/30 bg-background/40 my-1.5 border border-dashed py-[5px] before:hidden [&+li]:before:hidden",
        selection?.selected && "bg-accent/75",
        dragging && "bg-surface-raised z-10 shadow-lg",
        highlighted && "bg-accent ring-ring/60 ring-2 transition-[box-shadow,background-color]",
      )}
    >
      {selection ? (
        <span className={cn("grid w-7 place-items-center", collapsed ? "h-[30px]" : "h-9")}>
          <SelectCheckbox
            label={selection.label}
            checked={selection.selected}
            onChange={selection.onChange}
          />
        </span>
      ) : (
        <button
          ref={handleRef}
          type="button"
          aria-label={`Move ${row.title}`}
          className={cn(
            "text-muted-foreground/70 hover:text-foreground focus-visible:ring-ring/50 grid w-7 cursor-grab touch-none place-items-center rounded-lg outline-none focus-visible:ring-[3px] aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
            collapsed ? "h-[30px]" : "h-9",
            handleClassName,
          )}
          {...handleRest}
        >
          <GripVertical className="size-[18px]" />
        </button>
      )}
      {collapsed ? (
        <div
          aria-hidden
          className="text-muted-foreground grid h-[30px] w-12 place-items-center sm:w-[74px]"
        >
          <EyeOff className="size-[17px]" />
        </div>
      ) : (
        <RowPeek sectionType={row.sectionType} request={peek} />
      )}
      <div className={cn("min-w-0", onOpen && "cursor-pointer")} onClick={onOpen}>
        {collapsed ? (
          <p className="text-muted-foreground truncate text-[13.5px]">
            <b className="text-foreground/80 font-semibold">{row.title}</b>
            {collapsedRowText(surface, pageLabel)}
          </p>
        ) : (
          <>
            <div className="flex min-w-0 items-center gap-2 text-[15px] font-semibold tracking-[-0.01em]">
              <span className="truncate">{row.title}</span>
              {row.hero ? (
                <span className="bg-warning/15 text-warning ring-warning/30 inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full px-2 text-[11.5px] font-semibold ring-1 ring-inset max-sm:hidden">
                  <Star className="size-3" aria-hidden />
                  Hero banner
                </span>
              ) : null}
              {row.own ? (
                <span className="bg-info/15 text-info ring-info/30 inline-flex h-[22px] shrink-0 items-center rounded-full px-2 text-[11.5px] font-semibold ring-1 ring-inset">
                  Yours
                </span>
              ) : null}
            </div>
            <p className="text-muted-foreground mt-1 truncate text-[13px] leading-[1.45]">
              {row.hero ? (
                // Phones have no room for the tag next to the name.
                <span className="text-warning font-semibold sm:hidden">
                  <Star className="mr-1 inline size-3 align-[-1px]" aria-hidden />
                  Hero banner
                  <Dot />
                </span>
              ) : null}
              <Description parts={description} />
              <Dot />
              {titleCount(row.itemLimit)}
            </p>
          </>
        )}
      </div>
      <div className="flex items-center gap-3">
        <Switch
          key="shown"
          checked={row.shown}
          disabled={switchDisabled}
          // A 44px touch target under 1024px, without changing the layout.
          className="max-lg:relative max-lg:after:absolute max-lg:after:-inset-[13px] max-lg:after:content-['']"
          aria-label={rowSwitchLabel(surface, row, pageLabel)}
          onCheckedChange={(checked) => onShownChange(checked === true)}
        />
      </div>
      {menu}
    </li>
  );
}
