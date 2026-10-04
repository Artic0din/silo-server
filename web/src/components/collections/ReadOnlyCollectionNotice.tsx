/** Shown on another profile's collection: only its creator can change it. */
export function ReadOnlyCollectionNotice({ ownerName }: { ownerName?: string | null }) {
  return (
    <div className="text-muted-foreground rounded-md border px-3 py-2 text-sm">
      {ownerName
        ? `Only ${ownerName} can edit this collection.`
        : "Only the creator can edit this collection."}
    </div>
  );
}
