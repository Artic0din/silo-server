import type { Ref } from "react";
import { Eye, Pencil, RefreshCw, Trash2, Users } from "lucide-react";

import { ActionMenu, type ActionMenuItem } from "@/components/calm/ActionMenu";
import {
  SHOW_TO_OTHER_PROFILES_LABEL,
  SHOW_TO_OTHER_PROFILES_SHORT_HELP,
} from "@/lib/collections/copy";

/** Where a collection can be opened: one item, or a submenu when there are several. */
export interface OpenInLibraries {
  libraries: ReadonlyArray<{ id: number; name: string }>;
  onOpen: (libraryId: number) => void;
  /** Why it can't be opened now, shown under the item. */
  disabledReason?: string;
}

function openInItem({ libraries, onOpen, disabledReason }: OpenInLibraries): ActionMenuItem {
  const shared = { icon: Eye, disabled: Boolean(disabledReason), help: disabledReason };
  if (libraries.length === 1) {
    const [library] = libraries;
    return {
      ...shared,
      key: "open",
      label: `Open in ${library!.name}`,
      onSelect: () => onOpen(library!.id),
    };
  }
  return {
    ...shared,
    key: "open",
    label: "Open in",
    items: libraries.map((library) => ({
      key: `open-${library.id}`,
      label: library.name,
      icon: Eye,
      onSelect: () => onOpen(library.id),
    })),
  };
}

/**
 * The ⋯ on a collection the viewer may change: Edit collection, Open in for a
 * server collection, Sync now for a synced list, the sharing switch on a
 * multi-profile account, and Delete…. Leave out a handler and its item is
 * left out. `placement="poster"` draws the trigger over a card's artwork.
 */
export function CollectionActionsMenu({
  name,
  onEdit,
  openIn,
  sync,
  share,
  onDelete,
  triggerRef,
  placement = "poster",
}: {
  name: string;
  onEdit: () => void;
  openIn?: OpenInLibraries;
  sync?: { onSync: () => void; syncing: boolean };
  share?: { shared: boolean; onChange: (shared: boolean) => void; disabled?: boolean };
  onDelete: () => void;
  triggerRef?: Ref<HTMLButtonElement>;
  placement?: "poster" | "row";
}) {
  const items: ActionMenuItem[] = [
    { key: "edit", label: "Edit collection", icon: Pencil, onSelect: onEdit },
  ];
  if (openIn && openIn.libraries.length > 0) items.push(openInItem(openIn));
  if (sync) {
    items.push({
      key: "sync",
      label: sync.syncing ? "Syncing…" : "Sync now",
      icon: RefreshCw,
      disabled: sync.syncing,
      onSelect: sync.onSync,
    });
  }
  if (share) {
    items.push({
      key: "share",
      label: SHOW_TO_OTHER_PROFILES_LABEL,
      help: SHOW_TO_OTHER_PROFILES_SHORT_HELP,
      icon: Users,
      group: true,
      checked: share.shared,
      disabled: share.disabled,
      onCheckedChange: share.onChange,
    });
  }
  items.push({
    key: "delete",
    label: "Delete…",
    icon: Trash2,
    destructive: true,
    group: true,
    onSelect: onDelete,
  });
  return (
    <ActionMenu
      label={`More for ${name}`}
      items={items}
      triggerRef={triggerRef}
      triggerClassName={
        placement === "poster"
          ? // Over a poster: a dark chip that stays readable on any artwork.
            "size-8 max-lg:size-9 bg-black/55 text-white backdrop-blur-sm hover:bg-black/70 hover:text-white data-[state=open]:bg-black/80 data-[state=open]:text-white"
          : undefined
      }
    />
  );
}
