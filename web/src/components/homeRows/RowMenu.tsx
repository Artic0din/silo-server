import { Fragment, type Ref } from "react";
import { Ellipsis, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface RowMenuItem {
  key: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
  /** Starts a new group: a separator is drawn above it. */
  group?: boolean;
}

/** The ⋯ menu at the end of a row. Each surface supplies its own items. */
export function RowMenu({
  rowTitle,
  items,
  triggerRef,
}: {
  rowTitle: string;
  items: RowMenuItem[];
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
          aria-label={`More for ${rowTitle}`}
        >
          <Ellipsis className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[248px] rounded-[14px] p-1.5">
        {items.map((item, index) => (
          <Fragment key={item.key}>
            {item.group && index > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              variant={item.destructive ? "destructive" : "default"}
              disabled={item.disabled}
              onSelect={item.onSelect}
              className="gap-2.5 rounded-[9px] px-2.5 py-2"
            >
              <item.icon />
              {item.label}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
