import { MetaDot } from "@/components/calm/ListRow";

/** "Movies, Kids · 23 titles" under a collection's name. */
export function CollectionMetaLine({
  libraryNames,
  itemCount,
}: {
  libraryNames?: readonly string[];
  itemCount: number;
}) {
  return (
    <p className="text-muted-foreground text-[14px]">
      {libraryNames && libraryNames.length > 0 ? (
        <>
          <b className="text-foreground font-semibold">{libraryNames.join(", ")}</b>
          <MetaDot />
        </>
      ) : null}
      {`${itemCount} title${itemCount === 1 ? "" : "s"}`}
    </p>
  );
}
