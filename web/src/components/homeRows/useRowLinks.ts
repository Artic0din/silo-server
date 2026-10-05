import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import type { CollectionOption } from "@/hooks/queries/useAllUserCollections";
import { pageLabel } from "@/lib/homeRows/pages";
import { draftForPreset, findRecipe, withCollection, type RowDraft } from "@/lib/homeRows/rowDraft";
import {
  homeRowsPath,
  readRowLinks,
  ROW_LINK_PARAMS,
  type AddedRowState,
  type RowLinks,
} from "@/lib/homeRows/rowLinks";
import type { HomeRow, HomeRowsAdapter } from "@/lib/homeRows/types";
import type { RecipeCatalogResponse } from "@/lib/recipes";

/** Add row opened on a collection from a link: step 2, already filled in. */
export interface RowSeed {
  draft: RowDraft;
  /** The dialog's back link, when the link said where it came from. */
  back?: { label: string; onClick: () => void };
  /** Replaces the page's own after-add step when the link said where to go back to. */
  onAdded?: (newIds: string[]) => void;
}

const CANT_ADD = "This collection can't be added here.";
const PAGE_LOCKED = "This page can't change right now.";
const ROW_GONE = "That row no longer exists.";
const NO_KINDS = "The kinds of rows didn't load, so Add row couldn't open.";
const NO_COLLECTIONS = "Collections didn't load, so Add row couldn't open.";

/** Every link parameter's value, to notice a new link. Empty when there is none. */
function linkKey(params: URLSearchParams) {
  return ROW_LINK_PARAMS.some((name) => params.has(name))
    ? ROW_LINK_PARAMS.map((name) => params.get(name) ?? "").join("\n")
    : "";
}

/**
 * Follows `?add=`, `?edit=` and `?return=` on a Home rows page (see
 * `lib/homeRows/rowLinks`). The links are read once and dropped from the
 * address. Nothing opens until `settled` says the page's rows and whether it
 * can change are known; Add row then also waits for the page's collection
 * options and opens only on a collection among them.
 */
export function useRowLinks({
  adapter,
  catalog,
  catalogFailed,
  settled,
  onAdd,
  onEdit,
}: {
  adapter: HomeRowsAdapter;
  catalog: RecipeCatalogResponse | undefined;
  catalogFailed: boolean;
  settled: boolean;
  onAdd: (seed: RowSeed) => void;
  onEdit: (row: HomeRow) => void;
}) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const key = linkKey(searchParams);
  const [read, setRead] = useState<{ key: string; links: RowLinks | null }>(() => ({
    key,
    links: key ? readRowLinks(searchParams, adapter.surface) : null,
  }));
  if (key !== read.key) {
    // A new link: read it. When the address then drops it, keep the link already read.
    setRead(
      key
        ? { key, links: readRowLinks(searchParams, adapter.surface) }
        : { key, links: read.links },
    );
  }
  const { links } = read;
  const handled = useRef<RowLinks | null>(null);

  useEffect(() => {
    if (!key) return;
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const name of ROW_LINK_PARAMS) next.delete(name);
        return next;
      },
      { replace: true },
    );
  }, [key, setSearchParams]);

  useEffect(() => {
    if (!links || handled.current === links || !settled) return;
    const { add, edit, returnTo } = links;
    const collections = adapter.collections;

    function seedFor(option: CollectionOption, draft: RowDraft): RowSeed {
      if (!returnTo) return { draft };
      const { surface, page, pages, rows } = adapter;
      const where = page.kind === "home" ? "Home" : `the ${pageLabel(page, pages)} page`;
      // Home rows was a detour from `returnTo`: replace it, so Back doesn't return to it.
      return {
        draft,
        back: {
          label: `Back to ${option.title}`,
          onClick: () => navigate(returnTo, { replace: true }),
        },
        onAdded: ([id, ...copyIds]) => {
          if (!id) return navigate(returnTo, { replace: true });
          // `rows` is the page before the add; new rows go to the bottom.
          const position = rows.length + 1;
          const state: AddedRowState = { addedRow: { id, copyIds, surface, page, position } };
          navigate(returnTo, { replace: true, state });
          toast.success(`Added to ${where} as row ${position} of ${position}`, {
            action: {
              label: "Move it",
              onClick: () => navigate(homeRowsPath(surface, page, { edit: id })),
            },
          });
        },
      };
    }

    // Acts on the link once; a return without acting waits for the next render.
    function finish(action: () => void) {
      handled.current = links;
      action();
    }
    const refuse = (message: string) => finish(() => toast.error(message));

    if (add === "invalid") {
      refuse(CANT_ADD);
    } else if (add) {
      if (!adapter.canEdit) return refuse(PAGE_LOCKED);
      if (!catalog) return catalogFailed ? refuse(NO_KINDS) : undefined;
      if (collections?.loading) return;
      const def = findRecipe(catalog, "collection");
      const option = collections?.options.find(
        (candidate) => candidate.id === add.id && candidate.source === add.source,
      );
      if (option && def) {
        const draft = withCollection(draftForPreset(def, def.presets[0]), option);
        return finish(() => onAdd(seedFor(option, draft)));
      }
      // Options read before the collection was made are refreshing.
      if (collections?.fetching) return;
      refuse(collections?.failed ? NO_COLLECTIONS : CANT_ADD);
    } else if (edit) {
      const row = adapter.rows.find((candidate) => candidate.id === edit);
      if (!adapter.canEdit) refuse(PAGE_LOCKED);
      else if (row) finish(() => onEdit(row));
      else refuse(ROW_GONE);
    } else {
      handled.current = links;
    }
  }, [links, settled, adapter, catalog, catalogFailed, navigate, onAdd, onEdit]);
}
