import { Fragment, useId, useRef, type Ref } from "react";
import { Ellipsis, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface PageMoreMenuItem {
  key: string;
  label: string;
  /** One line under the label saying what the action does. */
  help: string;
  icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  /** Starts a new group: a separator is drawn above it. */
  group?: boolean;
  /**
   * False when the action moves focus itself: it then runs once the menu has
   * closed (a menu holds focus while open), and focus does not go back to More.
   */
  returnFocus?: boolean;
}

function MenuItem({ item, onChosen }: { item: PageMoreMenuItem; onChosen: () => void }) {
  const id = useId();
  return (
    <DropdownMenuItem
      disabled={item.disabled}
      aria-labelledby={`${id}-label`}
      aria-describedby={`${id}-help`}
      onSelect={() => {
        onChosen();
        if (item.returnFocus !== false) item.onSelect();
      }}
      className="items-start gap-3 rounded-[9px] px-2.5 py-2.5"
    >
      <item.icon className="mt-0.5" />
      <span className="grid gap-0.5">
        <span id={`${id}-label`} className="font-medium">
          {item.label}
        </span>
        <span id={`${id}-help`} className="text-muted-foreground text-[12.5px] leading-snug">
          {item.help}
        </span>
      </span>
    </DropdownMenuItem>
  );
}

/**
 * The page's More menu: the actions a page needs now and then, each with a
 * line of help. `compact` is the square 48px trigger of the phone dock.
 */
export function PageMoreMenu({
  items,
  compact = false,
  triggerRef,
}: {
  items: PageMoreMenuItem[];
  compact?: boolean;
  triggerRef?: Ref<HTMLButtonElement>;
}) {
  const chosen = useRef<PageMoreMenuItem | null>(null);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          size={compact ? "icon" : "sm"}
          aria-label={compact ? "More" : undefined}
          className={cn(
            "data-[state=open]:bg-accent",
            compact && "bg-surface/90 size-12 rounded-[14px]",
          )}
        >
          <Ellipsis className={compact ? "size-5" : undefined} />
          {compact ? null : "More"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        // The dock's More sits at the left edge, the header's at the right.
        align={compact ? "start" : "end"}
        side={compact ? "top" : "bottom"}
        className="w-[min(356px,calc(100vw-2rem))] rounded-[14px] p-1.5"
        onCloseAutoFocus={(event) => {
          const item = chosen.current;
          chosen.current = null;
          if (item?.returnFocus !== false) return;
          event.preventDefault();
          item.onSelect();
        }}
      >
        {items.map((item, index) => (
          <Fragment key={item.key}>
            {item.group && index > 0 ? <DropdownMenuSeparator /> : null}
            <MenuItem
              item={item}
              onChosen={() => {
                chosen.current = item;
              }}
            />
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
