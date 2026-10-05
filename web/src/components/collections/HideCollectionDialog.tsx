import { ConfirmDialog } from "@/components/ConfirmDialog";
import { hideCollectionDescription, hideCollectionTitle } from "@/lib/collections/copy";

/**
 * Asks before hiding a server collection that Home or library page rows
 * show: the rows stay, but their See all can't open it while it's hidden.
 * Open it only when `rowCount` is above zero; with no rows, hide at once.
 */
export function HideCollectionDialog({
  open,
  onOpenChange,
  name,
  libraryNames,
  rowCount,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  libraryNames: readonly string[];
  rowCount: number;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={hideCollectionTitle(name)}
      description={hideCollectionDescription(libraryNames, rowCount)}
      confirmLabel="Hide"
      onConfirm={onConfirm}
    />
  );
}
