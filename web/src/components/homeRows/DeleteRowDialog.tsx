import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Confirms deleting one row for everyone. The row was read (with its version)
 * before this opened; a 412 keeps the dialog and asks for an explicit reload.
 */
export function DeleteRowDialog({
  rowTitle,
  pageLabel,
  open,
  conflict,
  busy,
  canConfirm,
  onConfirm,
  onReload,
  onOpenChange,
  onCloseAutoFocus,
}: {
  rowTitle: string;
  pageLabel: string;
  open: boolean;
  conflict: boolean;
  busy: boolean;
  canConfirm: boolean;
  onConfirm: () => void;
  onReload: () => void;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>Delete {rowTitle}?</DialogTitle>
          <DialogDescription>
            The row goes away from {pageLabel} for everyone. If Silo made a collection just for this
            row, it removes that collection too when nothing else uses it.
          </DialogDescription>
        </DialogHeader>
        {conflict ? (
          <p role="alert" className="text-sm">
            This row changed since you opened it. Reload it before deleting.
          </p>
        ) : null}
        <DialogFooter className="items-center sm:justify-between">
          <p className="text-muted-foreground text-sm">This can&apos;t be undone.</p>
          <div className="flex gap-2">
            <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {conflict ? (
              <Button disabled={busy} onClick={onReload}>
                Reload row
              </Button>
            ) : (
              <Button variant="destructive" disabled={busy || !canConfirm} onClick={onConfirm}>
                Delete row
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
