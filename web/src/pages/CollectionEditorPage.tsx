import { lazy, Suspense, useState } from "react";
import { Navigate, useLocation, useParams, useSearchParams } from "react-router";
import { ListPlus, ListFilter, RefreshCw } from "lucide-react";

import { isNotFoundProblem } from "@/api/v2/request";
import PageBack from "@/components/PageBack";
import PageUnavailable from "@/components/PageUnavailable";
import ViewTransitionLink from "@/components/ViewTransitionLink";
import { CollectionEditorShell } from "@/components/collections/editor/CollectionEditorShell";
import { CollectionEditor } from "@/components/collections/editor/CollectionEditor";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useScopeEditor } from "@/hooks/queries/collectionScope";
import { useCollectionCapabilities } from "@/hooks/queries/collections";
import { useCurrentProfile } from "@/hooks/useCurrentProfile";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { SYNCED_OFF } from "@/lib/collections/copy";
import {
  PERSONAL_SCOPE,
  SERVER_SCOPE,
  type CollectionScope,
  type CreateKind,
  type ScopeKind,
} from "@/lib/collections/scope";
import type { SyncedTab } from "@/lib/collections/synced";

// The server create chooser loads on its own, so a profile never downloads it.
const AdminCollectionEditor = lazy(() => import("./AdminCollectionEditor"));

const CREATE_KINDS: readonly CreateKind[] = ["manual", "smart", "synced"];
const SYNCED_TABS: readonly SyncedTab[] = ["mdblist", "tmdb_chart", "tmdb_list"];

/** The collection's page with the lock callout, for someone who can't change it. */
function readOnlyHref(href: string) {
  return `${href}${href.includes("?") ? "&" : "?"}notice=read-only`;
}

/** Header and panels in their final places while the collection loads; no save bar. */
function EditorSkeleton() {
  const panel = (rows: number) => (
    <div className="surface-panel grid gap-4 rounded-[22px] p-5 sm:p-6">
      <Skeleton className="h-5 w-28" />
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-11 rounded-xl" />
      ))}
    </div>
  );
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading collection editor…</span>
      <CollectionEditorShell
        createMode={false}
        contentsLabel="Titles"
        header={
          <div aria-hidden className="grid gap-4">
            <Skeleton className="h-4 w-24" />
            <div className="flex items-end gap-5">
              <Skeleton className="aspect-[2/3] w-16 rounded-[10px]" />
              <div className="grid flex-1 gap-2">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-8 w-2/3" />
                <Skeleton className="h-4 w-40" />
              </div>
            </div>
          </div>
        }
        contents={panel(5)}
        details={panel(3)}
        where={panel(2)}
      />
    </div>
  );
}

/**
 * Every collection editor URL, both scopes: `/new?type=…[&source=…]` and
 * `/:id/edit`. Mounted once per family by a pathless route, so it stays the
 * same page from `/new` to `/:id/edit` after Create. Every type opens the
 * same editor, create and edit. Someone who can't change the collection is
 * sent to its page instead of a form.
 */
export default function CollectionEditorPage({ scope: scopeKind }: { scope: ScopeKind }) {
  const scope = (scopeKind === "server" ? SERVER_SCOPE : PERSONAL_SCOPE) as CollectionScope;
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const libraryId = Number(searchParams.get("libraryId")) || null;
  const type = CREATE_KINDS.find((kind) => kind === searchParams.get("type"));
  const createKind = type ?? "manual";
  const source = SYNCED_TABS.find((tab) => tab === searchParams.get("source"));
  const location = useLocation();
  // The collection the create editor made, its kind, and the visit it was made
  // on: the editor carries on at its edit URL. Any other visit starts a fresh one.
  const [created, setCreated] = useState<{
    round: number;
    id?: string;
    visit?: string;
    kind?: CreateKind;
  }>({ round: 0 });
  if (created.id && (id ? id !== created.id : location.key !== created.visit)) {
    setCreated({ round: created.round + 1 });
  }
  const carriedOn = Boolean(id) && id === created.id;
  const editor = useScopeEditor(scope, carriedOn ? undefined : id);
  const { profile, isLoading: profileLoading } = useCurrentProfile();
  const listPath = scope.paths.list({ libraryId });

  if ((!id && type) || carriedOn) {
    const kind = carriedOn ? created.kind : createKind;
    return (
      <CollectionEditor
        key={`new-${created.round}-${kind}`}
        scope={scope}
        kind={kind}
        libraryId={libraryId}
        syncedTab={source}
        onCreated={(newId) =>
          setCreated({ ...created, id: newId, visit: location.key, kind: createKind })
        }
      />
    );
  }
  if (!id) {
    return (
      <Suspense fallback={<EditorSkeleton />}>
        <LegacyCreate scope={scopeKind} libraryId={libraryId} />
      </Suspense>
    );
  }

  const { snapshot } = editor;
  if (!snapshot) {
    if (editor.isLoading) return <EditorSkeleton />;
    if (editor.error && !isNotFoundProblem(editor.error)) {
      return (
        <PageUnavailable
          title="Couldn't load this collection"
          description="Something went wrong while loading it. Try again in a moment."
          onRetry={() => void editor.refetch()}
          retrying={editor.isFetching}
        />
      );
    }
    return <CollectionNotFound scope={scopeKind} listPath={listPath} />;
  }

  // Ownership fails closed while the profile is unknown, so wait for it.
  if (scopeKind === "personal" && !profile && profileLoading) return <EditorSkeleton />;
  if (scope.isReadOnly(snapshot.view, profile?.id)) {
    return <Navigate replace to={readOnlyHref(scope.paths.browse(snapshot.view))} />;
  }

  return <CollectionEditor key={snapshot.view.id} scope={scope} snapshot={snapshot} />;
}

function CollectionNotFound({ scope, listPath }: { scope: ScopeKind; listPath: string }) {
  useDocumentTitle("Not found");
  return (
    <PageUnavailable
      title={scope === "server" ? "Collection not found" : "This collection isn't available"}
      description={
        scope === "server"
          ? "It may have been deleted, or the link may be wrong."
          : "It may have been deleted, or you may not have access to it."
      }
    >
      <Button asChild variant="outline">
        <ViewTransitionLink to={listPath} up>
          All collections
        </ViewTransitionLink>
      </Button>
    </PageUnavailable>
  );
}

/** Create without a type: today's choosers, whose Manual and Smart choices open the editor page. */
function LegacyCreate({ scope, libraryId }: { scope: ScopeKind; libraryId: number | null }) {
  if (scope === "server") return <AdminCollectionEditor initialLibraryId={libraryId} />;
  return <PersonalTypeChooser />;
}

const PERSONAL_TYPES = [
  { type: "manual", icon: ListPlus, label: "Manual", description: "Pick the titles yourself." },
  { type: "smart", icon: ListFilter, label: "Smart", description: "Match titles with rules." },
  {
    type: "synced",
    icon: RefreshCw,
    label: "Synced list",
    description: "Follow a list from MDBList or TMDB.",
  },
] as const;

const CARD =
  "border-border flex h-full flex-col items-start gap-3 rounded-2xl border p-5 text-left transition-colors outline-none";

/** A new personal collection: Manual, Smart or Synced list, each opening the editor page. */
function PersonalTypeChooser() {
  useDocumentTitle("New collection");
  const listPath = PERSONAL_SCOPE.paths.list();
  const { data: capabilities } = useCollectionCapabilities();
  const syncedOff = capabilities !== undefined && capabilities.import_sources.length === 0;
  return (
    <div className="page-shell relative space-y-6 py-4 sm:py-6">
      <PageBack to={listPath} up />
      <div className="mt-10 sm:mt-12">
        <h1 className="page-title text-[clamp(2rem,4vw,3rem)]">New collection</h1>
        <p className="page-subtitle mt-1 text-sm sm:text-base">
          Next: name it and fill it in, on its own page.
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-3">
        {PERSONAL_TYPES.map(({ type, icon: Icon, label, description }) => {
          const off = type === "synced" && syncedOff;
          const body = (
            <>
              <Icon aria-hidden className="text-muted-foreground size-7" />
              <span id={`new-${type}-label`} className="text-sm font-medium">
                {label}
              </span>
              <span id={`new-${type}-help`} className="text-muted-foreground -mt-2 text-xs">
                {off ? SYNCED_OFF : description}
              </span>
            </>
          );
          return (
            <li key={type}>
              {off ? (
                <div className={`${CARD} opacity-60`}>{body}</div>
              ) : (
                <ViewTransitionLink
                  to={PERSONAL_SCOPE.paths.create({ type })}
                  aria-labelledby={`new-${type}-label`}
                  aria-describedby={`new-${type}-help`}
                  className={`${CARD} hover:border-primary hover:bg-accent focus-visible:ring-ring/50 focus-visible:ring-[3px]`}
                >
                  {body}
                </ViewTransitionLink>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
