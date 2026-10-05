import { useId, useMemo, useState } from "react";
import { Link } from "react-router";
import { Info, Lock } from "lucide-react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";

import { MDBListBrowser } from "@/components/CollectionTemplateGallery/MDBListBrowser";
import { RadioCardItem, RadioGroup } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUserCollectionTemplates } from "@/hooks/queries/userCollectionImports";
import { useCollectionTemplates } from "@/lib/collectionTemplates";
import {
  ALL_MY_LIBRARIES_LABEL,
  CHART_RULES_NOTE,
  PASTE_TMDB_LIST_LINK,
  SYNCED_CAPTION,
  SYNCED_HEADING,
  SYNCED_OFF,
  TMDB_LIST_HELP,
  ineligibleLibrariesLine,
} from "@/lib/collections/copy";
import type { CollectionDraft, ScopeKind } from "@/lib/collections/scope";
import { SERVER_SCOPE } from "@/lib/collections/scope";
import {
  applyPick,
  chartPick,
  cleanMDBListLink,
  eligibleLibraryKinds,
  isMDBListLink,
  linkPick,
  popularPicks,
  TAB_OF_SOURCE,
  type ImportSource,
  type SyncedDraft,
  type SyncedList,
  type SyncedPick,
  type SyncedTab,
} from "@/lib/collections/synced";
import {
  CHART_MEDIA_LABEL,
  CHART_WINDOW_LABEL,
  chartHasTimeWindow,
  chartLockReason,
  chartMediaTypes,
  defaultChart,
  normalizeChart,
  TMDB_CHARTS,
  type TMDBChart,
  type TMDBChartMediaType,
  type TMDBChartPreset,
  type TMDBChartTimeWindow,
} from "@/lib/collections/tmdbSources";
import { isValidTMDBListURL } from "@/lib/tmdbList";

import { LibrariesLine } from "../fields/LibrariesLine";
import { OrderBlock } from "../fields/OrderBlock";
import { ScheduleField } from "../fields/ScheduleField";
import { TMDBListURLField } from "../TMDBListURLField";

const TAB_LABEL: Record<SyncedTab, string> = {
  mdblist: "MDBList",
  tmdb_chart: "TMDB chart",
  tmdb_list: "TMDB list",
};
const TAB_ORDER: readonly SyncedTab[] = ["mdblist", "tmdb_chart", "tmdb_list"];

interface LibraryOption {
  id: number;
  name: string;
  type?: string;
}

/** Whether a library can hold the list's titles; mixed and untyped libraries hold anything. */
function fits(library: LibraryOption, kinds: readonly string[] | undefined) {
  return !kinds || !library.type || library.type === "mixed" || kinds.includes(library.type);
}

/** A row of mutually exclusive choices, as in Show: Movies / TV shows / Both. */
function Segmented<Value extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Value;
  options: ReadonlyArray<{ value: Value; label: string; disabled?: boolean }>;
  onChange: (value: Value) => void;
}) {
  const id = useId();
  return (
    <div className="grid content-start gap-2">
      <span id={id} className="text-[14px] font-semibold">
        {label}
      </span>
      <RadioGroupPrimitive.Root
        aria-labelledby={id}
        value={value}
        onValueChange={(next) => onChange(next as Value)}
        orientation="horizontal"
        className="bg-muted/50 inline-flex w-fit gap-1 rounded-xl p-1"
      >
        {options.map((option) => (
          <RadioGroupPrimitive.Item
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 data-[state=checked]:bg-background data-[state=checked]:text-foreground h-9 rounded-lg px-3.5 text-[13.5px] font-medium outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {option.label}
          </RadioGroupPrimitive.Item>
        ))}
      </RadioGroupPrimitive.Root>
    </div>
  );
}

/** The TMDB chart tab: chart cards, then Show and "Trending over" as TMDB allows them. */
function ChartTab({
  chart,
  onChart,
  isServer,
}: {
  chart: TMDBChart | null;
  onChart: (chart: TMDBChart) => void;
  isServer: boolean;
}) {
  const id = useId();
  const allowed = chart ? chartMediaTypes(chart.preset) : [];
  const lock = chart ? chartLockReason(chart.preset) : null;
  const shows: TMDBChartMediaType[] =
    chart?.preset === "trending" ? ["movie", "tv", "all"] : ["movie", "tv"];
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <span id={`${id}-chart`} className="text-[14px] font-semibold">
          Chart
        </span>
        <RadioGroup
          aria-labelledby={`${id}-chart`}
          value={chart?.preset ?? ""}
          onValueChange={(value) => {
            const preset = value as TMDBChartPreset;
            onChart(chart ? normalizeChart({ ...chart, preset }) : defaultChart(preset));
          }}
          className="grid-cols-2 gap-2.5 sm:grid-cols-4"
        >
          {TMDB_CHARTS.map((entry) => (
            <RadioCardItem
              key={entry.preset}
              value={entry.preset}
              label={entry.label}
              hint={entry.hint}
            />
          ))}
        </RadioGroup>
      </div>
      {chart ? (
        <div className="grid gap-2">
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <Segmented
              label="Show"
              value={chart.mediaType}
              options={shows.map((value) => ({
                value,
                label: CHART_MEDIA_LABEL[value],
                disabled: !allowed.includes(value),
              }))}
              onChange={(mediaType) => onChart({ ...chart, mediaType })}
            />
            {chartHasTimeWindow(chart.preset) ? (
              <Segmented<TMDBChartTimeWindow>
                label="Trending over"
                value={chart.timeWindow ?? "day"}
                options={(["day", "week"] as const).map((value) => ({
                  value,
                  label: CHART_WINDOW_LABEL[value],
                }))}
                onChange={(timeWindow) => onChart({ ...chart, timeWindow })}
              />
            ) : null}
          </div>
          {lock ? (
            <p className="text-muted-foreground flex items-center gap-1.5 text-[13px]">
              <Lock aria-hidden className="size-3.5" />
              {lock}
            </p>
          ) : null}
        </div>
      ) : null}
      <p className="text-muted-foreground text-[13px]">
        {CHART_RULES_NOTE}
        {isServer ? (
          <>
            {" "}
            Genre and franchise sets come from{" "}
            <Link
              to={`${SERVER_SCOPE.paths.list()}?dialog=starter-packs`}
              className="text-foreground font-medium underline underline-offset-4"
            >
              Starter packs
            </Link>
            .
          </>
        ) : null}
      </p>
    </div>
  );
}

/**
 * A new Synced list's Contents: the list it follows, picked from MDBList
 * (search, popular picks or a pasted link), a TMDB chart or a TMDB list link;
 * then the libraries it matches into, its order and its sync schedule. Tabs
 * follow the scope's `import_sources`. A pick fills the draft's details only
 * where they haven't been changed by hand.
 */
export function SyncedListPanel({
  scopeKind,
  draft,
  onChange,
  libraries,
  capabilities,
  initialTab,
}: {
  scopeKind: ScopeKind;
  draft: CollectionDraft & { synced: SyncedDraft };
  onChange: (update: (draft: CollectionDraft) => CollectionDraft) => void;
  libraries: readonly LibraryOption[];
  capabilities?: {
    import_sources: readonly string[];
    mdblist_search: boolean;
    schedule_time_zone?: { utc_offset: string; name?: string };
  };
  initialTab?: SyncedTab;
}) {
  const id = useId();
  const isServer = scopeKind === "server";
  const adminTemplates = useCollectionTemplates(isServer);
  const personalTemplates = useUserCollectionTemplates(!isServer);
  const catalog = (isServer ? adminTemplates : personalTemplates).data;
  const importSources = useMemo(() => capabilities?.import_sources ?? [], [capabilities]);
  const picks = useMemo(
    () => popularPicks(catalog?.categories ?? [], importSources),
    [catalog, importSources],
  );
  const tabs = TAB_ORDER.filter((tab) =>
    importSources.some((source) => TAB_OF_SOURCE[source as ImportSource] === tab),
  );
  const [tab, setTab] = useState<SyncedTab>();
  const opening = initialTab && tabs.includes(initialTab) ? initialTab : tabs[0];
  const activeTab = tab && tabs.includes(tab) ? tab : opening;

  const { synced } = draft;
  const list = synced.list;
  const kinds = eligibleLibraryKinds(list?.mediaKind);
  const offered = libraries.filter((library) => fits(library, kinds));
  const left = libraries.filter((library) => !fits(library, kinds)).map((library) => library.name);
  const only = list?.mediaKind === "movie" || list?.mediaKind === "tv" ? list.mediaKind : null;

  /** Follows `pick`; libraries that can't hold its titles are unticked. */
  function follow(
    pick: SyncedPick,
    links: Partial<Pick<SyncedDraft, "mdblistLink" | "tmdbListLink">>,
  ) {
    const pickKinds = eligibleLibraryKinds(pick.list?.mediaKind);
    onChange((current) => {
      const applied = applyPick(current, pick);
      return {
        ...applied,
        libraryIds: applied.libraryIds.filter((libraryId) => {
          const library = libraries.find((entry) => entry.id === libraryId);
          return !library || fits(library, pickKinds);
        }),
        synced: { ...applied.synced!, ...links },
      };
    });
  }

  function onMDBListLink(raw: string) {
    const url = cleanMDBListLink(raw);
    const next: SyncedList | null = isMDBListLink(url)
      ? { source: "mdblist", url, mediaKind: "mixed" }
      : null;
    follow(linkPick(next), { mdblistLink: raw });
  }

  function onTMDBListLink(raw: string) {
    const next: SyncedList | null = isValidTMDBListURL(raw)
      ? { source: "tmdb_list", url: raw.trim(), mediaKind: "mixed" }
      : null;
    follow(linkPick(next), { tmdbListLink: raw });
  }

  const templates = picks.flatMap((group) => group.templates);
  const updateSynced = (fields: Partial<SyncedDraft>) =>
    onChange((current) => ({ ...current, synced: { ...current.synced!, ...fields } }));

  return (
    <section
      aria-labelledby={`${id}-heading`}
      data-panel="contents"
      className="surface-panel grid content-start gap-5 rounded-[22px] p-5 sm:p-6"
    >
      <div>
        <h2 id={`${id}-heading`} className="text-[17px] font-semibold">
          {SYNCED_HEADING}
        </h2>
        <p className="text-muted-foreground mt-1 text-[13.5px]">{SYNCED_CAPTION}</p>
      </div>

      {activeTab ? (
        <Tabs value={activeTab} onValueChange={(next) => setTab(next as SyncedTab)}>
          <TabsList aria-label="Where the list comes from" className="h-11 w-full sm:w-fit">
            {tabs.map((entry) => (
              <TabsTrigger key={entry} value={entry} className="px-3.5">
                {TAB_LABEL[entry]}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="mdblist" className="mt-3">
            <MDBListBrowser
              scopeKind={scopeKind}
              picks={picks}
              searchEnabled={capabilities?.mdblist_search ?? false}
              selectedId={list?.pickId}
              onPick={(pick) => follow(pick, { mdblistLink: "", tmdbListLink: "" })}
              link={synced.mdblistLink}
              onLinkChange={onMDBListLink}
            />
          </TabsContent>
          <TabsContent value="tmdb_chart" className="mt-3">
            <ChartTab
              isServer={isServer}
              chart={list?.source === "tmdb_chart" ? list.chart : null}
              onChart={(chart) =>
                follow(chartPick(chart, templates, scopeKind), {
                  mdblistLink: "",
                  tmdbListLink: "",
                })
              }
            />
          </TabsContent>
          <TabsContent value="tmdb_list" className="mt-3">
            <TMDBListURLField
              id={`${id}-tmdb-list`}
              label={PASTE_TMDB_LIST_LINK}
              help={TMDB_LIST_HELP}
              value={synced.tmdbListLink}
              onChange={onTMDBListLink}
            />
          </TabsContent>
        </Tabs>
      ) : capabilities ? (
        <p className="bg-muted/60 flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-[13px]">
          <Info aria-hidden className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          {SYNCED_OFF}
        </p>
      ) : (
        <Skeleton aria-hidden className="h-11 rounded-xl" />
      )}

      <div className="border-border/70 border-t pt-4">
        <LibrariesLine
          lead="Match into"
          libraries={offered}
          value={draft.libraryIds}
          allLabel={isServer ? undefined : ALL_MY_LIBRARIES_LABEL}
          onChange={(libraryIds) => onChange((current) => ({ ...current, libraryIds }))}
          warning={
            only && left.length > 0 ? (
              <p className="text-muted-foreground text-[13px]">
                {ineligibleLibrariesLine(only, left)}
              </p>
            ) : null
          }
        />
      </div>

      <OrderBlock
        mode="synced"
        sortConfig={draft.rawSortConfig}
        limit={synced.limit}
        allowPersonalized={!isServer}
        onSortChange={(rawSortConfig) => onChange((current) => ({ ...current, rawSortConfig }))}
        onLimitChange={(limit) => updateSynced({ limit })}
      />

      <section aria-labelledby={`${id}-sync`} className="border-border/70 grid gap-3 border-t pt-4">
        <h3 id={`${id}-sync`} className="text-[14.5px] font-semibold">
          Sync
        </h3>
        {isServer ? (
          <ScheduleField
            scope="server"
            value={synced.schedule}
            timeZone={capabilities?.schedule_time_zone}
            onChange={(schedule) => updateSynced({ schedule })}
          />
        ) : (
          <ScheduleField
            scope="personal"
            value={synced.schedule}
            onChange={(schedule) => updateSynced({ schedule })}
          />
        )}
      </section>
    </section>
  );
}
