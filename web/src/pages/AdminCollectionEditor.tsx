import { Link, useNavigate } from "react-router";
import { ArrowLeft } from "lucide-react";

import type { LibraryCollection } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAdminLibraries } from "@/hooks/queries/admin/libraries";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { SERVER_SCOPE, type EditorSnapshot } from "@/lib/collections/scope";
import { isListBackedCollectionType } from "@/lib/collections/types";

import { CollectionEditForm, SourceTypeSelector } from "./adminCollectionsShared";

/** The Synced list tab each import card opens; templates open on the first. */
const SOURCE_OF_CARD = { mdblist: "mdblist", tmdb: "tmdb_chart", templates: undefined } as const;

/**
 * The server editors that haven't moved onto the collection editor page yet,
 * rendered inside it: the create chooser (every card opens the editor page;
 * templates and the MDBList and TMDB cards open its Synced list step) and the
 * Synced list editor for a saved collection. The page loads the collection
 * and handles loading, missing and read-only states.
 */
export default function AdminCollectionEditor({
  snapshot,
  initialLibraryId = null,
}: {
  /** A saved Synced list; none for the create chooser. */
  snapshot?: EditorSnapshot<LibraryCollection>;
  initialLibraryId?: number | null;
}) {
  const navigate = useNavigate();
  const returnPath = SERVER_SCOPE.paths.list({ libraryId: initialLibraryId });
  const { data: libraries = [] } = useAdminLibraries();
  const collection = snapshot?.view.raw ?? null;

  const title = collection ? `Edit ${collection.title}` : "Add Collection";
  const description = collection
    ? "Collections now open in a dedicated workspace so rules, artwork, and preview can stay visible."
    : "Choose how this collection should be created.";

  useDocumentTitle(title);

  return (
    <div className="page-shell space-y-6 py-4 sm:py-6">
      <div className="page-header gap-5">
        <div className="space-y-3">
          <Button asChild variant="ghost" className="w-fit px-0">
            <Link to={returnPath}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Collections
            </Link>
          </Button>
          <div>
            <h1 className="page-title text-[clamp(2rem,4vw,3rem)]">{title}</h1>
            <p className="page-subtitle mt-1 text-sm sm:text-base">{description}</p>
          </div>
        </div>
      </div>

      {!collection ? (
        <Card className="surface-panel rounded-2xl border-0 shadow-none">
          <CardHeader>
            <CardTitle>Choose a Collection Type</CardTitle>
            <CardDescription>
              Every type opens the collection editor. Templates are ready-made Synced lists.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SourceTypeSelector
              showTemplates
              onSelect={(type) => {
                if (type === "manual" || type === "smart") {
                  navigate(SERVER_SCOPE.paths.create({ type, libraryId: initialLibraryId }));
                } else if (type !== "trakt") {
                  navigate(
                    SERVER_SCOPE.paths.create({
                      type: "synced",
                      source: SOURCE_OF_CARD[type],
                      libraryId: initialLibraryId,
                    }),
                  );
                }
              }}
            />
          </CardContent>
        </Card>
      ) : null}

      {collection && isListBackedCollectionType(collection.collection_type) ? (
        <CollectionEditForm
          libraries={libraries}
          collection={collection}
          etag={snapshot?.etag}
          initialLibraryId={initialLibraryId}
          onClose={() => navigate(returnPath)}
        />
      ) : null}
    </div>
  );
}
