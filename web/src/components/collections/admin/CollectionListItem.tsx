import type { ReactNode } from "react";
import { Check, EyeOff, Layers, Loader2 } from "lucide-react";

import type { LibraryCollection } from "@/api/types";
import { ListRow, MetaDot } from "@/components/calm/ListRow";
import { PosterPeek } from "@/components/calm/PosterPeek";
import type { PeekRequest } from "@/components/calm/usePeekLimiter";
import { formatRelativeTime } from "@/lib/date";
import { rowTag, showOnTabsLabel } from "@/lib/collections/adminList";
import { HIDDEN_FROM_TAB, ON_HOME } from "@/lib/collections/copy";
import { COLLECTION_KIND_LABEL, collectionKindOf } from "@/lib/collections/types";
import { cn } from "@/lib/utils";

const TAG =
  "inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full px-2 text-[11.5px] font-semibold";

function Tag({ collection, visible }: { collection: LibraryCollection; visible: boolean }) {
  const tag = rowTag({ ...collection, visibility: visible ? "visible" : "hidden" });
  if (tag === "home")
    return (
      <span className={cn(TAG, "bg-success/15 text-success ring-success/30 ring-1 ring-inset")}>
        <Check aria-hidden className="size-3" />
        {ON_HOME}
      </span>
    );
  if (tag === "hidden")
    return (
      <span
        className={cn(TAG, "text-muted-foreground ring-border ring-1 ring-inset max-sm:hidden")}
      >
        <EyeOff aria-hidden className="size-3" />
        {HIDDEN_FROM_TAB}
      </span>
    );
  return null;
}

/** Failed or syncing lists say so at the end of the meta line; a healthy sync stays quiet. */
function SyncStatus({ collection, syncing }: { collection: LibraryCollection; syncing: boolean }) {
  if (syncing || collection.last_sync_status === "running")
    return (
      <>
        <MetaDot />
        <Loader2 aria-hidden className="mr-1 inline size-3 animate-spin align-[-1px]" />
        Syncing now
      </>
    );
  if (collection.last_sync_status !== "failed") return null;
  const when = formatRelativeTime(collection.last_sync_at);
  return (
    <>
      <MetaDot />
      <span
        title={collection.last_sync_message || undefined}
        className="text-destructive font-medium"
      >
        Sync failed{when ? ` ${when}` : ""}
        {collection.last_sync_message ? (
          <span className="sr-only">: {collection.last_sync_message}</span>
        ) : null}
      </span>
    </>
  );
}

/**
 * One server collection on the List: its peek, name and at most one tag, the
 * meta line "type · libraries · N titles", the Collections tab switch and ⋯.
 * A hidden collection keeps a full row with a dimmed peek, because Home rows
 * can still show it. Clicking the row opens the editor.
 */
export function CollectionListItem({
  collection,
  libraryNames,
  showLibraries,
  peek,
  visible,
  syncing,
  switchDisabled,
  onVisibleChange,
  onOpen,
  menu,
}: {
  collection: LibraryCollection;
  /** Every library it's in, by name. */
  libraryNames: readonly string[];
  /** False when one library is selected: every row is in it, so the meta line leaves it out. */
  showLibraries: boolean;
  peek: PeekRequest | null;
  /** The switch, which may run ahead of the saved `visibility` while a change saves. */
  visible: boolean;
  syncing: boolean;
  switchDisabled?: boolean;
  onVisibleChange: (visible: boolean) => void;
  onOpen: () => void;
  menu: ReactNode;
}) {
  const titles = collection.item_count;
  return (
    <ListRow
      id={collection.id}
      title={collection.title}
      collapsed={false}
      collapsedText={null}
      art={
        <div className={cn(!visible && "opacity-45")}>
          <PosterPeek icon={Layers} request={peek} />
        </div>
      }
      tags={<Tag collection={collection} visible={visible} />}
      meta={
        <>
          {COLLECTION_KIND_LABEL[collectionKindOf(collection.collection_type)]}
          {showLibraries && libraryNames.length > 0 ? (
            <>
              <MetaDot />
              {libraryNames.join(", ")}
            </>
          ) : null}
          <MetaDot />
          {titles} title{titles === 1 ? "" : "s"}
          <SyncStatus collection={collection} syncing={syncing} />
        </>
      }
      shown={{
        checked: visible,
        disabled: switchDisabled,
        label: showOnTabsLabel(collection.title, libraryNames),
        onChange: onVisibleChange,
      }}
      menu={menu}
      onOpen={onOpen}
    />
  );
}

/** The heads of the List's two columns: how many collections, and what the switch means. */
export function CollectionColumnHeader({ count }: { count: number }) {
  return (
    <div className="text-muted-foreground flex items-center justify-between px-4 pt-1 pb-2 text-[12.5px]">
      <span role="status">
        {count} collection{count === 1 ? "" : "s"}
      </span>
      <span aria-hidden className="pr-14 max-lg:pr-16">
        On Collections tab
      </span>
    </div>
  );
}
