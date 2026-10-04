import { useNavigate, useParams } from "react-router";

import type { Collection, UserCollectionType } from "@/api/types";
import { isNotFoundProblem } from "@/api/v2/request";
import PageBack from "@/components/PageBack";
import PageUnavailable from "@/components/PageUnavailable";
import ViewTransitionLink from "@/components/ViewTransitionLink";
import { Button } from "@/components/ui/button";
import { useCollectionCapabilities } from "@/hooks/queries/collections";
import { useScopeEditor } from "@/hooks/queries/collectionScope";
import { PERSONAL_SCOPE } from "@/lib/collections/scope";

import { ImportedCollectionEditor } from "./ImportedCollectionEditor";
import SmartCollectionWizard from "./SmartCollectionWizard";
import { useCurrentProfile } from "@/hooks/useCurrentProfile";
import { UserCollectionForm } from "./userCollectionsShared";
import { ManualCollectionItemsEditor } from "@/components/collections/ManualCollectionItemsEditor";

type ImportedType = Extract<UserCollectionType, "mdblist" | "tmdb" | "trakt">;
const IMPORTED_TYPES = new Set<ImportedType>(["mdblist", "tmdb", "trakt"]);

function isImportedCollection(
  collection: Collection,
): collection is Collection & { collection_type: ImportedType } {
  return IMPORTED_TYPES.has(collection.collection_type as ImportedType);
}

export default function CollectionEditor() {
  const navigate = useNavigate();
  const { profile } = useCurrentProfile();
  const { data: capabilities } = useCollectionCapabilities();
  const { id } = useParams<{ id: string }>();
  const { snapshot, isLoading, isFetching, error, refetch } = useScopeEditor(PERSONAL_SCOPE, id);
  const collection = snapshot?.view.raw ?? null;
  const listPath = PERSONAL_SCOPE.paths.list();

  if (isLoading && id) {
    return <div className="page-shell py-8">Loading collection editor...</div>;
  }

  if (id && !collection && !isLoading) {
    if (error && !isNotFoundProblem(error)) {
      return (
        <PageUnavailable
          title="Couldn't load this collection"
          description="Something went wrong while loading it. Try again in a moment."
          onRetry={() => void refetch()}
          retrying={isFetching}
        />
      );
    }
    return (
      <PageUnavailable
        title="This collection isn't available"
        description="It may have been deleted, or you may not have access to it."
      >
        <Button asChild variant="outline">
          <ViewTransitionLink to={listPath} up>
            All collections
          </ViewTransitionLink>
        </Button>
      </PageUnavailable>
    );
  }

  if (collection && isImportedCollection(collection)) {
    return (
      <div className="page-shell relative space-y-6 py-4 sm:py-6">
        <PageBack to={listPath} up />
        <div className="mt-10 sm:mt-12">
          <h1 className="page-title text-[clamp(2rem,4vw,3rem)]">{collection.name}</h1>
          <p className="page-subtitle mt-1 text-sm sm:text-base">
            Edit what's local — name, libraries, sharing. Source-managed details (URL, schedule,
            item ordering) are locked.
          </p>
        </div>
        <ImportedCollectionEditor
          key={collection.id}
          collection={collection}
          etag={snapshot!.etag}
          onClose={() => navigate(listPath)}
        />
      </div>
    );
  }

  // New collections use the mode selector; saved smart collections keep their preview wizard.
  if (!collection || collection.collection_type === "manual") {
    return (
      <div className="page-shell relative space-y-6 py-4 sm:py-6">
        <PageBack to={listPath} up />
        <div className="mt-10 sm:mt-12">
          <h1 className="page-title text-[clamp(2rem,4vw,3rem)]">
            {collection ? `Edit ${collection.name}` : "New Collection"}
          </h1>
          <p className="page-subtitle mt-1 text-sm sm:text-base">
            {collection
              ? "Manual collections are curated by adding titles directly."
              : "Choose a manual collection to pick titles yourself, or a smart collection to match filters."}
          </p>
        </div>
        <UserCollectionForm
          collection={collection}
          etag={snapshot?.etag}
          onClose={() => navigate(listPath)}
        />
        {snapshot && collection && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Items</h2>
            {capabilities?.item_reorder && (
              <p className="text-muted-foreground text-sm">
                Drag the handle to reorder. The saved order is what every viewer sees.
              </p>
            )}
            <ManualCollectionItemsEditor
              collectionId={collection.id}
              scope={PERSONAL_SCOPE}
              readOnly={PERSONAL_SCOPE.isReadOnly(snapshot.view, profile?.id)}
            />
          </section>
        )}
      </div>
    );
  }

  return (
    <SmartCollectionWizard
      mode="user"
      collection={collection}
      etag={snapshot?.etag}
      onClose={() => navigate(listPath)}
    />
  );
}
