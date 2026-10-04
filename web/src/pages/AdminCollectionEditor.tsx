import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowLeft } from "lucide-react";

import type { LibraryCollection } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CollectionTemplateGallery } from "@/components/CollectionTemplateGallery";
import { useAdminLibraries } from "@/hooks/queries/admin/libraries";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { SERVER_SCOPE, type EditorSnapshot } from "@/lib/collections/scope";
import { isListBackedCollectionType } from "@/lib/collections/types";

import {
  CollectionEditForm,
  CollectionForm,
  MDBListImportForm,
  SourceTypeSelector,
  TMDBPresetForm,
  type CollectionSourceType,
} from "./adminCollectionsShared";
import SmartCollectionWizard from "./SmartCollectionWizard";

type CreateChoice = Exclude<CollectionSourceType, "manual" | "trakt"> | "smart";

const CREATE_TITLES: Record<CreateChoice, string> = {
  smart: "New Smart Collection",
  mdblist: "Import MDBList Collection",
  tmdb: "Import TMDB Collection",
};

/**
 * The server editors that haven't moved onto the collection editor page yet,
 * rendered inside it: the create chooser (its Manual card opens the editor
 * page) and the Smart and Synced list editors for a saved collection. The page
 * loads the collection and handles loading, missing and read-only states.
 */
export default function AdminCollectionEditor({
  snapshot,
  initialLibraryId = null,
}: {
  /** A saved Smart collection or Synced list; none for the create chooser. */
  snapshot?: EditorSnapshot<LibraryCollection>;
  initialLibraryId?: number | null;
}) {
  const navigate = useNavigate();
  const returnPath = SERVER_SCOPE.paths.list({ libraryId: initialLibraryId });
  const { data: libraries = [] } = useAdminLibraries();
  const collection = snapshot?.view.raw ?? null;
  const [choice, setChoice] = useState<CreateChoice | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);

  const title = collection
    ? `Edit ${collection.title}`
    : (choice && CREATE_TITLES[choice]) || "Add Collection";
  const description = collection
    ? "Collections now open in a dedicated workspace so rules, artwork, and preview can stay visible."
    : choice === null
      ? "Choose how this collection should be created."
      : "Build the collection in a full-page editor instead of a cramped dialog.";

  useDocumentTitle(title);

  // The wizard owns its own page chrome (back button, title, step indicator).
  if (collection?.collection_type === "smart") {
    return (
      <SmartCollectionWizard
        mode="admin"
        etag={snapshot?.etag}
        collection={collection}
        libraries={libraries}
        initialLibraryId={initialLibraryId}
        onClose={() => navigate(returnPath)}
      />
    );
  }

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

        {!collection && choice !== null ? (
          <Button variant="outline" onClick={() => setChoice(null)}>
            Change Source Type
          </Button>
        ) : null}
      </div>

      {!collection && choice === null ? (
        <Card className="surface-panel rounded-2xl border-0 shadow-none">
          <CardHeader>
            <CardTitle>Choose a Collection Type</CardTitle>
            <CardDescription>
              Manual collections open the collection editor. Smart collections open the query
              builder. Imports keep their source-specific setup.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SourceTypeSelector
              showTemplates
              onSelect={(type) => {
                if (type === "templates") {
                  setGalleryOpen(true);
                } else if (type === "manual") {
                  navigate(
                    SERVER_SCOPE.paths.create({ type: "manual", libraryId: initialLibraryId }),
                  );
                } else if (type !== "trakt") {
                  setChoice(type);
                }
              }}
            />
          </CardContent>
        </Card>
      ) : null}

      <CollectionTemplateGallery
        open={galleryOpen}
        onOpenChange={setGalleryOpen}
        libraries={libraries}
        initialLibraryId={initialLibraryId}
        onCreated={() => {
          if (!collection) navigate(returnPath);
        }}
      />

      {collection && isListBackedCollectionType(collection.collection_type) ? (
        <CollectionEditForm
          libraries={libraries}
          collection={collection}
          etag={snapshot?.etag}
          initialLibraryId={initialLibraryId}
          onClose={() => navigate(returnPath)}
        />
      ) : null}

      {!collection && choice === "smart" ? (
        <CollectionForm
          libraries={libraries}
          collection={null}
          initialLibraryId={initialLibraryId}
          onClose={() => navigate(returnPath)}
        />
      ) : null}

      {!collection && choice === "mdblist" ? (
        <MDBListImportForm
          libraries={libraries}
          initialLibraryId={initialLibraryId}
          onClose={() => navigate(returnPath)}
        />
      ) : null}

      {!collection && choice === "tmdb" ? (
        <TMDBPresetForm
          libraries={libraries}
          initialLibraryId={initialLibraryId}
          onClose={() => navigate(returnPath)}
        />
      ) : null}
    </div>
  );
}
