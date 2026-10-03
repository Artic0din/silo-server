import type { LibraryCollection } from "@/api/types";

// List-backed collections follow an MDBList, TMDB or legacy Trakt list, and
// only they can be synced: a manual collection has no list, and a smart one
// is filled from its rules whenever it is read.
export function isListBackedCollectionType(
  collectionType: LibraryCollection["collection_type"],
): boolean {
  return collectionType === "mdblist" || collectionType === "tmdb" || collectionType === "trakt";
}
