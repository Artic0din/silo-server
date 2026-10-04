import { Fragment, useId, type Ref } from "react";
import { Ellipsis, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface ActionMenuEntry {
  key: string;
  label: string;
  icon: LucideIcon;
  /** One line under the label saying what the item does. */
  help?: string;
  disabled?: boolean;
  /** Starts a new group: a separator is drawn above it. */
  group?: boolean;
}

export interface ActionMenuAction extends ActionMenuEntry {
  onSelect: () => void;
  destructive?: boolean;
}

/** An item that opens a submenu (→ from the keyboard). */
export interface ActionMenuSubmenu extends ActionMenuEntry {
  items: ActionMenuAction[];
}

export type ActionMenuItem = ActionMenuAction | ActionMenuSubmenu;

const ITEM_CLASS = "gap-2.5 rounded-[9px] px-2.5 py-2";

function ItemBody({ id, item }: { id: string; item: ActionMenuEntry }) {
  if (!item.help)
    return (
      <>
        <item.icon />
        {item.label}
      </>
    );
  return (
    <>
      <item.icon className="text-muted-foreground mt-0.5" />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span id={`${id}-label`} className="font-medium">
          {item.label}
        </span>
        <span id={`${id}-help`} className="text-muted-foreground text-[12.5px] leading-snug">
          {item.help}
        </span>
      </span>
    </>
  );
}

/** An item with help is named by its label alone and described by the help. */
function helpAria(id: string, item: ActionMenuEntry) {
  return item.help ? { "aria-labelledby": `${id}-label`, "aria-describedby": `${id}-help` } : {};
}

function Action({ item }: { item: ActionMenuAction }) {
  const id = useId();
  return (
    <DropdownMenuItem
      variant={item.destructive ? "destructive" : "default"}
      disabled={item.disabled}
      onSelect={item.onSelect}
      {...helpAria(id, item)}
      className={cn(ITEM_CLASS, item.help && "items-start")}
    >
      <ItemBody id={id} item={item} />
    </DropdownMenuItem>
  );
}

function Submenu({ item }: { item: ActionMenuSubmenu }) {
  const id = useId();
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        disabled={item.disabled}
        {...helpAria(id, item)}
        className={cn(ITEM_CLASS, item.help && "items-start")}
      >
        <ItemBody id={id} item={item} />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-[200px] rounded-[14px] p-1.5">
        {item.items.map((entry) => (
          <Action key={entry.key} item={entry} />
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/** The ⋯ menu at the end of a list row or card. Each surface supplies its own items. */
export function ActionMenu({
  label,
  items,
  triggerRef,
}: {
  /** The trigger's accessible name, e.g. "More for Trending". */
  label: string;
  items: ActionMenuItem[];
  triggerRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground size-9 rounded-[10px] max-lg:size-11"
          aria-label={label}
        >
          <Ellipsis className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[248px] rounded-[14px] p-1.5">
        {items.map((item, index) => (
          <Fragment key={item.key}>
            {item.group && index > 0 ? <DropdownMenuSeparator /> : null}
            {"items" in item ? <Submenu item={item} /> : <Action item={item} />}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
