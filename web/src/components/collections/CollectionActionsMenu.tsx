import { Pencil, RefreshCw, Trash2, Users } from "lucide-react";

import { ActionMenu, type ActionMenuItem } from "@/components/calm/ActionMenu";
import {
  SHOW_TO_OTHER_PROFILES_LABEL,
  SHOW_TO_OTHER_PROFILES_SHORT_HELP,
} from "@/lib/collections/copy";

/**
 * The ⋯ on a collection the viewer may change: Edit collection, Sync now for
 * a synced list, the sharing switch on a multi-profile account, and Delete….
 * Leave out a handler and its item is left out.
 */
export function CollectionActionsMenu({
  name,
  onEdit,
  sync,
  share,
  onDelete,
}: {
  name: string;
  onEdit: () => void;
  sync?: { onSync: () => void; syncing: boolean };
  share?: { shared: boolean; onChange: (shared: boolean) => void; disabled?: boolean };
  onDelete: () => void;
}) {
  const items: ActionMenuItem[] = [
    { key: "edit", label: "Edit collection", icon: Pencil, onSelect: onEdit },
  ];
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
      // Over a poster: a dark chip that stays readable on any artwork.
      triggerClassName="size-8 max-lg:size-9 bg-black/55 text-white backdrop-blur-sm hover:bg-black/70 hover:text-white data-[state=open]:bg-black/80 data-[state=open]:text-white"
    />
  );
}
