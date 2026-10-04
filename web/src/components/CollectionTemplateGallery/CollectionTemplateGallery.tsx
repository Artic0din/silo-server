import { useMemo, useState } from "react";
import { ChevronLeft, Search } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { Library } from "@/api/types";
import {
  useCollectionTemplates,
  type CollectionTemplate,
  type CollectionTemplateCategory,
  type CollectionTemplateGroup,
} from "@/lib/collectionTemplates";
import { useUserCollectionTemplates } from "@/hooks/queries/userCollectionImports";
import { CollectionTemplateCard } from "./CollectionTemplateCard";
import { CollectionTemplateConfigForm } from "./CollectionTemplateConfigForm";
import { UserCollectionTemplateConfigForm } from "./UserCollectionTemplateConfigForm";

type ActiveCategory = CollectionTemplateCategory | "all";

interface AdminProps {
  mode?: "admin";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  libraries: Library[];
  initialLibraryId: number | null;
  /** Optional callback fired once a template-driven import succeeds. */
  onCreated?: () => void;
}

interface UserProps {
  mode: "user";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional callback fired once a template-driven import succeeds. */
  onCreated?: () => void;
}

type Props = AdminProps | UserProps;

export function CollectionTemplateGallery(props: Props) {
  const isUserMode = props.mode === "user";
  const adminTemplates = useCollectionTemplates(!isUserMode && props.open);
  const userTemplates = useUserCollectionTemplates(isUserMode && props.open);
  const { data, isLoading, error } = isUserMode ? userTemplates : adminTemplates;
  const { open, onOpenChange, onCreated } = props;
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<ActiveCategory>("all");
  const [picked, setPicked] = useState<CollectionTemplate | null>(null);

  const handleOpenChange = (next: boolean) => {
    // Reset internal state on close so the next open starts at the gallery
    // root rather than resuming a stale picked-template view.
    if (!next) {
      setSearch("");
      setActiveCategory("all");
      setPicked(null);
    }
    onOpenChange(next);
  };

  const groups: CollectionTemplateGroup[] = useMemo(() => data?.categories ?? [], [data]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return groups
      .filter((group) => activeCategory === "all" || group.category === activeCategory)
      .map((group) => ({
        ...group,
        templates: group.templates.filter((tmpl) => {
          if (!term) return true;
          return (
            tmpl.title.toLowerCase().includes(term) ||
            tmpl.description.toLowerCase().includes(term) ||
            (tmpl.tags ?? []).some((tag) => tag.toLowerCase().includes(term))
          );
        }),
      }))
      .filter((group) => group.templates.length > 0);
  }, [groups, search, activeCategory]);

  const totalMatches = filtered.reduce((sum, group) => sum + group.templates.length, 0);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-3xl lg:max-w-4xl">
        <DialogHeader className="space-y-1">
          <DialogTitle className="flex items-center gap-2">
            {picked ? (
              <button
                type="button"
                onClick={() => setPicked(null)}
                className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm font-medium"
              >
                <ChevronLeft className="h-4 w-4" /> Back
              </button>
            ) : (
              "Browse Collection Templates"
            )}
          </DialogTitle>
          <DialogDescription>
            {picked
              ? "Confirm details, then we'll create and sync the collection for you."
              : "Pick a curated source — TMDB or MDBList — and we'll seed a synced collection."}
          </DialogDescription>
        </DialogHeader>

        {picked ? (
          isUserMode ? (
            <UserCollectionTemplateConfigForm
              key={picked.id}
              template={picked}
              onCancel={() => setPicked(null)}
              onCreated={() => {
                handleOpenChange(false);
                onCreated?.();
              }}
            />
          ) : (
            <CollectionTemplateConfigForm
              key={picked.id}
              template={picked}
              libraries={(props as AdminProps).libraries}
              initialLibraryId={(props as AdminProps).initialLibraryId}
              onCancel={() => setPicked(null)}
              onCreated={() => {
                handleOpenChange(false);
                onCreated?.();
              }}
            />
          )
        ) : (
          <GalleryView
            isLoading={isLoading}
            error={error}
            groups={groups}
            filtered={filtered}
            totalMatches={totalMatches}
            search={search}
            setSearch={setSearch}
            activeCategory={activeCategory}
            setActiveCategory={setActiveCategory}
            onPick={setPicked}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface GalleryViewProps {
  isLoading: boolean;
  error: unknown;
  groups: CollectionTemplateGroup[];
  filtered: CollectionTemplateGroup[];
  totalMatches: number;
  search: string;
  setSearch: (value: string) => void;
  activeCategory: ActiveCategory;
  setActiveCategory: (value: ActiveCategory) => void;
  onPick: (template: CollectionTemplate) => void;
}

function GalleryView({
  isLoading,
  error,
  groups,
  filtered,
  totalMatches,
  search,
  setSearch,
  activeCategory,
  setActiveCategory,
  onPick,
}: GalleryViewProps) {
  if (error) {
    return (
      <div className="text-destructive rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">
        Failed to load templates: {error instanceof Error ? error.message : String(error)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search templates"
          className="pl-9"
        />
      </div>

      <div className="-mx-1 flex flex-wrap gap-2 px-1">
        <CategoryPill
          label="All"
          active={activeCategory === "all"}
          onClick={() => setActiveCategory("all")}
        />
        {groups.map((group) => (
          <CategoryPill
            key={group.category}
            label={group.label}
            active={activeCategory === group.category}
            onClick={() => setActiveCategory(group.category)}
          />
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, idx) => (
            <Skeleton key={idx} className="h-36 w-full rounded-2xl" />
          ))}
        </div>
      ) : totalMatches === 0 ? (
        <div className="text-muted-foreground rounded-md border border-dashed py-10 text-center text-sm">
          No templates match your filters.
        </div>
      ) : (
        <div className="space-y-6">
          {filtered.map((group) => (
            <section key={group.category} className="space-y-2">
              <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                {group.label}
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {group.templates.map((tmpl) => (
                  <CollectionTemplateCard key={tmpl.id} template={tmpl} onPick={onPick} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function CategoryPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-full px-3 py-1 text-xs font-medium transition-colors " +
        (active
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground hover:bg-muted/70")
      }
    >
      {label}
    </button>
  );
}
