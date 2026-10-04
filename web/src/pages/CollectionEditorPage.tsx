import { lazy, Suspense, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { ListPlus, ListFilter } from "lucide-react";

import type { Collection, LibraryCollection } from "@/api/types";
import { isNotFoundProblem } from "@/api/v2/request";
import PageBack from "@/components/PageBack";
import PageUnavailable from "@/components/PageUnavailable";
import ViewTransitionLink from "@/components/ViewTransitionLink";
import { CollectionEditorShell } from "@/components/collections/editor/CollectionEditorShell";
import { CollectionEditor } from "@/components/collections/editor/CollectionEditor";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useScopeEditor } from "@/hooks/queries/collectionScope";
import { useCurrentProfile } from "@/hooks/useCurrentProfile";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import {
  PERSONAL_SCOPE,
  SERVER_SCOPE,
  type CollectionScope,
  type EditorSnapshot,
  type ScopeKind,
} from "@/lib/collections/scope";

// The earlier editors load on their own, so each scope downloads only its own.
const AdminCollectionEditor = lazy(() => import("./AdminCollectionEditor"));
const ImportedCollectionEditor = lazy(() =>
  import("./ImportedCollectionEditor").then((module) => ({
    default: module.ImportedCollectionEditor,
  })),
);

const EDITOR_KINDS = new Set(["manual", "smart"]);

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
 * Every collection editor URL, both scopes: `/new?type=…` and `/:id/edit`.
 * Mounted once per family by a pathless route, so it stays the same page from
 * `/new` to `/:id/edit` after Create. Manual and Smart collections open the
 * editor page; Synced lists keep their earlier editors inside it for now. Someone
 * who can't change the collection is sent to its page instead of a form.
 */
export default function CollectionEditorPage({ scope: scopeKind }: { scope: ScopeKind }) {
  const scope = (scopeKind === "server" ? SERVER_SCOPE : PERSONAL_SCOPE) as CollectionScope;
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const libraryId = Number(searchParams.get("libraryId")) || null;
  const type = searchParams.get("type");
  const createKind = type === "smart" ? "smart" : "manual";
  const location = useLocation();
  // The collection the create editor made, its kind, and the visit it was made
  // on: the editor carries on at its edit URL. Any other visit starts a fresh one.
  const [created, setCreated] = useState<{
    round: number;
    id?: string;
    visit?: string;
    kind?: "manual" | "smart";
  }>({ round: 0 });
  if (created.id && (id ? id !== created.id : location.key !== created.visit)) {
    setCreated({ round: created.round + 1 });
  }
  const carriedOn = Boolean(id) && id === created.id;
  const editor = useScopeEditor(scope, carriedOn ? undefined : id);
  const { profile, isLoading: profileLoading } = useCurrentProfile();
  const listPath = scope.paths.list({ libraryId });

  if ((!id && type && EDITOR_KINDS.has(type)) || carriedOn) {
    const kind = carriedOn ? created.kind : createKind;
    return (
      <CollectionEditor
        key={`new-${created.round}-${kind}`}
        scope={scope}
        kind={kind}
        libraryId={libraryId}
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

  if (snapshot.view.kind !== "synced") {
    return <CollectionEditor key={snapshot.view.id} scope={scope} snapshot={snapshot} />;
  }
  return (
    <Suspense fallback={<EditorSkeleton />}>
      {scopeKind === "server" ? (
        <AdminCollectionEditor
          snapshot={snapshot as EditorSnapshot<LibraryCollection>}
          initialLibraryId={libraryId}
        />
      ) : (
        <LegacyPersonalEditor snapshot={snapshot as EditorSnapshot<Collection>} />
      )}
    </Suspense>
  );
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
] as const;

/** A new personal collection: Manual or Smart, each opening the editor page. */
function PersonalTypeChooser() {
  useDocumentTitle("New collection");
  const listPath = PERSONAL_SCOPE.paths.list();
  return (
    <div className="page-shell relative space-y-6 py-4 sm:py-6">
      <PageBack to={listPath} up />
      <div className="mt-10 sm:mt-12">
        <h1 className="page-title text-[clamp(2rem,4vw,3rem)]">New collection</h1>
        <p className="page-subtitle mt-1 text-sm sm:text-base">
          Next: name it and fill it in, on its own page.
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {PERSONAL_TYPES.map(({ type, icon: Icon, label, description }) => (
          <li key={type}>
            <ViewTransitionLink
              to={PERSONAL_SCOPE.paths.create({ type })}
              aria-labelledby={`new-${type}-label`}
              aria-describedby={`new-${type}-help`}
              className="border-border hover:border-primary hover:bg-accent focus-visible:ring-ring/50 flex h-full flex-col items-start gap-3 rounded-2xl border p-5 text-left transition-colors outline-none focus-visible:ring-[3px]"
            >
              <Icon aria-hidden className="text-muted-foreground size-7" />
              <span id={`new-${type}-label`} className="text-sm font-medium">
                {label}
              </span>
              <span id={`new-${type}-help`} className="text-muted-foreground -mt-2 text-xs">
                {description}
              </span>
            </ViewTransitionLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A personal Synced list, in its earlier editor. */
function LegacyPersonalEditor({ snapshot }: { snapshot: EditorSnapshot<Collection> }) {
  const navigate = useNavigate();
  const collection = snapshot.view.raw;
  const listPath = PERSONAL_SCOPE.paths.list();
  return (
    <div className="page-shell relative space-y-6 py-4 sm:py-6">
      <PageBack to={listPath} up />
      <div className="mt-10 sm:mt-12">
        <h1 className="page-title text-[clamp(2rem,4vw,3rem)]">{collection.name}</h1>
        <p className="page-subtitle mt-1 text-sm sm:text-base">
          Edit what's local — name, libraries, sharing. Source-managed details (URL, schedule, item
          ordering) are locked.
        </p>
      </div>
      <ImportedCollectionEditor
        key={collection.id}
        collection={collection}
        etag={snapshot.etag}
        onClose={() => navigate(listPath)}
      />
    </div>
  );
}
