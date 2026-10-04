import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  /** Label for the dismiss button; change it when "Cancel" would read as the action. */
  cancelLabel?: string;
  variant?: "default" | "destructive";
  onConfirm: () => void;
  isPending?: boolean;
  /** What the action does, one line each, under the description. */
  bullets?: { label: string; items: string[] };
  /** Says "This can't be undone." beside the buttons. */
  irreversible?: boolean;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  onConfirm,
  isPending,
  bullets,
  irreversible = false,
}: ConfirmDialogProps) {
  const buttons = (
    <>
      <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
      <AlertDialogAction
        onClick={onConfirm}
        variant={variant === "destructive" ? "destructive" : "default"}
        disabled={isPending}
      >
        {isPending ? (
          <>
            <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            {confirmLabel}
          </>
        ) : (
          confirmLabel
        )}
      </AlertDialogAction>
    </>
  );
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {bullets && bullets.items.length > 0 ? (
          <ul aria-label={bullets.label} className="m-0 grid list-disc gap-1 pl-5 text-sm">
            {bullets.items.map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
        ) : null}
        {irreversible ? (
          <AlertDialogFooter className="items-center sm:justify-between">
            <p className="text-muted-foreground text-sm">This can&apos;t be undone.</p>
            <div className="flex gap-2">{buttons}</div>
          </AlertDialogFooter>
        ) : (
          <AlertDialogFooter>{buttons}</AlertDialogFooter>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
