import { MANUAL_ORDER_LINE } from "@/lib/collections/copy";

/** The last block of a Contents panel: how the titles are ordered. Manual is read-only here. */
export function OrderBlock() {
  return (
    <div className="border-border/70 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t pt-4">
      <h3 className="text-[14.5px] font-semibold">Order</h3>
      <p className="text-muted-foreground text-[13.5px]">{MANUAL_ORDER_LINE}</p>
    </div>
  );
}
