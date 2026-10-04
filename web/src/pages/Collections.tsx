import {
  fetchCollectionEditSnapshot,
  fetchCollectionOrderSnapshot,
  type CollectionEditSnapshot,
} from "@/api/personalCollections";
import { toast } from "sonner";
import {
  useMemo,
  useRef,
  useState,
  type KeyboardEventHandler,
  type PointerEventHandler,
  type ReactNode,
} from "react";
import { Link, useNavigate } from "react-router";
import { GripVertical, Plus, Sparkles, Users } from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import type { Collection, LibraryTabCollection } from "@/api/types";
import { CalmPage } from "@/components/calm/CalmPage";
import { PillSwitcher } from "@/components/calm/PillSwitcher";
import { CollectionActionsMenu } from "@/components/collections/CollectionActionsMenu";
import { CollectionPosterCard } from "@/components/collections/CollectionPosterCard";
import {
  CollectionMetaLine,
  type SyncAttention,
} from "@/components/collections/editor/CollectionMetaLine";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CollectionTemplateGallery } from "@/components/CollectionTemplateGallery";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCollectionCapabilities,
  useCollections,
  useDeleteCollection,
  useReorderCollections,
  useServerCollections,
  useSetCollectionShared,
} from "@/hooks/queries/collections";
import { useProfiles } from "@/hooks/queries/profiles";
import { useSyncUserCollection } from "@/hooks/queries/userCollectionImports";
import { useCurrentProfile } from "@/hooks/useCurrentProfile";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { personalDeleteDescription, unshareConsequence } from "@/lib/collections/copy";
import { partitionPersonalCollections } from "@/lib/collections/personalOwnership";
import { PERSONAL_SCOPE } from "@/lib/collections/scope";
import { COLLECTION_KIND_LABEL, collectionKindOf } from "@/lib/collections/types";
import { cn } from "@/lib/utils";

/** Seven posters a row on desktop, three on phones (spec §5.3, §8). */
const POSTER_GRID = "grid grid-cols-3 gap-x-3.5 gap-y-5 sm:grid-cols-5 lg:grid-cols-7";
/** One POSTER_GRID column, for cards laid out in a flex row inside an `@container`. */
const GRID_COLUMN_WIDTH =
  "w-[calc((100cqw-2*0.875rem)/3)] sm:w-[calc((100cqw-4*0.875rem)/5)] lg:w-[calc((100cqw-6*0.875rem)/7)]";
/** Under this width New collection moves to a bar docked at the bottom. */
const NARROW_QUERY = "(max-width: 1023px)";

export default function Collections() {
  useDocumentTitle("Collections");
  const { data, isLoading } = useCollections();
  const { data: capabilities } = useCollectionCapabilities();
  const { data: profiles = [] } = useProfiles();
  const { profile } = useCurrentProfile();
  const { own, shared } = useMemo(
    () => partitionPersonalCollections(data ?? [], profile?.id, profiles),
    [data, profile?.id, profiles],
  );
  const otherProfileNames = profiles
    .filter((entry) => entry.id !== profile?.id)
    .map((entry) => entry.name);
  // Sharing means nothing on a one-profile account (plan D2).
  const multiProfile = otherProfileNames.length > 0;
  const [galleryOpen, setGalleryOpen] = useState(false);
  const narrow = useMediaQuery(NARROW_QUERY);

  const newCollection = (
    <Button asChild size="sm" className={cn(narrow && "h-11 w-full")}>
      <Link to={PERSONAL_SCOPE.paths.create()}>
        <Plus aria-hidden /> New collection
      </Link>
    </Button>
  );
  // Until the New collection picker offers synced lists, templates stay here.
  const browseTemplates = capabilities?.imports ? (
    <Button size="sm" variant="outline" onClick={() => setGalleryOpen(true)}>
      <Sparkles aria-hidden /> Browse Templates
    </Button>
  ) : null;

  return (
    <div className="page-shell py-4 sm:py-6">
      <CalmPage
        heading="page"
        title="Collections"
        subtitle={
          multiProfile
            ? "Yours, the ones other profiles share with you, and the server's."
            : "Yours and the server's."
        }
        actions={
          <>
            {browseTemplates}
            {narrow ? null : newCollection}
          </>
        }
        padBottom={narrow}
      >
        {capabilities?.imports ? (
          <CollectionTemplateGallery mode="user" open={galleryOpen} onOpenChange={setGalleryOpen} />
        ) : null}
        {isLoading ? (
          <PosterGridSkeleton />
        ) : (
          <YourCollections
            collections={own}
            canReorder={capabilities?.item_reorder === true}
            canSync={capabilities?.imports === true}
            otherProfileNames={otherProfileNames}
          />
        )}
        {multiProfile && shared.length > 0 ? (
          <CollectionsSection
            id="shared-with-me"
            title="Shared with me"
            count={shared.reduce((total, group) => total + group.collections.length, 0)}
            note="Read-only. Other profiles on this account made these."
          >
            {/* Owners sit side by side, each card one grid column wide. */}
            <div className="@container">
              <div className="flex flex-wrap gap-x-3.5 gap-y-5">
                {shared.map((group) => (
                  <div key={group.owner.id} className="grid max-w-full min-w-0 content-start gap-3">
                    <div className="text-muted-foreground flex items-center gap-2 text-sm">
                      <OwnerInitial name={group.owner.name} />
                      <h3>
                        by <span className="text-foreground font-semibold">{group.owner.name}</span>
                      </h3>
                    </div>
                    <ul className="flex flex-wrap gap-x-3.5 gap-y-5">
                      {group.collections.map((collection) => (
                        <li key={collection.id} className={GRID_COLUMN_WIDTH}>
                          <CollectionPosterCard
                            collection={posterOf(collection)}
                            kind="user_collections"
                            meta={<CardMeta collection={collection} />}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </CollectionsSection>
        ) : null}
        <ServerCollectionsSection />
      </CalmPage>
      {narrow ? (
        <div
          role="region"
          aria-label="Page actions"
          className="from-background/0 to-background fixed inset-x-0 bottom-0 z-30 bg-gradient-to-b to-30% px-4 pt-[22px] pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        >
          {newCollection}
        </div>
      ) : null}
    </div>
  );
}

/** One section of the page: a heading with its count, a note at the right, and its cards. */
function CollectionsSection({
  id,
  title,
  count,
  note,
  action,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  note?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="grid gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex items-baseline gap-2">
          <h2 id={id} className="text-xl font-semibold tracking-tight sm:text-2xl">
            {title}
          </h2>
          {count !== undefined ? (
            <span className="text-muted-foreground text-sm">{count}</span>
          ) : null}
        </div>
        {note ? <p className="text-muted-foreground text-[13px]">{note}</p> : null}
        {action}
      </div>
      {children}
    </section>
  );
}

function OwnerInitial({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="bg-primary/20 text-primary inline-flex size-5 items-center justify-center rounded-full text-[11px] font-semibold"
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

function PosterGridSkeleton() {
  return (
    <div className={POSTER_GRID} aria-hidden>
      {Array.from({ length: 7 }, (_, index) => (
        <div key={index}>
          <Skeleton className="aspect-[2/3] rounded-xl" />
          <Skeleton className="mt-2.5 h-4 w-3/4" />
        </div>
      ))}
    </div>
  );
}

/** A personal collection in the shape the poster card draws. */
function posterOf(collection: Collection): LibraryTabCollection {
  return {
    id: collection.id,
    title: collection.name,
    poster_url: collection.poster_url ?? "",
    poster_thumbhash: collection.poster_thumbhash,
    item_count: collection.item_count ?? 0,
  };
}

/** Failed or syncing lists say so; a healthy sync stays quiet. */
function syncAttention(collection: Collection, syncing: boolean): SyncAttention | undefined {
  if (syncing || collection.last_sync_status === "running")
    return { label: "Syncing now", tone: "syncing" };
  if (collection.last_sync_status === "failed")
    return { label: "Sync failed", tone: "failed", message: collection.last_sync_message };
  return undefined;
}

function CardMeta({ collection, syncing = false }: { collection: Collection; syncing?: boolean }) {
  return (
    <CollectionMetaLine
      className="text-xs"
      typeLabel={COLLECTION_KIND_LABEL[collectionKindOf(collection.collection_type)]}
      itemCount={collection.item_count ?? 0}
      attention={syncAttention(collection, syncing)}
    />
  );
}

/**
 * The profile's own collections, in its order: drag a poster, or focus its
 * handle and press Space, then the arrow keys. Each card has a ⋯ menu.
 */
function YourCollections({
  collections,
  canReorder,
  canSync,
  otherProfileNames,
}: {
  collections: Collection[];
  canReorder: boolean;
  canSync: boolean;
  otherProfileNames: string[];
}) {
  const navigate = useNavigate();
  const remove = useDeleteCollection();
  const sync = useSyncUserCollection();
  const share = useSetCollectionShared();
  const reorderMutation = useReorderCollections();
  const [confirmDelete, setConfirmDelete] = useState<CollectionEditSnapshot | null>(null);
  const [confirmUnshare, setConfirmUnshare] = useState<Collection | null>(null);
  const dragSnapshot = useRef<Promise<string>>(undefined);
  const ids = collections.map((collection) => collection.id);

  // A drag reads the server's order validator as it starts, and refuses to
  // reorder when the server's own-collection order differs from the page.
  function beginDrag() {
    dragSnapshot.current = fetchCollectionOrderSnapshot().then((order) => {
      const same =
        order.ordered_ids.length === ids.length &&
        order.ordered_ids.every((id, index) => id === ids[index]);
      if (!same) throw new Error("Collection order changed. Reload before moving collections.");
      return order.etag;
    });
    // A cancelled drag may never consume its snapshot.
    void dragSnapshot.current.catch(() => undefined);
  }
  function reorder(orderedIds: string[]) {
    if (!dragSnapshot.current) return;
    void dragSnapshot.current
      .then((etag) => reorderMutation.mutate({ orderedIds, etag }))
      .catch((error) => toast.error(error.message));
  }
  function setShared(collection: Collection, shared: boolean) {
    // Turning sharing off takes it away from other profiles: ask first.
    if (shared) share.mutate({ id: collection.id, shared });
    else setConfirmUnshare(collection);
  }

  return (
    <CollectionsSection
      id="your-collections"
      title="Your collections"
      count={collections.length}
      note={collections.length > 0 ? "Only you can change these" : undefined}
    >
      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
        title={`Delete "${confirmDelete?.collection.name}"?`}
        description={personalDeleteDescription(confirmDelete?.collection.is_shared ?? false)}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          if (confirmDelete)
            remove.mutate({ id: confirmDelete.collection.id, etag: confirmDelete.etag });
          setConfirmDelete(null);
        }}
      />
      <ConfirmDialog
        open={confirmUnshare !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmUnshare(null);
        }}
        title={`Stop sharing ${confirmUnshare?.name}?`}
        description={unshareConsequence(otherProfileNames)}
        confirmLabel="Stop sharing"
        onConfirm={() => {
          if (confirmUnshare) share.mutate({ id: confirmUnshare.id, shared: false });
          setConfirmUnshare(null);
        }}
      />
      {collections.length === 0 ? (
        <ul className={POSTER_GRID}>
          <li>
            <NewCollectionCard />
          </li>
        </ul>
      ) : (
        <>
          <SortableCollectionGrid
            collections={collections}
            disabled={!canReorder}
            onBeginDrag={beginDrag}
            onReorder={reorder}
          >
            {collections.map((collection) => {
              const syncing = sync.isPending && sync.variables === collection.id;
              const synced = collectionKindOf(collection.collection_type) === "synced";
              return (
                <SortableCollectionCard
                  key={collection.id}
                  collection={collection}
                  canReorder={canReorder}
                  syncing={syncing}
                  menu={
                    <CollectionActionsMenu
                      name={collection.name}
                      onEdit={() => navigate(PERSONAL_SCOPE.paths.edit(collection.id))}
                      sync={
                        canSync && synced
                          ? { syncing, onSync: () => sync.mutate(collection.id) }
                          : undefined
                      }
                      share={
                        otherProfileNames.length > 0
                          ? {
                              shared: collection.is_shared,
                              disabled: share.isPending,
                              onChange: (shared) => setShared(collection, shared),
                            }
                          : undefined
                      }
                      onDelete={() => {
                        void fetchCollectionEditSnapshot(collection.id)
                          .then(setConfirmDelete)
                          .catch((error) => toast.error(error.message));
                      }}
                    />
                  }
                />
              );
            })}
          </SortableCollectionGrid>
          {canReorder && collections.length > 1 ? (
            <p className="text-muted-foreground flex items-center gap-2 text-[13px]">
              <GripVertical aria-hidden className="size-3.5" />
              Drag a poster to change the order, or focus its handle and press Space, then the arrow
              keys.
            </p>
          ) : null}
        </>
      )}
    </CollectionsSection>
  );
}

/** The empty Your collections: one dashed card, because nobody sees anything here yet. */
function NewCollectionCard() {
  return (
    <Link
      to={PERSONAL_SCOPE.paths.create()}
      className="border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 focus-visible:ring-ring/50 flex aspect-[2/3] flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-center text-[13px] font-medium transition-colors outline-none focus-visible:ring-[3px]"
    >
      <Plus aria-hidden className="size-5" />
      New collection
    </Link>
  );
}

/** Live-region words for a keyboard or pointer move, by name and position. */
function moveAnnouncements(collections: Collection[]): Announcements {
  const name = (id: UniqueIdentifier) =>
    collections.find((collection) => collection.id === id)?.name ?? "The collection";
  const position = (id: UniqueIdentifier) =>
    `position ${collections.findIndex((collection) => collection.id === id) + 1} of ${collections.length}`;
  return {
    onDragStart: ({ active }) => `Picked up ${name(active.id)}, at ${position(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${name(active.id)} is over ${position(over.id)}.`
        : `${name(active.id)} is not over a position.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `Moved ${name(active.id)} to ${position(over.id)}.`
        : `${name(active.id)} stayed at ${position(active.id)}.`,
    onDragCancel: ({ active }) => `Cancelled. ${name(active.id)} stayed at ${position(active.id)}.`,
  };
}

// SortableCollectionGrid is the profile's own collections as one flat,
// drag-sortable grid. It reports the new full order of ids.
function SortableCollectionGrid({
  collections,
  disabled,
  onBeginDrag,
  onReorder,
  children,
}: {
  collections: Collection[];
  disabled: boolean;
  onBeginDrag: () => void;
  onReorder: (orderedIds: string[]) => void;
  children: ReactNode;
}) {
  const ids = collections.map((collection) => collection.id);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ids, from, to));
  }
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      accessibility={{ announcements: moveAnnouncements(collections) }}
      onDragStart={onBeginDrag}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={ids} strategy={rectSortingStrategy} disabled={disabled}>
        <ul className={POSTER_GRID}>{children}</ul>
      </SortableContext>
    </DndContext>
  );
}

// SortableCollectionCard is one of the profile's own collections, with its ⋯
// menu and, when the store supports it, a drag handle. The pointer can drag
// from anywhere on the card; the keyboard drags from the handle, so Enter on
// the card's link still opens it.
function SortableCollectionCard({
  collection,
  canReorder,
  syncing,
  menu,
}: {
  collection: Collection;
  canReorder: boolean;
  syncing: boolean;
  menu: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: collection.id, disabled: !canReorder });
  return (
    <li
      ref={setNodeRef}
      data-collection-id={collection.id}
      onPointerDown={canReorder ? (listeners?.onPointerDown as PointerEventHandler) : undefined}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      <CollectionPosterCard
        collection={posterOf(collection)}
        kind="user_collections"
        meta={<CardMeta collection={collection} syncing={syncing} />}
        tag={
          collection.is_shared ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/40 bg-sky-500/15 px-2 py-0.5 text-[11px] font-semibold text-sky-300">
              <Users aria-hidden className="size-3" />
              Shared
            </span>
          ) : undefined
        }
        menu={menu}
        handle={
          canReorder ? (
            <button
              ref={setActivatorNodeRef}
              type="button"
              aria-label={`Drag ${collection.name}`}
              className="flex size-8 cursor-grab touch-none items-center justify-center rounded-[10px] bg-black/55 text-white opacity-0 backdrop-blur-sm transition group-focus-within/card:opacity-100 group-hover/card:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100"
              {...attributes}
              onKeyDown={listeners?.onKeyDown as KeyboardEventHandler}
            >
              <GripVertical aria-hidden className="size-4" />
            </button>
          ) : undefined
        }
      />
    </li>
  );
}

const ALL_LIBRARIES = "all";

/**
 * Server collections: library pills, one row of cards, and See all for the
 * chosen library. Hidden when no library has any (plan D2), on every account.
 */
function ServerCollectionsSection() {
  const { data, isLoading } = useServerCollections();
  const [selected, setSelected] = useState(ALL_LIBRARIES);
  const libraries = data ?? [];

  if (isLoading)
    return (
      <CollectionsSection id="server-collections" title="Server collections">
        <PosterGridSkeleton />
      </CollectionsSection>
    );
  if (libraries.length === 0) return null;

  const library =
    libraries.length === 1
      ? libraries[0]
      : libraries.find((entry) => String(entry.library_id) === selected);
  // All libraries: every library's cards in library order, each collection once.
  const seen = new Set<string>();
  const cards = (library ? [library] : libraries).flatMap((entry) =>
    entry.collections.flatMap((collection) => {
      if (seen.has(collection.id)) return [];
      seen.add(collection.id);
      return [{ collection, libraryId: entry.library_id }];
    }),
  );
  return (
    <CollectionsSection
      id="server-collections"
      title="Server collections"
      action={
        library ? (
          <Link
            to={`/library/${library.library_id}?tab=collections`}
            aria-label={`See all ${library.total_count} ${library.library_name} collections`}
            className="text-sm font-medium underline-offset-4 hover:underline"
          >
            See all {library.total_count}
          </Link>
        ) : null
      }
    >
      {libraries.length > 1 ? (
        <PillSwitcher
          label="Library"
          options={[
            { value: ALL_LIBRARIES, label: "All" },
            ...libraries.map((entry) => ({
              value: String(entry.library_id),
              label: entry.library_name,
            })),
          ]}
          value={library ? String(library.library_id) : ALL_LIBRARIES}
          onChange={setSelected}
        />
      ) : null}
      {/* One row: as many cards as the grid has columns. */}
      <ul
        className={cn(
          POSTER_GRID,
          "max-sm:[&>li:nth-child(n+4)]:hidden max-lg:[&>li:nth-child(n+6)]:hidden [&>li:nth-child(n+8)]:hidden",
        )}
      >
        {cards.map(({ collection, libraryId }) => (
          <li key={collection.id}>
            <CollectionPosterCard
              collection={collection}
              kind="regular"
              libraryId={libraryId}
              meta={<CollectionMetaLine className="text-xs" itemCount={collection.item_count} />}
            />
          </li>
        ))}
      </ul>
    </CollectionsSection>
  );
}
