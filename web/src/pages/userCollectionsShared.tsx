import { useEffect, useState } from "react";
import type { Collection, CreateCollectionRequest, UpdateCollectionRequest } from "@/api/types";
import { useProfiles } from "@/hooks/queries/profiles";
import { useUserLibraries } from "@/hooks/queries/libraries";
import { useCurrentProfile } from "@/hooks/useCurrentProfile";
import {
  useCreateCollection,
  useCollectionCapabilities,
  useUpdateCollection,
} from "@/hooks/queries/collections";
import { buildUserCollectionCatalogHref as buildCatalogHrefForUserCollection } from "@/pages/catalogSearchParams";
import {
  collectionMediaFilterLabel,
  collectionWatchFilterLabel,
  queryDefinitionToDisplayFilters,
} from "@/lib/collectionDisplayFilters";
import { CollectionLibraryPicker } from "@/pages/adminCollectionsShared";
import { ownerName } from "@/lib/collections/personalOwnership";
import { PERSONAL_SCOPE } from "@/lib/collections/scope";
import CollectionBuilder, {
  createCollectionBuilderValue,
  type CollectionBuilderValue,
} from "@/components/collections/CollectionBuilder";
import { ImageUploadField } from "@/components/ImageUploadField";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function buildUserCollectionCatalogHref(id: string, title?: string) {
  return buildCatalogHrefForUserCollection(id, title);
}

// Imported types (mdblist/tmdb/trakt) collapse to "manual" in the builder
// since the sync service owns their items; the original type stays in the DB.
function builderCollectionType(raw: Collection["collection_type"] | undefined): "manual" | "smart" {
  return raw === "smart" ? "smart" : "manual";
}

export function toUserCollectionBuilderValue(
  collection: Collection | null,
): CollectionBuilderValue {
  return createCollectionBuilderValue({
    title: collection?.name ?? "",
    collection_type: builderCollectionType(collection?.collection_type ?? "smart"),
    query_definition: collection?.query_definition,
    sort_config: collection?.sort_config ?? {},
    is_shared: collection?.is_shared ?? false,
    include_in_server_collections: collection?.include_in_server_collections ?? false,
    display_query_definition: collection?.display_query_definition,
  });
}

export function toCreateCollectionBody(value: CollectionBuilderValue): CreateCollectionRequest {
  const body: CreateCollectionRequest = {
    name: value.title,
    collection_type: value.collection_type,
    is_shared: value.is_shared,
    query_definition: value.collection_type === "smart" ? value.query_definition : undefined,
    sort_config: value.collection_type === "smart" ? value.sort_config : undefined,
    include_in_server_collections: value.include_in_server_collections,
  };
  if (value.collection_type === "manual") {
    body.display_query_definition = value.display_query_definition;
  }
  return body;
}

export function toUpdateCollectionBody(value: CollectionBuilderValue): UpdateCollectionRequest {
  const body: UpdateCollectionRequest = {
    name: value.title,
    is_shared: value.is_shared,
    query_definition: value.collection_type === "smart" ? value.query_definition : undefined,
    sort_config: value.collection_type === "smart" ? value.sort_config : undefined,
    include_in_server_collections: value.include_in_server_collections,
  };
  if (value.collection_type === "manual") {
    body.display_query_definition = value.display_query_definition;
  }
  return body;
}

function UserCollectionSummary({
  draft,
  collection,
  libraries,
}: {
  draft: CollectionBuilderValue;
  collection: Collection | null;
  libraries: Array<{ id: number; name: string }>;
}) {
  const { watch: displayWatch, media: displayMedia } = queryDefinitionToDisplayFilters(
    draft.display_query_definition,
  );

  const selectedLibraryIDs = draft.query_definition.library_ids;
  const librarySummary =
    selectedLibraryIDs.length === 0
      ? "All libraries"
      : libraries
          .filter((lib) => selectedLibraryIDs.includes(lib.id))
          .map((lib) => lib.name)
          .join(", ") || `${selectedLibraryIDs.length} selected`;

  return (
    <Card className="surface-panel gap-0 rounded-[1.5rem] border-0 shadow-none">
      <CardHeader>
        <CardTitle>Collection Summary</CardTitle>
        <CardDescription>Preview and sharing stay visible while you edit.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <SummaryRow label="Mode" value={draft.collection_type === "smart" ? "Smart" : "Manual"} />
        <SummaryRow label="Libraries" value={librarySummary} />
        {draft.collection_type === "manual" ? (
          <>
            <SummaryRow label="Watch state" value={collectionWatchFilterLabel(displayWatch)} />
            <SummaryRow label="Content" value={collectionMediaFilterLabel(displayMedia)} />
          </>
        ) : null}
        <SummaryRow label="Show to other profiles" value={draft.is_shared ? "Yes" : "No"} />
        <SummaryRow
          label="In my library tab"
          value={draft.include_in_server_collections ? "Yes" : "No"}
        />
        {collection ? <SummaryRow label="Collection" value={collection.name} /> : null}
      </CardContent>
    </Card>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

export function UserCollectionForm({
  collection,
  etag,
  onClose,
}: {
  collection: Collection | null;
  etag?: string;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => toUserCollectionBuilderValue(collection));
  const [posterFile, setPosterFile] = useState<File | null>(null);
  const [posterSourceUrl, setPosterSourceUrl] = useState("");
  // Removing the poster waits for Save, like every other field.
  const [posterRemoved, setPosterRemoved] = useState(false);
  const { data: capabilities } = useCollectionCapabilities();
  const createMutation = useCreateCollection();
  const updateMutation = useUpdateCollection();
  const { data: profiles = [] } = useProfiles();
  const { data: libraries = [] } = useUserLibraries();
  const { profile } = useCurrentProfile();
  const isPending = createMutation.isPending || updateMutation.isPending;
  // Another profile's collection opens read-only: only its creator changes it.
  const readOnly =
    collection !== null &&
    PERSONAL_SCOPE.isReadOnly(PERSONAL_SCOPE.toView(collection), profile?.id);

  useEffect(() => {
    setDraft(toUserCollectionBuilderValue(collection));
    setPosterFile(null);
    setPosterSourceUrl("");
    setPosterRemoved(false);
  }, [collection]);

  function handleSubmit() {
    const trimmedSource = posterSourceUrl.trim();
    if (collection) {
      const body: UpdateCollectionRequest = {
        ...toUpdateCollectionBody(draft),
        poster_source_url: trimmedSource || undefined,
      };
      updateMutation.mutate(
        {
          id: collection.id,
          etag: etag ?? "",
          body,
          poster: posterFile,
          removePoster: posterRemoved,
        },
        { onSuccess: onClose },
      );
    } else {
      const body: CreateCollectionRequest = {
        ...toCreateCollectionBody(draft),
        poster_source_url: trimmedSource || undefined,
      };
      createMutation.mutate({ body, poster: posterFile }, { onSuccess: onClose });
    }
  }

  function setLibraryIDs(next: number[]) {
    setDraft({
      ...draft,
      query_definition: { ...draft.query_definition, library_ids: next },
    });
  }

  const builderLibraries = libraries.map((lib) => ({ id: lib.id, name: lib.name, type: lib.type }));

  return (
    <CollectionBuilder
      mode="user"
      value={draft}
      onChange={setDraft}
      onSubmit={handleSubmit}
      submitLabel="Save Collection"
      libraries={builderLibraries}
      allowAccessControls
      allowLibrarySelection
      isPending={isPending}
      readOnly={readOnly}
      lockCollectionType={Boolean(collection)}
      ownerName={collection ? ownerName(profiles, collection.creator_profile_id) : null}
      previewLayout="sidebar"
      sidebarContent={
        <UserCollectionSummary draft={draft} collection={collection} libraries={builderLibraries} />
      }
    >
      {draft.collection_type === "smart" ? (
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Libraries</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Limit this collection to specific libraries. Leave empty to span every library you can
              see.
            </p>
          </div>
          <CollectionLibraryPicker
            libraries={builderLibraries}
            value={draft.query_definition.library_ids}
            onChange={setLibraryIDs}
          />
        </section>
      ) : null}

      {!readOnly && capabilities?.artwork ? (
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Poster</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Upload a custom poster or paste an image URL. Leave empty to fall back to the default
              card.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <ImageUploadField
              label="Poster"
              currentUrl={posterRemoved ? "" : collection?.poster_url}
              file={posterFile}
              onFileChange={(file) => {
                setPosterFile(file);
                if (file) setPosterRemoved(false);
              }}
              sourceUrl={posterSourceUrl}
              onSourceUrlChange={(url) => {
                setPosterSourceUrl(url);
                if (url.trim()) setPosterRemoved(false);
              }}
              onDelete={
                collection?.poster_url
                  ? () => {
                      setPosterRemoved(true);
                      setPosterFile(null);
                      setPosterSourceUrl("");
                    }
                  : undefined
              }
            />
          </div>
        </section>
      ) : null}
    </CollectionBuilder>
  );
}
