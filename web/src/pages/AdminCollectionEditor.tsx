import { Link, useNavigate } from "react-router";
import { ArrowLeft, Download, ListFilter, ListPlus, Sparkles, TrendingUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAdminCollectionCapabilities } from "@/hooks/queries/admin/collections";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useListReturnPath } from "@/lib/collections/listReturn";
import { SERVER_SCOPE } from "@/lib/collections/scope";

/** The Synced list tab each import card opens; templates open on the first. */
const SOURCE_OF_CARD = { mdblist: "mdblist", tmdb: "tmdb_chart", templates: undefined } as const;

type CollectionSourcePick = "manual" | "smart" | "mdblist" | "tmdb" | "templates";

function SourceTypeSelector({ onSelect }: { onSelect: (type: CollectionSourcePick) => void }) {
  const { data: capabilities } = useAdminCollectionCapabilities();
  const options: {
    type: CollectionSourcePick;
    icon: typeof ListPlus;
    label: string;
    subtitle: string;
    highlight?: boolean;
  }[] = [
    {
      type: "templates",
      icon: Sparkles,
      label: "Browse Templates",
      subtitle: "Start from a curated TMDB or MDBList preset",
      highlight: true,
    },
    { type: "manual", icon: ListPlus, label: "Manual", subtitle: "Curate items by hand" },
    { type: "smart", icon: ListFilter, label: "Smart", subtitle: "Match titles with rules" },
    { type: "mdblist", icon: Download, label: "MDBList", subtitle: "Sync from an MDBList URL" },
    {
      type: "tmdb",
      icon: TrendingUp,
      label: "TMDB",
      subtitle: "Auto-populate from TMDB presets or a public list",
    },
  ];

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {options
        .filter((opt) => opt.type === "manual" || opt.type === "smart" || capabilities?.imports)
        .map((opt) => (
          <button
            key={opt.type}
            type="button"
            onClick={() => onSelect(opt.type)}
            className={
              "flex flex-col items-start gap-3 rounded-2xl border p-5 text-left transition-colors " +
              (opt.highlight
                ? "border-primary/60 bg-primary/5 hover:border-primary hover:bg-primary/10"
                : "border-border hover:border-primary hover:bg-accent")
            }
          >
            <opt.icon
              className={opt.highlight ? "text-primary h-8 w-8" : "text-muted-foreground h-8 w-8"}
            />
            <div>
              <p className="text-sm font-medium">{opt.label}</p>
              <p className="text-muted-foreground mt-1 text-xs">{opt.subtitle}</p>
            </div>
          </button>
        ))}
    </div>
  );
}

/**
 * The server create chooser, rendered inside the collection editor page while
 * `/admin/collections/new` has no `type`: every card opens the editor page;
 * templates and the MDBList and TMDB cards open its Synced list step.
 */
export default function AdminCollectionEditor({
  initialLibraryId = null,
}: {
  initialLibraryId?: number | null;
}) {
  const navigate = useNavigate();
  const returnPath = useListReturnPath(SERVER_SCOPE.paths.list({ libraryId: initialLibraryId }));
  useDocumentTitle("Add Collection");

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
            <h1 className="page-title text-[clamp(2rem,4vw,3rem)]">Add Collection</h1>
            <p className="page-subtitle mt-1 text-sm sm:text-base">
              Choose how this collection should be created.
            </p>
          </div>
        </div>
      </div>

      <Card className="surface-panel rounded-2xl border-0 shadow-none">
        <CardHeader>
          <CardTitle>Choose a Collection Type</CardTitle>
          <CardDescription>
            Every type opens the collection editor. Templates are ready-made Synced lists.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SourceTypeSelector
            onSelect={(type) => {
              if (type === "manual" || type === "smart") {
                navigate(SERVER_SCOPE.paths.create({ type, libraryId: initialLibraryId }));
              } else {
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
    </div>
  );
}
