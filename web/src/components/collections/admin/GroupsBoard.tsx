import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Ellipsis, GripVertical, Plus } from "lucide-react";

import {
  adminMutationMessage,
  fetchAdminBoardOrderSnapshot,
  fetchAdminGroupCollectionOrderSnapshot,
  fetchAdminGroupOrderSnapshot,
  fetchAdminGroupSnapshot,
} from "@/api/adminCollections";
import type { GroupSortMode, LibraryCollection } from "@/api/types";
import { Button } from "@/components/ui/button";
import { useAdminCollectionCapabilities } from "@/hooks/queries/admin/collections";
import {
  useCreateCollectionGroup,
  useDeleteCollectionGroup,
  useReorderCollectionGroups,
  useReorderCollectionsInGroup,
  useUpdateCollectionGroup,
} from "@/hooks/queries/admin/collectionGroups";
import { invalidateAdminCollectionQueries } from "@/hooks/queries/collectionSurfaceRefresh";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import {
  ARRANGE_HINT,
  ARRANGE_SUBTITLE,
  MOVE_FAILED,
  arrangeHeading,
} from "@/lib/collections/copy";
import {
  UNGROUPED,
  acceptsCollections,
  applyCollectionMove,
  applyShelfMove,
  boardShelves,
  planCollectionMove,
  planShelfMove,
  shelfOf,
  shownCollections,
  type BoardGroup,
  type CollectionMove,
  type Shelf,
} from "@/lib/collections/shelves";
import { CollectionListItem } from "./CollectionListItem";
import { GroupCard, type ArrangeDragData, type SortableCardProps } from "./GroupCard";
import { MoveCollectionSheet } from "./MoveCollectionSheet";
import { DeleteShelfDialog, ShelfNameDialog } from "./ShelfDialogs";
import { ArrangeCardMenu, ShelfMenu } from "./ShelfMenus";
import { ViewerPreview } from "./ViewerPreview";

/** Under this width Arrange has no drag: ⋯ opens a sheet that moves the card. */
const NARROW_QUERY = "(max-width: 1023px)";

const SCREEN_READER_INSTRUCTIONS =
  "To move a shelf or a collection, focus its handle and press Space or Enter. Use the arrow keys to move it, Space or Enter to drop it, or Escape to cancel. Every collection's ⋯ also has Move to shelf.";

type OrderReads = Awaited<ReturnType<typeof fetchAdminBoardOrderSnapshot>>;

function sameIds(actual: readonly string[], expected: readonly string[]) {
  return actual.length === expected.length && actual.every((id, index) => id === expected[index]);
}

/** The order reads describe these shelves exactly, so a move can be checked against them. */
function readsMatch(reads: OrderReads, shelves: readonly Shelf[]) {
  return (
    !reads.groupOrder.has_more &&
    sameIds(
      reads.groupOrder.ordered_ids,
      shelves.map((shelf) => shelf.id),
    ) &&
    shelves.every((shelf) => {
      const order = reads.collectionOrders.get(shelf.id);
      return (
        order !== undefined &&
        !order.has_more &&
        sameIds(
          order.ordered_ids,
          shelf.collections.map((entry) => entry.id),
        )
      );
    })
  );
}

/** A collection drag only meets cards and shelf bodies; a shelf drag only meets shelves. */
const collision: CollisionDetection = (args) => {
  const shelfDrag = (args.active.data.current as ArrangeDragData | undefined)?.kind === "shelf";
  return closestCenter({
    ...args,
    droppableContainers: args.droppableContainers.filter(
      (container) => String(container.id).startsWith("shelf:") === shelfDrag,
    ),
  });
};

export interface GroupsBoardProps {
  libraryID: number;
  libraryName: string;
  groups: BoardGroup[];
  ungrouped: LibraryCollection[];
  ungroupedSortOrder: number;
  /** The Collections tab state, which may run ahead of the saved visibility. */
  isVisible: (collection: LibraryCollection) => boolean;
  onEditCollection: (collection: LibraryCollection) => void;
  /** The page asks first when rows show a collection being hidden. */
  onVisibleChange: (collection: LibraryCollection, visible: boolean) => void;
}

/**
 * Arrange: one library's shelves top to bottom, the way viewers see them,
 * beside a preview of its Collections tab. Every change saves right away and
 * shows at once; a move that fails goes back and offers Try again. Drags are
 * checked against the order read when the board loaded, so a move never
 * lands on an order someone else changed in the meantime. Phones have no
 * drag: a card's ⋯ opens a sheet that moves it.
 */
export function GroupsBoard({
  libraryID,
  libraryName,
  groups,
  ungrouped,
  ungroupedSortOrder,
  isVisible,
  onEditCollection,
  onVisibleChange,
}: GroupsBoardProps) {
  const queryClient = useQueryClient();
  const narrow = useMediaQuery(NARROW_QUERY);
  const { data: capabilities } = useAdminCollectionCapabilities();
  const canEdit = capabilities?.groups === true;

  const saved = useMemo(
    () => boardShelves(groups, ungrouped, ungroupedSortOrder),
    [groups, ungrouped, ungroupedSortOrder],
  );
  // A change shows at once: the board draws `shelves` until the change has
  // saved and the shelves were read again (or it failed and went back).
  const [pending, setPending] = useState<{ base: Shelf[]; shelves: Shelf[] } | null>(null);
  const shelves = pending?.base === saved ? pending.shelves : saved;
  const changing = pending?.base === saved;

  const orderReads = useQuery({
    queryKey: [
      "admin",
      "collections",
      "order-snapshots",
      libraryID,
      saved.map((shelf) => [shelf.id, shelf.collections.map((entry) => entry.id)]),
    ],
    enabled: canEdit,
    queryFn: () =>
      fetchAdminBoardOrderSnapshot(
        libraryID,
        groups.map((group) => group.id),
      ),
  });
  const hasMore =
    orderReads.data !== undefined &&
    (orderReads.data.groupOrder.has_more ||
      [...orderReads.data.collectionOrders.values()].some((order) => order.has_more));
  const dragDisabled =
    !canEdit || narrow || !orderReads.data || orderReads.isError || hasMore || changing;

  const createGroup = useCreateCollectionGroup(libraryID);
  const updateGroup = useUpdateCollectionGroup();
  const deleteGroup = useDeleteCollectionGroup();
  const reorderGroups = useReorderCollectionGroups(libraryID);
  const reorderCollections = useReorderCollectionsInGroup(libraryID);

  const [naming, setNaming] = useState<
    { mode: "create" } | { mode: "rename"; shelf: Shelf } | null
  >(null);
  const [deleting, setDeleting] = useState<Shelf | null>(null);
  const [moving, setMoving] = useState<LibraryCollection | null>(null);

  // --- saving ----------------------------------------------------------------

  /** Shows `next` until `save` settles; a failure puts the board back. */
  async function change(next: Shelf[], save: () => Promise<unknown>) {
    setPending({ base: saved, shelves: next });
    try {
      await save();
    } finally {
      setPending(null);
    }
  }

  function moveFailed(retry: () => Promise<unknown>) {
    toast.error(MOVE_FAILED, {
      action: {
        label: "Try again",
        onClick: () => void retry().catch(() => moveFailed(retry)),
      },
    });
  }

  /** Saves a collection's new shelf order. Without an ETag from a drag's reads, it reads a fresh one. */
  function saveCollectionMove(collectionId: string, plan: CollectionMove, etag?: string) {
    const send = async (tag?: string) =>
      reorderCollections.mutateAsync({
        groupID: plan.shelfId,
        orderedIDs: plan.orderedIds,
        etag: tag ?? (await fetchAdminGroupCollectionOrderSnapshot(plan.shelfId, libraryID)).etag,
        ...(plan.shelfId === UNGROUPED ? { libraryId: libraryID } : {}),
      });
    void change(applyCollectionMove(shelves, collectionId, plan), () => send(etag)).catch(() =>
      moveFailed(() => send()),
    );
  }

  function saveShelfOrder(orderedIds: string[], etag?: string) {
    const send = async (tag?: string) =>
      reorderGroups.mutateAsync({
        orderedIDs: orderedIds,
        etag: tag ?? (await fetchAdminGroupOrderSnapshot(libraryID)).etag,
      });
    void change(applyShelfMove(shelves, orderedIds), () => send(etag)).catch(() =>
      moveFailed(() => send()),
    );
  }

  /** A shelf's ETag, read fresh before each change to it; a failed read says so. */
  async function shelfETag(id: string) {
    try {
      return (await fetchAdminGroupSnapshot(id)).etag;
    } catch (error) {
      toast.error(adminMutationMessage(error, "Couldn't read the shelf"));
      throw error;
    }
  }

  async function patchShelf(
    id: string,
    patch: { name?: string; default_sort_mode?: GroupSortMode },
  ) {
    await updateGroup.mutateAsync({ id, etag: await shelfETag(id), ...patch });
  }

  function changeSort(shelf: Shelf, mode: GroupSortMode) {
    void change(
      shelves.map((entry) => (entry.id === shelf.id ? { ...entry, sortMode: mode } : entry)),
      () => patchShelf(shelf.id, { default_sort_mode: mode }),
    ).catch(() => undefined);
  }

  async function removeShelf(shelf: Shelf) {
    await deleteGroup.mutateAsync({ id: shelf.id, etag: await shelfETag(shelf.id) });
  }

  function moveToShelf(collection: LibraryCollection, shelfId: string) {
    const plan = planCollectionMove(shelves, collection.id, shelfId, null);
    if (plan) saveCollectionMove(collection.id, plan);
  }

  // --- dragging --------------------------------------------------------------

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );
  const [drag, setDrag] = useState<{ data: ArrangeDragData; reads: OrderReads } | null>(null);
  // dnd-kit reports the item as over itself right after pickup; only a change is announced.
  const lastOver = useRef<UniqueIdentifier | null>(null);

  function onDragStart(event: DragStartEvent) {
    const data = event.active.data.current as ArrangeDragData | undefined;
    const reads = orderReads.data;
    if (!data || !reads) return;
    if (!readsMatch(reads, saved)) {
      toast.error("Collection order is not ready or changed. Reload before reordering.");
      void invalidateAdminCollectionQueries(queryClient);
      void orderReads.refetch();
      return;
    }
    setDrag({ data, reads });
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const started = drag;
    setDrag(null);
    if (!started || !over || active.id === over.id) return;
    const target = over.data.current as ArrangeDragData | undefined;
    if (!target) return;
    const { data, reads } = started;
    if (data.kind === "shelf") {
      if (target.kind !== "shelf") return;
      const to = saved.findIndex((shelf) => shelf.id === target.id);
      const order = planShelfMove(saved, data.id, to);
      if (order) saveShelfOrder(order, reads.groupOrder.etag);
      return;
    }
    if (data.kind !== "collection") return;
    const shelfId = target.kind === "shelf" ? target.id : target.shelfId;
    const plan = planCollectionMove(
      saved,
      data.id,
      shelfId,
      target.kind === "collection" ? target.id : null,
    );
    if (plan) saveCollectionMove(data.id, plan, reads.collectionOrders.get(plan.shelfId)?.etag);
  }

  const announcements = useMemo<Announcements>(() => {
    // Drag ids are "col:<id>", "shelf:<id>" or "body:<id>".
    const bare = (id: UniqueIdentifier) => String(id).replace(/^(col|shelf|body):/, "");
    const shelfById = (id: UniqueIdentifier) => shelves.find((entry) => entry.id === bare(id));
    const collectionAt = (id: UniqueIdentifier) => {
      const shelf = shelfOf(shelves, bare(id));
      if (!shelf) return null;
      const shown = shownCollections(shelf);
      const index = shown.findIndex((entry) => entry.id === bare(id));
      return { title: shown[index]!.title, shelf, index, count: shown.length };
    };
    const name = (id: UniqueIdentifier): string => {
      if (String(id).startsWith("col:")) return collectionAt(id)?.title ?? "Collection";
      const shelf = shelfById(id);
      return shelf ? `shelf ${shelf.name}` : "Shelf";
    };
    const place = (id: UniqueIdentifier): string => {
      const text = String(id);
      if (text.startsWith("col:")) {
        const at = collectionAt(id);
        return at ? `position ${at.index + 1} of ${at.count} on ${at.shelf.name}` : "";
      }
      if (text.startsWith("body:")) return `the end of ${shelfById(id)?.name ?? "the shelf"}`;
      const index = shelves.findIndex((entry) => entry.id === bare(id));
      return `position ${index + 1} of ${shelves.length}`;
    };
    const refused = (active: UniqueIdentifier, over: UniqueIdentifier) => {
      if (!String(active).startsWith("col:")) return false;
      const shelf = shelfById(over);
      return shelf !== undefined && !acceptsCollections(shelf);
    };
    return {
      onDragStart: ({ active }) => {
        lastOver.current = active.id;
        return `Picked up ${name(active.id)}, ${place(active.id)}.`;
      },
      onDragOver: ({ active, over }) => {
        if (!over || over.id === lastOver.current) return undefined;
        lastOver.current = over.id;
        if (refused(active.id, over.id))
          return `${name(active.id)} can't go on My collections. It holds viewers' own collections.`;
        return `${name(active.id)} is over ${place(over.id)}.`;
      },
      onDragEnd: ({ active, over }) =>
        over && !refused(active.id, over.id)
          ? `${name(active.id)} dropped at ${place(over.id)}.`
          : `${name(active.id)} dropped. Nothing moved.`,
      onDragCancel: ({ active }) => `Moving ${name(active.id)} was canceled.`,
    };
  }, [shelves]);

  // --- rendering -------------------------------------------------------------

  const takers = shelves.filter(acceptsCollections);
  const collectionDrag = drag?.data.kind === "collection";
  const shelfDrag = drag?.data.kind === "shelf";

  function card(collection: LibraryCollection, shelf: Shelf, sortable: SortableCardProps) {
    const visible = isVisible(collection);
    const menu = narrow ? (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`More for ${collection.title}`}
        className="text-muted-foreground size-11 rounded-[10px]"
        onClick={() => setMoving(collection)}
      >
        <Ellipsis className="size-4" />
      </Button>
    ) : (
      <ArrangeCardMenu
        name={collection.title}
        shelves={takers}
        currentShelfId={shelf.id}
        canMove={canEdit && !changing}
        visible={visible}
        onEdit={() => onEditCollection(collection)}
        onMove={(shelfId) => moveToShelf(collection, shelfId)}
        onVisibleChange={(next) => onVisibleChange(collection, next)}
      />
    );
    return (
      <CollectionListItem
        variant="compact"
        collection={collection}
        visible={visible}
        handleProps={sortable.handleProps}
        ref={sortable.ref}
        style={sortable.style}
        dragging={sortable.dragging}
        menu={menu}
        onOpen={() => onEditCollection(collection)}
      />
    );
  }

  const movingShelf = moving ? shelfOf(shelves, moving.id) : undefined;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px] xl:items-start">
      <div className="grid min-w-0 gap-3">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-[16px] font-semibold tracking-[-0.015em]">
              {arrangeHeading(libraryName)}
            </h2>
            <p className="text-muted-foreground m-0 mt-0.5 text-[13px]">{ARRANGE_SUBTITLE}</p>
          </div>
          {canEdit ? (
            <Button variant="outline" size="sm" onClick={() => setNaming({ mode: "create" })}>
              <Plus aria-hidden /> New shelf
            </Button>
          ) : null}
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={collision}
          accessibility={{
            announcements,
            screenReaderInstructions: { draggable: SCREEN_READER_INSTRUCTIONS },
          }}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDrag(null)}
        >
          <SortableContext
            items={shelves.map((shelf) => `shelf:${shelf.id}`)}
            strategy={verticalListSortingStrategy}
          >
            <div className="grid gap-3">
              {shelves.map((shelf, index) => (
                <GroupCard
                  key={shelf.id}
                  shelf={shelf}
                  collapsed={shelfDrag}
                  dragDisabled={dragDisabled}
                  showGrips={!narrow}
                  noDrop={collectionDrag}
                  orderDisabled={!canEdit || changing}
                  onSortChange={(mode) => changeSort(shelf, mode)}
                  menu={
                    shelf.kind === "ungrouped" ? null : (
                      <ShelfMenu
                        shelf={shelf}
                        isFirst={index === 0}
                        isLast={index === shelves.length - 1}
                        disabled={!canEdit || changing}
                        onRename={() => setNaming({ mode: "rename", shelf })}
                        onMove={(to) => {
                          const order = planShelfMove(
                            shelves,
                            shelf.id,
                            to === "top" ? 0 : Infinity,
                          );
                          if (order) saveShelfOrder(order);
                        }}
                        onDelete={() => setDeleting(shelf)}
                      />
                    )
                  }
                  renderCard={(collection, sortable) => card(collection, shelf, sortable)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {narrow ? null : (
          <p className="text-muted-foreground m-0 flex items-start gap-2 px-1 text-[13px] leading-normal">
            <GripVertical aria-hidden className="mt-0.5 size-4 shrink-0" />
            {ARRANGE_HINT}
          </p>
        )}
      </div>

      {narrow ? null : (
        <ViewerPreview
          libraryName={libraryName}
          shelves={shelves}
          isVisible={isVisible}
          className="xl:sticky xl:top-6"
        />
      )}

      {naming ? (
        <ShelfNameDialog
          mode={naming.mode}
          libraryName={libraryName}
          initialName={naming.mode === "rename" ? naming.shelf.name : ""}
          onSave={async (name) => {
            if (naming.mode === "create") await createGroup.mutateAsync({ name });
            else await patchShelf(naming.shelf.id, { name });
          }}
          onClose={() => setNaming(null)}
        />
      ) : null}

      {deleting ? (
        <DeleteShelfDialog
          name={deleting.name}
          collectionCount={deleting.collections.length}
          libraryName={libraryName}
          onConfirm={() => void removeShelf(deleting).catch(() => undefined)}
          onClose={() => setDeleting(null)}
        />
      ) : null}

      {moving && movingShelf ? (
        <MoveCollectionSheet
          collection={moving}
          libraryName={libraryName}
          shelves={takers}
          currentShelfId={movingShelf.id}
          canMove={canEdit && !changing}
          visible={isVisible(moving)}
          onMove={(shelfId) => moveToShelf(moving, shelfId)}
          onEdit={() => onEditCollection(moving)}
          onVisibleChange={(next) => onVisibleChange(moving, next)}
          onClose={() => setMoving(null)}
        />
      ) : null}
    </div>
  );
}
