import { describe, expect, it } from "vitest";
import { sectionKeys } from "@/hooks/queries/keys";
import type { ResolvedSection } from "@/api/types";
import { adminPeekKey, createLimiter, peekItemsOf, profilePeekKey, profilePeekSeed } from "./peek";
import type { HomeRow } from "./types";

function row(overrides: Partial<HomeRow> = {}): HomeRow {
  return {
    id: "a",
    title: "Trending This Week",
    sectionType: "trending_on_server",
    config: { window: "7d" },
    itemLimit: 20,
    hero: false,
    shown: true,
    own: false,
    legacyTrakt: false,
    ...overrides,
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("adminPeekKey", () => {
  it("sits outside the section keys, so refreshing the list does not refetch peeks", () => {
    expect(adminPeekKey({ kind: "home" }, row())[0]).not.toBe(sectionKeys.all[0]);
  });

  it("changes with the row's kind, config and page, but not with its key order or on/off state", () => {
    const base = adminPeekKey({ kind: "home" }, row());
    expect(adminPeekKey({ kind: "home" }, row({ config: { window: "30d" } }))).not.toEqual(base);
    expect(adminPeekKey({ kind: "home" }, row({ sectionType: "most_watched" }))).not.toEqual(base);
    expect(adminPeekKey({ kind: "library", libraryId: 7 }, row())).not.toEqual(base);
    expect(
      adminPeekKey(
        { kind: "home" },
        row({ config: { b: 1, a: 2 }, shown: false, hero: true, title: "Renamed" }),
      ),
    ).toEqual(adminPeekKey({ kind: "home" }, row({ config: { a: 2, b: 1 } })));
  });
});

describe("createLimiter", () => {
  it("never runs more than its limit at once and starts waiting tasks in order", async () => {
    const run = createLimiter(4);
    const gates = Array.from({ length: 7 }, deferred);
    const started: number[] = [];
    let active = 0;
    let peak = 0;
    const results = gates.map((gate, index) =>
      run(async () => {
        started.push(index);
        active += 1;
        peak = Math.max(peak, active);
        await gate.promise;
        active -= 1;
        return index;
      }),
    );
    await flush();
    expect(started).toEqual([0, 1, 2, 3]);

    gates[2]!.resolve();
    await flush();
    expect(started).toEqual([0, 1, 2, 3, 4]);

    gates.forEach((gate) => gate.resolve());
    expect(await Promise.all(results)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(peak).toBe(4);
  });

  it("frees the slot when a task fails", async () => {
    const run = createLimiter(1);
    await expect(run(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(run(async () => "next")).resolves.toBe("next");
  });

  it("drops a waiting task whose signal aborts, without giving it a slot", async () => {
    const run = createLimiter(1);
    const gate = deferred();
    const first = run(() => gate.promise);
    const controller = new AbortController();
    let ranAborted = false;
    const aborted = run(async () => {
      ranAborted = true;
    }, controller.signal);
    const third = run(async () => "third");
    controller.abort();
    await expect(aborted).rejects.toBeDefined();

    gate.resolve();
    await first;
    await expect(third).resolves.toBe("third");
    expect(ranAborted).toBe(false);
  });

  it("refuses a task whose signal has already aborted", async () => {
    const run = createLimiter(1);
    const controller = new AbortController();
    controller.abort();
    let ran = false;
    await expect(
      run(async () => {
        ran = true;
      }, controller.signal),
    ).rejects.toBeDefined();
    expect(ran).toBe(false);
  });
});

describe("profilePeekKey", () => {
  it("sits outside the section keys and names the row's kind, config and size", () => {
    const base = profilePeekKey({ kind: "home" }, row());
    expect(base[0]).not.toBe(sectionKeys.all[0]);
    expect(base).not.toEqual(adminPeekKey({ kind: "home" }, row()));
    expect(profilePeekKey({ kind: "home" }, row({ itemLimit: 30 }))).not.toEqual(base);
    expect(profilePeekKey({ kind: "home" }, row({ config: { window: "30d" } }))).not.toEqual(base);
  });
});

describe("profilePeekSeed", () => {
  const section = {
    id: "a",
    section_type: "trending_on_server",
    title: "Trending This Week",
    featured: false,
    item_limit: 20,
    total_count: 3,
    is_custom: false,
    customized: false,
    items: [1, 2, 3, 4].map((n) => ({
      content_id: `m${n}`,
      title: `Movie ${n}`,
      poster_url: `/p/${n}`,
      poster_thumbhash: "",
    })),
  } as unknown as ResolvedSection;
  const cached = { data: { section }, dataUpdatedAt: 1000 };

  it("shows Home's cached titles while the peek loads", () => {
    expect(profilePeekSeed(cached, row(), undefined)).toEqual(peekItemsOf(section));
    expect(peekItemsOf(section)).toEqual([
      { id: "m1", title: "Movie 1", posterUrl: "/p/1", thumbhash: undefined },
      { id: "m2", title: "Movie 2", posterUrl: "/p/2", thumbhash: undefined },
      { id: "m3", title: "Movie 3", posterUrl: "/p/3", thumbhash: undefined },
    ]);
  });

  it("skips a cached row of another kind or size, or one this tab changed since", () => {
    expect(profilePeekSeed(undefined, row(), undefined)).toBeUndefined();
    expect(
      profilePeekSeed(cached, row({ sectionType: "most_watched" }), undefined),
    ).toBeUndefined();
    expect(profilePeekSeed(cached, row({ itemLimit: 10 }), undefined)).toBeUndefined();
    expect(profilePeekSeed(cached, row(), 1000)).toBeUndefined();
    expect(profilePeekSeed(cached, row(), 999)).toEqual(peekItemsOf(section));
  });
});
