import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, Plus, Search, Trash2, X } from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useRowPreview } from "@/hooks/queries/homeRows/useRowPreview";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import {
  isPersonalRowKind,
  pickerGroups,
  rowKindLabel,
  rowKindSentence,
  type PickerCard,
} from "@/lib/homeRows/catalog";
import { canCopyToLibraries, libraryCopyIds } from "@/lib/homeRows/bulkCopy";
import { pageLabel as labelOfPage, libraryPagesOf } from "@/lib/homeRows/pages";
import { collectionIdOf } from "@/lib/homeRows/payloads";
import {
  canSaveDraft,
  DRAFT_FIELD_LABELS,
  draftForPreset,
  draftFromRow,
  findRecipe,
  mergeReloadedDraft,
  previewWaitText,
  savedTitle,
  withVariant,
  type DraftField,
  type RowDraft,
} from "@/lib/homeRows/rowDraft";
import { searchPickerGroups } from "@/lib/homeRows/search";
import {
  RowChangedError,
  type EditSession,
  type HomeRowsAdapter,
  type RowCollections,
} from "@/lib/homeRows/types";
import { kindLocked, showsLabel, variantLocked } from "@/lib/homeRows/variants";
import type { RecipeCatalogResponse } from "@/lib/recipes";
import { cn } from "@/lib/utils";
import type { ParamLibrary } from "./ParamFields";
import { RowForm, type CollectionChoices } from "./RowForm";
import { RowPicker } from "./RowPicker";

export interface AddRowDialogProps {
  adapter: HomeRowsAdapter;
  catalog: RecipeCatalogResponse | undefined;
  catalogFailed?: boolean;
  libraries: ParamLibrary[];
  /** Edit row when set, Add row otherwise. */
  session: EditSession | null;
  onClose: () => void;
  /** After a row is added or saved, with the ids of new rows. */
  onSaved: (newIds: string[]) => void;
  onDelete?: (session: EditSession) => void;
}

const NO_COLLECTIONS: RowCollections = { options: [], loading: false, failed: false, href: "" };

function sentenceWithoutStop(sentence: string) {
  return sentence.replace(/\.$/, "");
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function Steps({ step, children }: { step: 1 | 2; children: string }) {
  return (
    <span className="text-muted-foreground inline-flex min-w-0 items-center gap-2 text-[13px]">
      <i aria-hidden className="bg-foreground h-1 w-[18px] shrink-0 rounded-full" />
      <i
        aria-hidden
        className={cn(
          "h-1 w-[18px] shrink-0 rounded-full",
          step === 2 ? "bg-foreground" : "bg-border",
        )}
      />
      <span className="shrink-0">Step {step} of 2</span>
      {/* Phones only fit the step count; screen readers still hear the note. */}
      <span aria-hidden className="max-sm:hidden">
        ·
      </span>
      <span className="truncate max-sm:sr-only">{children}</span>
    </span>
  );
}

/**
 * Add row (step 1: pick a kind; step 2: preview, variant, name, More
 * options) and Edit row (step 2 with Shows · Change and Delete row…) in one
 * dialog. Below 1024px it is a bottom sheet, and step 2 is full height.
 */
export function AddRowDialog({
  adapter,
  catalog,
  catalogFailed,
  libraries,
  session: initialSession,
  onClose,
  onSaved,
  onDelete,
}: AddRowDialogProps) {
  const editing = initialSession !== null;
  const narrow = useMediaQuery("(max-width: 1023px)");
  const phone = useMediaQuery("(max-width: 639px)");
  const page = labelOfPage(adapter.page, adapter.pages);
  const [step, setStep] = useState<"pick" | "form">(editing ? "form" : "pick");
  const [query, setQuery] = useState("");
  const [session, setSession] = useState(initialSession);
  const [original, setOriginal] = useState<RowDraft | null>(() =>
    initialSession ? draftFromRow(initialSession.row, catalog) : null,
  );
  const [draft, setDraft] = useState<RowDraft | null>(original);
  const [conflict, setConflict] = useState(false);
  const [changedUpstream, setChangedUpstream] = useState<DraftField[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const searchRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstStep = useRef(true);
  // Without a Radix trigger, focus would land on the page body on close; it
  // goes back to whatever opened the dialog (Add row, or the row's ⋯).
  const [returnFocus] = useState(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  // Moving between steps puts focus where the new step starts.
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    if (step === "pick") searchRef.current?.focus();
    else headingRef.current?.focus();
  }, [step]);

  const groups = useMemo(
    () =>
      searchPickerGroups(pickerGroups(catalog, { ruleRows: adapter.capabilities.ruleRows }), query),
    [catalog, adapter.capabilities.ruleRows, query],
  );
  const typesOnPage = useMemo(
    () => new Set(adapter.rows.map((row) => row.sectionType)),
    [adapter.rows],
  );
  const collections = adapter.collections ?? NO_COLLECTIONS;
  const collectionChoices = useMemo<CollectionChoices>(() => {
    const currentId = draft?.sectionType === "collection" ? collectionIdOf(draft.config) : "";
    return {
      collections,
      pageLabel: page,
      onPageIds: new Set(
        adapter.rows
          .filter((row) => row.sectionType === "collection")
          .map((row) => collectionIdOf(row.config)),
      ),
      current: collections.options.find((option) => option.id === currentId),
    };
  }, [collections, page, adapter.rows, draft]);
  const previewWait = draft ? previewWaitText(draft) : null;
  // Why the strip shows no titles: this surface has no preview, or the draft can't have one yet.
  let previewOffText = "Previews aren't available on this server.";
  if (adapter.surface === "profile") previewOffText = `You'll see it on ${page} after you add it.`;
  else if (adapter.capabilities.draftPreview && previewWait) previewOffText = previewWait;
  const libraryPages = useMemo(() => libraryPagesOf(adapter.pages), [adapter.pages]);
  // A new row on a library page may go to other library pages too, when its
  // settings can be copied as they are.
  const copyPages =
    !editing &&
    adapter.capabilities.libraryCopies &&
    adapter.page.kind === "library" &&
    libraryPages.length > 1 &&
    draft !== null &&
    canCopyToLibraries(draft)
      ? { pages: libraryPages, currentId: adapter.page.libraryId }
      : undefined;
  const copies = copyPages && draft ? libraryCopyIds(draft, adapter.page) : [];
  const preview = useRowPreview(
    draft ?? { sectionType: "", config: {} },
    adapter.page,
    adapter.capabilities.draftPreview && step === "form" && draft !== null && !previewWait,
  );

  const def = draft ? findRecipe(catalog, draft.sectionType) : undefined;
  const locked = draft ? variantLocked(draft.sectionType, draft.config) : false;
  const canSave = draft !== null && canSaveDraft(draft);

  function pick(card: PickerCard, presetKey?: string) {
    const preset = card.def.presets.find((entry) => entry.key === presetKey) ?? card.def.presets[0];
    const fresh = draftForPreset(card.def, preset);
    setDraft(
      editing && draft
        ? {
            ...fresh,
            // A new kind starts from its own settings; the name stays unless it
            // was still following the old variant.
            title: draft.titleFollowsVariant ? fresh.title : draft.title,
            titleFollowsVariant: draft.titleFollowsVariant,
            itemLimit: draft.itemLimit,
            hero: draft.hero,
          }
        : fresh,
    );
    setStep("form");
  }

  async function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await action();
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function submit() {
    if (!draft || conflict || !canSave) return;
    const finished = {
      ...draft,
      title: savedTitle(draft, catalog, collectionChoices.current?.title),
      extraLibraryIds: copies,
    };
    void run(async () => {
      try {
        if (session) {
          await adapter.save(session, finished);
          onSaved([]);
        } else {
          const { newIds } = await adapter.create(finished);
          onSaved(newIds);
        }
        onClose();
      } catch (error) {
        if (error instanceof RowChangedError) {
          if (mounted.current) setConflict(true);
          return;
        }
        toast.error(
          errorMessage(error, session ? "Could not save this row" : "Could not add this row"),
        );
      }
    });
  }

  function reloadRow() {
    if (!session || !draft || !original) return;
    void run(async () => {
      try {
        const next = await adapter.reloadEdit(session);
        if (!mounted.current) return;
        const upstream = draftFromRow(next.row, catalog);
        const merged = mergeReloadedDraft(original, draft, upstream);
        setSession(next);
        setOriginal(upstream);
        setDraft(merged.draft);
        setChangedUpstream(merged.changedUpstream);
        setConflict(false);
      } catch (error) {
        toast.error(errorMessage(error, "Could not reload this row"));
      }
    });
  }

  const changing = editing && step === "pick";
  // Step 2 of Add row goes back to the picker; the Change picker goes back to Edit row.
  const back =
    step === "form" && !editing
      ? { label: "All rows", to: "pick" as const }
      : changing
        ? { label: "Edit row", to: "form" as const }
        : null;
  let title: string;
  let description: ReactNode;
  if (step === "pick") {
    title = changing ? "Change what this row shows" : `Add a row to ${page}`;
    description = changing
      ? "Pick another kind of row. Its settings start fresh; the name and More options stay."
      : phone
        ? `Pick what it shows. It goes to the bottom of ${page}.`
        : "Pick what the row shows. Next you'll see a preview and can name it.";
  } else if (editing) {
    title = "Edit row";
    description = `Changes apply to everyone on ${page} who hasn't changed this row.`;
  } else {
    const type = draft?.sectionType ?? "";
    title = rowKindLabel(type);
    if (type === "collection") {
      description = (
        <>
          Show one of your collections as a row. Make or change collections in{" "}
          <Link to={collections.href} className="text-foreground underline underline-offset-2">
            Collections
          </Link>
          .
        </>
      );
    } else if (type === "custom_filter") {
      description = "Describe the titles you want. New matches show up on their own.";
    } else {
      description = `${rowKindSentence(type)}${isPersonalRowKind(type) ? " Different for each viewer." : ""}`;
    }
  }

  // The footer's left side: progress while adding, Delete row… while editing.
  let footerStart: ReactNode = <span />;
  if (!editing) {
    footerStart =
      step === "pick" ? (
        <Steps step={1}>{`New rows go to the bottom of ${page}`}</Steps>
      ) : (
        <Steps step={2}>
          {copies.length > 0 ? "Goes to the bottom of each page" : `Goes to the bottom of ${page}`}
        </Steps>
      );
  } else if (step === "form") {
    footerStart = (
      <Button
        type="button"
        variant="ghost"
        className="text-destructive hover:text-destructive -ml-3"
        disabled={busy || !onDelete}
        onClick={() => session && onDelete?.(session)}
      >
        <Trash2 aria-hidden className="size-4" />
        Delete row…
      </Button>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus?.focus();
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (step === "pick") searchRef.current?.focus();
          else headingRef.current?.focus();
        }}
        className={cn(
          "flex flex-col gap-0 overflow-hidden rounded-[20px] p-0 sm:max-w-none",
          "max-lg:top-auto max-lg:bottom-0 max-lg:left-0 max-lg:w-full max-lg:max-w-none max-lg:translate-x-0 max-lg:translate-y-0 max-lg:rounded-b-none",
          step === "pick"
            ? "max-lg:h-[calc(100dvh-2.5rem)] max-lg:max-h-none lg:h-[min(860px,calc(100dvh-4rem))] lg:w-[min(1000px,calc(100vw-3rem))]"
            : "max-lg:h-dvh max-lg:max-h-none max-lg:rounded-none lg:w-[min(880px,calc(100vw-3rem))]",
        )}
      >
        <div
          aria-hidden
          className="bg-muted-foreground/40 mx-auto mt-2.5 h-1 w-10 rounded-full lg:hidden"
        />
        <div className="grid gap-1.5 px-5 pt-5 pb-4 sm:px-7 sm:pt-6">
          {back ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground -ml-2.5 h-7 w-fit gap-1.5 px-2"
              onClick={() => setStep(back.to)}
            >
              <ChevronLeft aria-hidden className="size-4" />
              {back.label}
            </Button>
          ) : null}
          <DialogTitle
            ref={headingRef}
            tabIndex={-1}
            className="pr-10 text-xl font-semibold tracking-[-0.02em] outline-none"
          >
            {title}
          </DialogTitle>
          <DialogDescription className="text-sm">{description}</DialogDescription>
          {step === "pick" ? (
            <div className="relative mt-3">
              <Search
                aria-hidden
                className="text-muted-foreground absolute top-1/2 left-3.5 size-4 -translate-y-1/2"
              />
              <Input
                ref={searchRef}
                type="search"
                aria-label="Search rows"
                placeholder={phone ? "Search rows" : "Search, e.g. trending, 4K, Ghibli, Christmas"}
                className="h-11 pl-10"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          ) : null}
        </div>

        {step === "pick" ? (
          <div className="border-border flex min-h-0 flex-1 flex-col border-t pt-3 lg:pt-0">
            {catalog ? (
              <RowPicker
                groups={groups}
                query={query}
                onClearSearch={() => {
                  setQuery("");
                  searchRef.current?.focus();
                }}
                pageLabel={page}
                typesOnPage={typesOnPage}
                narrow={narrow}
                onPick={pick}
              />
            ) : (
              <p role="status" className="text-muted-foreground px-7 py-10 text-sm">
                {catalogFailed
                  ? "The kinds of rows didn't load. Close this and try again."
                  : "Loading kinds of rows…"}
              </p>
            )}
          </div>
        ) : draft ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 sm:px-7">
            <RowForm
              draft={draft}
              onChange={setDraft}
              catalog={catalog}
              preview={preview}
              liveLabel={editing ? "Live preview" : "Live preview from your libraries"}
              previewOffText={previewOffText}
              collectionChoices={collectionChoices}
              shows={
                editing
                  ? {
                      label: showsLabel(draft.sectionType, draft.config),
                      sentence: sentenceWithoutStop(rowKindSentence(draft.sectionType)),
                      onChange: kindLocked(draft.config) ? undefined : () => setStep("pick"),
                    }
                  : undefined
              }
              variantLocked={locked}
              libraries={libraries}
              onLibraryPage={adapter.page.kind === "library"}
              onVariant={(presetKey) => setDraft(withVariant(draft, def, presetKey))}
              libraryPages={copyPages}
            />
          </div>
        ) : null}

        {step === "form" && editing && (conflict || changedUpstream.length > 0) ? (
          <div
            role={conflict ? "alert" : "status"}
            className={cn(
              "flex items-center gap-3 border-t px-5 py-3 text-sm sm:px-7",
              conflict ? "border-warning/40 bg-warning/10" : "border-border",
            )}
          >
            <p className="min-w-0 flex-1">
              {conflict
                ? "This row changed since you opened it. Your changes are kept. Reload the row to see what changed, then save again."
                : `Changed elsewhere: ${changedUpstream.map((field) => DRAFT_FIELD_LABELS[field]).join(", ")}`}
            </p>
            {conflict ? (
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={reloadRow}>
                Reload row
              </Button>
            ) : null}
          </div>
        ) : null}

        <div className="border-border bg-surface/55 flex items-center justify-between gap-3 border-t px-5 py-4 max-lg:pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-7">
          {footerStart}
          <div className="flex shrink-0 gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            {step === "form" ? (
              <Button type="button" disabled={busy || conflict || !canSave} onClick={submit}>
                {editing ? (
                  "Save"
                ) : (
                  <>
                    <Plus aria-hidden className="size-4" />
                    {copies.length > 0 ? `Add to ${copies.length + 1} pages` : "Add row"}
                  </>
                )}
              </Button>
            ) : null}
          </div>
        </div>

        <DialogClose className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring/50 absolute top-[18px] right-[18px] grid size-11 place-items-center rounded-[10px] outline-none focus-visible:ring-[3px] lg:size-[34px]">
          <X aria-hidden className="size-[18px]" />
          <span className="sr-only">Close</span>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
