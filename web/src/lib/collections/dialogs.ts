import { PERSONAL_SCOPE, SERVER_SCOPE, type ScopeKind } from "./scope";

/** `?dialog=new` on a collections list opens the New collection picker, so a link can open it. */
export const NEW_COLLECTION_DIALOG = "new";

/** `?dialog=starter-packs` on the server list opens Starter packs. */
export const STARTER_PACKS_DIALOG = "starter-packs";

function withDialog(path: string, dialog: string) {
  return `${path}${path.includes("?") ? "&" : "?"}dialog=${dialog}`;
}

/** The collections list with the New collection picker open over it. */
export function newCollectionPickerHref(scope: ScopeKind, libraryId?: number | null) {
  const list = (scope === "server" ? SERVER_SCOPE : PERSONAL_SCOPE).paths.list({ libraryId });
  return withDialog(list, NEW_COLLECTION_DIALOG);
}

/** The server list with Starter packs open over it. */
export function starterPacksHref(libraryId?: number | null) {
  return withDialog(SERVER_SCOPE.paths.list({ libraryId }), STARTER_PACKS_DIALOG);
}
