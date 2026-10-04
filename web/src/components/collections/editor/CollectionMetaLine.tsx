import { Fragment } from "react";

import { MetaDot } from "@/components/calm/ListRow";

/**
 * "Movies, Kids · 23 titles" under a collection's name; a Smart collection
 * says "Updates itself as titles are added" instead of a count.
 */
export function CollectionMetaLine({
  libraryNames,
  itemCount,
  extra,
}: {
  libraryNames?: readonly string[];
  itemCount?: number;
  extra?: string;
}) {
  const parts = [
    itemCount === undefined ? null : `${itemCount} title${itemCount === 1 ? "" : "s"}`,
    extra ?? null,
  ].filter((part): part is string => part !== null);
  const names = libraryNames && libraryNames.length > 0 ? libraryNames.join(", ") : null;
  return (
    <p className="text-muted-foreground text-[14px]">
      {names ? <b className="text-foreground font-semibold">{names}</b> : null}
      {parts.map((part, index) => (
        <Fragment key={part}>
          {names || index > 0 ? <MetaDot /> : null}
          {part}
        </Fragment>
      ))}
    </p>
  );
}
