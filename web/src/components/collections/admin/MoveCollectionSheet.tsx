import { useState } from "react";
import { Eye, EyeOff, Pencil } from "lucide-react";

import type { LibraryCollection } from "@/api/types";
import { Button } from "@/components/ui/button";
import { RadioCardItem, RadioGroup } from "@/components/ui/radio-group";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SHOW_ON_TAB_LABEL, arrangeHeading } from "@/lib/collections/copy";
import { sortedBy, type Shelf } from "@/lib/collections/shelves";

/**
 * Arrange on a phone has no drag: a card's ⋯ opens this sheet, "Move *name*",
 * with a radio per shelf. Arrow keys only pick; Move saves. Edit and the
 * Collections tab sit under the list so the sheet does what the menu would.
 */
export function MoveCollectionSheet({
  collection,
  libraryName,
  shelves,
  currentShelfId,
  canMove,
  visible,
  onMove,
  onEdit,
  onVisibleChange,
  onClose,
}: {
  collection: LibraryCollection;
  libraryName: string;
  shelves: readonly Shelf[];
  currentShelfId: string;
  canMove: boolean;
  visible: boolean;
  onMove: (shelfId: string) => void;
  onEdit: () => void;
  onVisibleChange: (visible: boolean) => void;
  onClose: () => void;
}) {
  const [shelfId, setShelfId] = useState(currentShelfId);
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="max-h-[85vh] gap-0 overflow-y-auto rounded-t-[22px]">
        <SheetHeader>
          <SheetTitle>Move {collection.title}</SheetTitle>
          <SheetDescription>{arrangeHeading(libraryName)}</SheetDescription>
        </SheetHeader>
        <RadioGroup
          aria-label="Shelf"
          value={shelfId}
          onValueChange={setShelfId}
          disabled={!canMove}
          className="gap-2 px-4"
        >
          {shelves.map((shelf) => (
            <RadioCardItem
              key={shelf.id}
              value={shelf.id}
              label={shelf.name}
              hint={
                shelf.id === currentShelfId
                  ? "Now here"
                  : sortedBy(shelf.sortMode)
                    ? `Sorted by ${sortedBy(shelf.sortMode)}`
                    : undefined
              }
              className="min-h-11"
            />
          ))}
        </RadioGroup>
        <SheetFooter className="gap-2">
          <Button
            size="lg"
            className="h-11"
            disabled={!canMove || shelfId === currentShelfId}
            onClick={() => {
              onMove(shelfId);
              onClose();
            }}
          >
            Move
          </Button>
          <div className="grid gap-2">
            <Button
              variant="outline"
              className="h-11"
              onClick={() => {
                onClose();
                onEdit();
              }}
            >
              <Pencil aria-hidden /> Edit collection
            </Button>
            <Button
              variant="outline"
              className="h-11"
              onClick={() => {
                onClose();
                onVisibleChange(!visible);
              }}
            >
              {visible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
              {visible ? "Hide from Collections tab" : SHOW_ON_TAB_LABEL}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
