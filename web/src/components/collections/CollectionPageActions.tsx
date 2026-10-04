import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Lock, MoreHorizontal, Pencil } from "lucide-react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useScopeDelete, useScopeSync } from "@/hooks/queries/collectionScope";
import { useAvailableUserLibraries } from "@/hooks/queries/libraries";
import type { CollectionPageAccess } from "@/hooks/useCollectionPageAccess";
import { PERSONAL_SCOPE, type CollectionScope, type EditorSnapshot } from "@/lib/collections/scope";
import { buildLibraryCollectionCatalogHref } from "@/pages/catalogSearchParams";

/** "by *Name* · Read-only" under the title of another profile's shared collection. */
export function CollectionByline({ access }: { access: CollectionPageAccess }) {
  if (access.kind !== "read-only" || !access.ownerName) return null;
  return (
    <p className="text-muted-foreground text-sm">
      by <span className="text-foreground font-medium">{access.ownerName}</span> ·{" "}
      <span>Read-only</span>
    </p>
  );
}

/** Shown when an editor link sent someone who can't change the collection to its page instead. */
export function ReadOnlyCollectionCallout({
  access,
  collectionName,
}: {
  access: CollectionPageAccess;
  collectionName: string;
}) {
  if (access.kind !== "read-only") return null;
  return (
    <div
      role="note"
      className="surface-panel text-muted-foreground flex items-start gap-3 rounded-2xl border-0 px-4 py-3 text-sm"
    >
      <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>
        Only {access.ownerName ?? "admins"} can change{" "}
        <strong className="text-foreground font-semibold">{collectionName}</strong>, so you're on
        its page instead.
      </p>
    </div>
  );
}

/** Edit + ⋯, top-right on a collection page, for viewers who may change the collection. */
export function CollectionPageActions({
  access,
  libraryId,
}: {
  access: CollectionPageAccess;
  libraryId?: number;
}) {
  if (access.kind !== "manage") return null;
  return (
    <ManageActions
      scope={access.scope}
      id={access.id}
      snapshot={access.snapshot}
      libraryId={libraryId}
    />
  );
}

function serverDeleteDescription(libraryNames: string[]) {
  if (libraryNames.length === 0) return "It's removed for everyone. This can't be undone.";
  const last = libraryNames[libraryNames.length - 1];
  const named =
    libraryNames.length === 1 ? last : `${libraryNames.slice(0, -1).join(", ")} and ${last}`;
  return `It's removed from ${named} for everyone. This can't be undone.`;
}

function personalDeleteDescription(shared: boolean) {
  return shared
    ? "It's removed for you and every profile you share it with. This can't be undone."
    : "This can't be undone.";
}

function ManageActions({
  scope,
  id,
  snapshot,
  libraryId,
}: {
  scope: CollectionScope;
  id: string;
  snapshot?: EditorSnapshot;
  libraryId?: number;
}) {
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { data: libraries } = useAvailableUserLibraries();
  const sync = useScopeSync(scope);
  const view = snapshot?.view;
  const isServer = scope.kind === "server";
  // After a delete, back to where the collection was browsed from.
  const browseLibraryId = libraryId ?? view?.libraryIds[0];
  const afterDeletePath =
    isServer && browseLibraryId
      ? `/library/${browseLibraryId}?tab=collections`
      : PERSONAL_SCOPE.paths.list();
  const remove = useScopeDelete(scope, {
    onDeleted: () => navigate(afterDeletePath, { replace: true }),
  });

  const namedLibraries = isServer
    ? (view?.libraryIds ?? []).flatMap((libraryID) => {
        const library = libraries?.find((entry) => entry.id === libraryID);
        return library ? [library] : [];
      })
    : [];
  const openIn = namedLibraries.length > 1 ? namedLibraries : [];
  const canSync = view?.kind === "synced";
  const deleteDescription = isServer
    ? serverDeleteDescription(namedLibraries.map((library) => library.name))
    : personalDeleteDescription(view?.personal?.shared ?? false);

  return (
    <div className="flex items-center gap-2">
      <Button asChild variant="outline" size="sm">
        <Link to={scope.paths.edit(id, { libraryId })}>
          <Pencil aria-hidden />
          Edit
        </Link>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="icon-sm" aria-label="More actions">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          {openIn.length > 0 ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Open in</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {openIn.map((library) => (
                  <DropdownMenuItem key={library.id} asChild>
                    <Link to={buildLibraryCollectionCatalogHref(id, view?.name, library.id)}>
                      {library.name}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
          {canSync ? (
            <DropdownMenuItem disabled={sync.isPending} onSelect={() => sync.mutate(id)}>
              {sync.isPending ? "Syncing…" : "Sync now"}
            </DropdownMenuItem>
          ) : null}
          {openIn.length > 0 || canSync ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem
            variant="destructive"
            disabled={!snapshot || remove.isPending}
            onSelect={() => setConfirmOpen(true)}
          >
            Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {snapshot ? (
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={`Delete "${snapshot.view.name}"?`}
          description={deleteDescription}
          confirmLabel="Delete"
          variant="destructive"
          isPending={remove.isPending}
          onConfirm={() => remove.mutate({ id, etag: snapshot.etag })}
        />
      ) : null}
    </div>
  );
}
