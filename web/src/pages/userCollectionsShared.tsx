import { buildUserCollectionCatalogHref as buildCatalogHrefForUserCollection } from "@/pages/catalogSearchParams";

export function buildUserCollectionCatalogHref(id: string, title?: string) {
  return buildCatalogHrefForUserCollection(id, title);
}
