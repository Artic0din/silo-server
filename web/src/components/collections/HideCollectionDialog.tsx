import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  hideCollectionDescription,
  hideCollectionTitle,
  hideCollectionsDescription,
  hideCollectionsTitle,
} from "@/lib/collections/copy";

/**
 * Asks before hiding a server collection that Home or library page rows
 * show: the rows stay, but their See all can't open it while it's hidden.
 * Open it only when `rowCount` is above zero; with no rows, hide at once.
 * Select mode hides several at once: `count` is how many, and `rowCount`
 * the rows' total.
 */
export function HideCollectionDialog({
  open,
  onOpenChange,
  name,
  libraryNames,
  rowCount,
  count = 1,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  libraryNames: readonly string[];
  rowCount: number;
  count?: number;
  onConfirm: () => void;
}) {
  const several = count > 1;
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={several ? hideCollectionsTitle(count) : hideCollectionTitle(name)}
      description={
        several
          ? hideCollectionsDescription(rowCount)
          : hideCollectionDescription(libraryNames, rowCount)
      }
      confirmLabel="Hide"
      onConfirm={onConfirm}
    />
  );
}
