import { useRef } from "react";
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
 * Confirms turning off "Let profiles add rule rows". The setting covers every
 * admin-only row kind (rule rows and Editor's picks). Profiles keep the rows
 * they have, but the server then refuses every change to a page holding one
 * until they delete it, so this asks first.
 */
export function RuleRowsOffDialog({
  open,
  busy,
  onConfirm,
  onOpenChange,
}: {
  open: boolean;
  busy: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  // Without a Radix trigger, focus would land on the page body on close; it
  // goes back to whatever had it when the dialog opened (More).
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent
        onOpenAutoFocus={() => {
          const active = document.activeElement;
          returnFocus.current = active instanceof HTMLElement ? active : null;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus.current?.focus();
          returnFocus.current = null;
        }}
      >
        <DialogHeader>
          <DialogTitle>Turn off rule rows for profiles?</DialogTitle>
          <DialogDescription>
            Profiles that already have rule rows or Editor&apos;s picks rows keep them, but
            can&apos;t change that page until they delete them.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={onConfirm}>
            Turn off
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
