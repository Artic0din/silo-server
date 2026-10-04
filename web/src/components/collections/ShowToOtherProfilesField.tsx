import { useId } from "react";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * The one sharing switch of a personal collection (#1615): on, every profile
 * on the login sees it read-only; off, only its creator does.
 */
export function ShowToOtherProfilesField({
  checked,
  onCheckedChange,
  disabled = false,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="border-border flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
      <div>
        <Label htmlFor={id} className="text-sm font-medium">
          Show to other profiles
        </Label>
        <p id={`${id}-help`} className="text-muted-foreground mt-1 text-xs">
          Every profile on this login will see this collection. Titles a profile can&apos;t access
          stay hidden from it. Nobody else on the server can see it.
        </p>
      </div>
      <Switch
        id={id}
        aria-describedby={`${id}-help`}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </div>
  );
}
