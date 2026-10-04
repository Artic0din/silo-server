import {
  fetchCollectionEditSnapshot,
  fetchCollectionOrderSnapshot,
  type CollectionEditSnapshot,
} from "@/api/personalCollections";
import { toast } from "sonner";
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  Calendar,
  Film,
  Globe,
  GripVertical,
  Library,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { Skeleton } from "@/components/ui/skeleton";

import { CSS } from "@dnd-kit/utilities";

import type { Collection, ServerCollectionsLibrary, UserCollectionType } from "@/api/types";
import {
  useCollectionCapabilities,
  useCollections,
  useDeleteCollection,
  useReorderCollections,
  useServerCollections,
} from "@/hooks/queries/collections";
import { useProfiles } from "@/hooks/queries/profiles";
import { useCurrentProfile } from "@/hooks/useCurrentProfile";
import { partitionPersonalCollections } from "@/lib/collections/personalOwnership";
import { PERSONAL_SCOPE } from "@/lib/collections/scope";
import { CollectionPosterCard } from "@/components/collections/CollectionPosterCard";
import MediaCarousel from "@/components/MediaCarousel";
import { useSyncUserCollection } from "@/hooks/queries/userCollectionImports";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { CollectionTemplateGallery } from "@/components/CollectionTemplateGallery";
import { useUICustomization } from "@/hooks/useUICustomization";
import { carouselCardWidthClasses } from "@/lib/uiCustomization";

import { buildUserCollectionCatalogHref } from "./userCollectionsShared";

type ImportedCollectionType = Extract<UserCollectionType, "mdblist" | "tmdb" | "trakt">;
const SYNCABLE_TYPES = new Set<ImportedCollectionType>(["mdblist", "tmdb", "trakt"]);

function isImportedType(t: UserCollectionType): t is ImportedCollectionType {
  return SYNCABLE_TYPES.has(t as ImportedCollectionType);
}

const COLLECTION_GRID = "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3";

export default function Collections() {
  return <CollectionList />;
}

function CollectionList() {
  const { data, isLoading } = useCollections();
  const { data: capabilities } = useCollectionCapabilities();
  const { data: profiles = [] } = useProfiles();
  const { profile } = useCurrentProfile();
  const { own, shared } = useMemo(
    () => partitionPersonalCollections(data ?? [], profile?.id, profiles),
    [data, profile?.id, profiles],
  );
  const [confirmDeleteCollection, setConfirmDeleteCollection] =
    useState<CollectionEditSnapshot | null>(null);
  const dragSnapshot = useRef<Promise<string>>(undefined);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const navigate = useNavigate();
  const deleteMutation = useDeleteCollection();
  const syncMutation = useSyncUserCollection();
  const reorderMutation = useReorderCollections();
  const canReorder = capabilities?.item_reorder === true;
  const ownIDs = own.map((collection) => collection.id);

  // A drag reads the server's order validator as it starts, and refuses to
  // reorder when the server's own-collection order differs from the page.
  function beginDrag() {
    dragSnapshot.current = fetchCollectionOrderSnapshot().then((order) => {
      const same =
        order.ordered_ids.length === ownIDs.length &&
        order.ordered_ids.every((id, index) => id === ownIDs[index]);
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

  useDocumentTitle("Collections");

  if (isLoading)
    return (
      <div className="page-shell space-y-4 py-4 sm:py-6">
        <div className={COLLECTION_GRID}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-[1.6rem]" />
          ))}
        </div>
      </div>
    );

  return (
    <div className="page-shell space-y-6 py-4 sm:py-6">
      <ConfirmDialog
        open={confirmDeleteCollection !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteCollection(null);
        }}
        title="Delete collection"
        description={`Delete collection "${confirmDeleteCollection?.collection.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          if (confirmDeleteCollection)
            deleteMutation.mutate({
              id: confirmDeleteCollection.collection.id,
              etag: confirmDeleteCollection.etag,
            });
          setConfirmDeleteCollection(null);
        }}
      />

      {capabilities?.imports && (
        <CollectionTemplateGallery mode="user" open={galleryOpen} onOpenChange={setGalleryOpen} />
      )}

      <div className="page-header">
        <div className="space-y-3">
          <h1 className="page-title text-[clamp(2rem,5vw,3.25rem)]">Collections</h1>
          <p className="page-subtitle text-sm sm:text-base">
            Build personal or shared shelves around moods, series arcs, or anything else worth
            grouping.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {capabilities?.imports && (
            <Button size="sm" variant="outline" onClick={() => setGalleryOpen(true)}>
              <Sparkles className="mr-1 h-4 w-4" /> Browse Templates
            </Button>
          )}
          <Button size="sm" onClick={() => navigate(PERSONAL_SCOPE.paths.create())}>
            <Plus className="mr-1 h-4 w-4" /> New Collection
          </Button>
        </div>
      </div>

      <section className="space-y-4" aria-labelledby="your-collections">
        <h2 id="your-collections" className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Your collections
        </h2>
        {own.length === 0 ? (
          <div className="surface-panel flex flex-col items-center justify-center gap-3 rounded-[2rem] py-16 text-center">
            <Library className="text-muted-foreground/50 h-10 w-10" />
            <div className="space-y-1">
              <p className="text-sm font-medium">No collections yet</p>
              <p className="text-muted-foreground max-w-sm text-xs">
                Build your own collection from scratch.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {capabilities?.imports && (
                <Button variant="outline" size="sm" onClick={() => setGalleryOpen(true)}>
                  <Sparkles className="mr-1 h-4 w-4" /> Start from a template
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate(PERSONAL_SCOPE.paths.create())}
              >
                <Plus className="mr-1 h-4 w-4" /> Create from scratch
              </Button>
            </div>
          </div>
        ) : (
          <SortableCollectionGrid
            ids={ownIDs}
            disabled={!canReorder}
            onBeginDrag={beginDrag}
            onReorder={reorder}
          >
            {own.map((collection) => {
              const isSyncing = syncMutation.isPending && syncMutation.variables === collection.id;
              return (
                <SortableCollectionCard
                  key={collection.id}
                  collection={collection}
                  canReorder={canReorder}
                  actions={{
                    syncable:
                      capabilities?.imports === true && isImportedType(collection.collection_type),
                    isSyncing,
                    onSync: () => syncMutation.mutate(collection.id),
                    onEdit: () => navigate(PERSONAL_SCOPE.paths.edit(collection.id)),
                    onDelete: () => {
                      void fetchCollectionEditSnapshot(collection.id)
                        .then(setConfirmDeleteCollection)
                        .catch((error) => toast.error(error.message));
                    },
                  }}
                />
              );
            })}
          </SortableCollectionGrid>
        )}
      </section>

      {shared.length > 0 ? (
        <section className="space-y-4" aria-labelledby="shared-with-me">
          <h2 id="shared-with-me" className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Shared with me
          </h2>
          {shared.map((group) => (
            <div key={group.owner.id} className="space-y-3">
              <h3 className="text-muted-foreground text-sm font-medium">by {group.owner.name}</h3>
              <div className={COLLECTION_GRID}>
                {group.collections.map((collection) => (
                  <CollectionCard key={collection.id} collection={collection} />
                ))}
              </div>
            </div>
          ))}
        </section>
      ) : null}

      <ServerCollectionsSection />
    </div>
  );
}

// SortableCollectionGrid is the profile's own collections as one flat,
// drag-sortable grid. It reports the new full order of ids.
function SortableCollectionGrid({
  ids,
  disabled,
  onBeginDrag,
  onReorder,
  children,
}: {
  ids: string[];
  disabled: boolean;
  onBeginDrag: () => void;
  onReorder: (orderedIds: string[]) => void;
  children: React.ReactNode;
}) {
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
      onDragStart={onBeginDrag}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={ids} strategy={rectSortingStrategy} disabled={disabled}>
        <div className={COLLECTION_GRID}>{children}</div>
      </SortableContext>
    </DndContext>
  );
}

// ServerCollectionsSection renders admin-curated collections aggregated across
// every accessible library, one horizontal teaser row per library. Each row's
// title (and the "Explore all" action when the library has more) links into
// that library's full Collections tab.
function ServerCollectionsSection() {
  const { data, isLoading } = useServerCollections();
  const { cardPresentation } = useUICustomization();
  const posterWidthClasses = carouselCardWidthClasses(cardPresentation.poster_size);
  const libraries = data ?? [];

  if (isLoading) {
    // Mirror the loaded layout (per-library horizontal rows) so data arriving
    // doesn't shift the page from a grid into rows.
    return (
      <section className="space-y-6">
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Server collections</h2>
          <p className="text-muted-foreground text-sm">
            Curated shelves from across every library on this server.
          </p>
        </div>
        <div className="space-y-8">
          {Array.from({ length: 2 }).map((_, row) => (
            <div key={row} className="space-y-5">
              <Skeleton className="h-7 w-40" />
              <div className="flex gap-4 overflow-hidden lg:gap-5">
                {Array.from({ length: 7 }).map((_, i) => (
                  <div key={i} className={posterWidthClasses}>
                    <Skeleton className="aspect-[2/3] rounded-xl" />
                    <Skeleton className="mt-2.5 h-4 w-3/4" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (libraries.length === 0) return null;

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Server collections</h2>
        <p className="text-muted-foreground text-sm">
          Curated shelves from across every library on this server.
        </p>
      </div>
      <div className="space-y-8">
        {libraries.map((library) => (
          <ServerLibraryRow key={library.library_id} library={library} />
        ))}
      </div>
    </section>
  );
}

// One library's teaser row of server collections, rendered with the shared
// MediaCarousel so it matches every other content row in the app (hover scroll
// arrows, edge fades, drag/snap, keyboard nav). edgePadding is off because this
// section sits inside the Collections page's `page-shell`, which already
// supplies horizontal padding — the row title and cards align to that column.
function ServerLibraryRow({ library }: { library: ServerCollectionsLibrary }) {
  const navigate = useNavigate();
  const { cardPresentation } = useUICustomization();
  const posterWidthClasses = carouselCardWidthClasses(cardPresentation.poster_size);
  const collectionsHref = `/library/${library.library_id}?tab=collections`;
  const hasMore = library.total_count > library.collections.length;
  return (
    <MediaCarousel
      title={library.library_name}
      titleHref={collectionsHref}
      onViewAll={hasMore ? () => navigate(collectionsHref) : undefined}
      edgePadding={false}
    >
      {library.collections.map((collection) => (
        <div key={collection.id} className={posterWidthClasses}>
          <CollectionPosterCard
            collection={collection}
            kind="regular"
            libraryId={library.library_id}
          />
        </div>
      ))}
    </MediaCarousel>
  );
}

interface CollectionCardActions {
  syncable: boolean;
  isSyncing: boolean;
  onSync: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

// SortableCollectionCard is one of the profile's own collections, with its
// management actions and, when the store supports it, a drag handle.
function SortableCollectionCard({
  collection,
  canReorder,
  actions,
}: {
  collection: Collection;
  canReorder: boolean;
  actions: CollectionCardActions;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: collection.id,
    disabled: !canReorder,
  });
  return (
    <CollectionCard
      collection={collection}
      actions={actions}
      cardRef={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      dragHandle={
        canReorder ? (
          <button
            type="button"
            aria-label={`Drag ${collection.name}`}
            className="hover:bg-surface-hover relative z-10 -ml-1 cursor-grab touch-none rounded-md p-1 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="text-muted-foreground h-4 w-4" />
          </button>
        ) : null
      }
    />
  );
}

// CollectionCard renders one personal collection. Without actions it is
// another profile's shared collection: read-only, opening its catalog view.
function CollectionCard({
  collection,
  actions,
  cardRef,
  style,
  dragHandle,
}: {
  collection: Collection;
  actions?: CollectionCardActions;
  cardRef?: (node: HTMLElement | null) => void;
  style?: React.CSSProperties;
  dragHandle?: React.ReactNode;
}) {
  return (
    <Card
      ref={cardRef}
      style={style}
      className="surface-panel hover:border-primary group relative rounded-[1.6rem] border-0 transition-all hover:-translate-y-1"
    >
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div className="flex min-w-0 items-center gap-2">
          {dragHandle}
          <div className="min-w-0 space-y-2">
            <CardTitle className="text-base">
              <Link
                to={buildUserCollectionCatalogHref(collection.id, collection.name)}
                className="cursor-pointer after:absolute after:inset-0"
              >
                {collection.name}
              </Link>
            </CardTitle>
            <CollectionBadges collection={collection} showShared={actions !== undefined} />
          </div>
        </div>
        {actions ? (
          <div className="relative z-10 flex gap-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100">
            {actions.syncable ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                aria-label="Sync collection"
                disabled={actions.isSyncing}
                onClick={(event) => {
                  event.stopPropagation();
                  actions.onSync();
                }}
              >
                <RefreshCw className={`h-3 w-3 ${actions.isSyncing ? "animate-spin" : ""}`} />
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              aria-label="Edit collection"
              onClick={(event) => {
                event.stopPropagation();
                actions.onEdit();
              }}
            >
              <Pencil className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              aria-label="Delete collection"
              onClick={(event) => {
                event.stopPropagation();
                actions.onDelete();
              }}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ) : null}
      </CardHeader>
    </Card>
  );
}

const TYPE_LABELS: Record<UserCollectionType, string> = {
  manual: "manual",
  smart: "smart",
  mdblist: "MDBList",
  tmdb: "TMDB",
  trakt: "Trakt",
};

const TYPE_ICONS: Record<UserCollectionType, typeof Film> = {
  manual: Film,
  smart: Sparkles,
  mdblist: Globe,
  tmdb: Globe,
  trakt: Globe,
};

const SYNC_STATUS_BADGES: Partial<
  Record<
    NonNullable<Collection["last_sync_status"]>,
    { variant: "outline" | "destructive"; label: string }
  >
> = {
  warning: { variant: "outline", label: "Sync warning" },
  failed: { variant: "destructive", label: "Sync failed" },
};

function CollectionBadges({
  collection,
  showShared,
}: {
  collection: Collection;
  /** The Shared badge marks the profile's own shared collections. */
  showShared: boolean;
}) {
  const TypeIcon = TYPE_ICONS[collection.collection_type] ?? Film;
  const typeLabel = TYPE_LABELS[collection.collection_type] ?? collection.collection_type;
  const statusBadge = collection.last_sync_status
    ? SYNC_STATUS_BADGES[collection.last_sync_status]
    : undefined;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="secondary">
        <TypeIcon className="mr-1 h-3 w-3" />
        {typeLabel}
      </Badge>
      {showShared && collection.is_shared ? <Badge variant="outline">Shared</Badge> : null}
      {collection.sync_schedule ? (
        <Badge variant="outline">
          <Calendar className="mr-1 h-3 w-3" />
          {collection.sync_schedule}
        </Badge>
      ) : null}
      {statusBadge ? <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge> : null}
    </div>
  );
}
