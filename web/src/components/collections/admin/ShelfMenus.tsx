import { ArrowDownToLine, ArrowUpToLine, Eye, EyeOff, Move, Pencil, Trash2 } from "lucide-react";

import { ActionMenu, type ActionMenuItem } from "@/components/calm/ActionMenu";
import { SHOW_ON_TAB_LABEL } from "@/lib/collections/copy";
import type { Shelf } from "@/lib/collections/shelves";

/**
 * A shelf's ⋯: Rename shelf, Move to top, Move to bottom and Delete shelf….
 * My collections can be renamed and moved but never deleted. With `disabled`
 * (no shelf support, or the order still loading) every item says so by being off.
 */
export function ShelfMenu({
  shelf,
  isFirst,
  isLast,
  disabled,
  onRename,
  onMove,
  onDelete,
}: {
  shelf: Shelf;
  isFirst: boolean;
  isLast: boolean;
  disabled: boolean;
  onRename: () => void;
  onMove: (to: "top" | "bottom") => void;
  onDelete: () => void;
}) {
  const items: ActionMenuItem[] = [
    { key: "rename", label: "Rename shelf", icon: Pencil, disabled, onSelect: onRename },
    {
      key: "top",
      label: "Move to top",
      icon: ArrowUpToLine,
      disabled: disabled || isFirst,
      onSelect: () => onMove("top"),
    },
    {
      key: "bottom",
      label: "Move to bottom",
      icon: ArrowDownToLine,
      disabled: disabled || isLast,
      onSelect: () => onMove("bottom"),
    },
  ];
  if (shelf.kind === "regular")
    items.push({
      key: "delete",
      label: "Delete shelf…",
      icon: Trash2,
      destructive: true,
      group: true,
      disabled,
      onSelect: onDelete,
    });
  return <ActionMenu label={`More for shelf ${shelf.name}`} items={items} />;
}

/**
 * A collection's ⋯ on an Arrange shelf: Edit collection, Move to shelf ▸
 * (every shelf that takes server collections, the current one checked) and
 * the Collections tab: Hide from Collections tab, or Show on it when hidden.
 */
export function ArrangeCardMenu({
  name,
  shelves,
  currentShelfId,
  canMove,
  visible,
  onEdit,
  onMove,
  onVisibleChange,
}: {
  name: string;
  shelves: readonly Shelf[];
  currentShelfId: string;
  canMove: boolean;
  visible: boolean;
  onEdit: () => void;
  onMove: (shelfId: string) => void;
  onVisibleChange: (visible: boolean) => void;
}) {
  const items: ActionMenuItem[] = [
    { key: "edit", label: "Edit collection", icon: Pencil, onSelect: onEdit },
    {
      key: "move",
      label: "Move to shelf",
      icon: Move,
      disabled: !canMove,
      selectedKey: currentShelfId,
      items: shelves.map((shelf) => ({
        key: shelf.id,
        label: shelf.name,
        icon: Move,
        onSelect: () => onMove(shelf.id),
      })),
    },
    visible
      ? {
          key: "hide",
          label: "Hide from Collections tab",
          icon: EyeOff,
          group: true,
          onSelect: () => onVisibleChange(false),
        }
      : {
          key: "show",
          label: SHOW_ON_TAB_LABEL,
          icon: Eye,
          group: true,
          onSelect: () => onVisibleChange(true),
        },
  ];
  return <ActionMenu label={`More for ${name}`} items={items} />;
}
