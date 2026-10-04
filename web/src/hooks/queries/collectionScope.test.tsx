import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import getCollectionOk from "../../../../contracts/api/v2/fixtures/get_collection_ok.json";
import { PERSONAL_SCOPE, SERVER_SCOPE, type CollectionScope } from "@/lib/collections/scope";
import { adminCollectionList, adminSmartCollection } from "@/test/fixtures/collectionAnswers";
import { installV2Recorder, v2Recorder } from "@/test/v2Recorder";
import { useScopeEditor } from "./collectionScope";

vi.mock("@/api/v2/request", async () => (await import("@/test/v2Recorder")).mockV2Request());

installV2Recorder();

const ETAG = '"/api/v2/collections/c1#1"';
let client: QueryClient;

function open(id: string | undefined, scope: CollectionScope = PERSONAL_SCOPE) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(({ current }) => useScopeEditor(scope, current), {
    wrapper,
    initialProps: { current: id },
  });
}

function listing(posterUrl: string) {
  return { items: [{ ...getCollectionOk, poster_url: posterUrl }] };
}

beforeEach(() => {
  v2Recorder.answer("GET /api/v2/collections", listing("https://images.example/listed.png"));
});

describe("useScopeEditor (personal)", () => {
  it("opens the collection with its ETag and the list's poster", async () => {
    let releaseSnapshot!: () => void;
    const listed = new Promise<void>((resolve) => (releaseSnapshot = resolve));
    v2Recorder.answer("GET /api/v2/collections/{id}", () => listed.then(() => getCollectionOk));
    const { result } = open("c1");
    await waitFor(() => expect(client.getQueryData(PERSONAL_SCOPE.keys.list)).toBeDefined());
    releaseSnapshot();
    await waitFor(() => expect(result.current.snapshot).toBeDefined());
    expect(result.current.snapshot!.etag).toBe(ETAG);
    expect(result.current.snapshot!.view).toMatchObject({
      id: "c1",
      name: "Rainy days",
      posterUrl: "https://images.example/listed.png",
      ownerProfileId: "p-owner",
    });
    expect(result.current.snapshot!.view.raw.poster_url).toBe("https://images.example/listed.png");
  });

  it("keeps the first snapshot through a background refetch", async () => {
    const { result } = open("c1");
    await waitFor(() => expect(result.current.snapshot).toBeDefined());
    v2Recorder.answer("GET /api/v2/collections/{id}", {
      ...getCollectionOk,
      name: "Renamed elsewhere",
    });
    v2Recorder.answer("GET /api/v2/collections", listing("https://images.example/new.png"));
    v2Recorder.bump("/api/v2/collections/c1");

    await act(() => client.invalidateQueries());
    await waitFor(() => expect(v2Recorder.callsOf("GET /api/v2/collections/{id}")).toHaveLength(2));

    expect(result.current.snapshot!.etag).toBe(ETAG);
    expect(result.current.snapshot!.view.name).toBe("Rainy days");
    expect(result.current.snapshot!.view.posterUrl).toBe("https://images.example/listed.png");
  });

  it("keeps the collection's own poster when the list could not be read", async () => {
    v2Recorder.answer("GET /api/v2/collections", () => {
      throw new Error("list unavailable");
    });
    v2Recorder.answer("GET /api/v2/collections/{id}", {
      ...getCollectionOk,
      poster_url: "https://images.example/own.png",
    });
    const { result } = open("c1");
    await waitFor(() => expect(result.current.snapshot).toBeDefined());
    expect(result.current.snapshot!.view.posterUrl).toBe("https://images.example/own.png");
  });

  it("opens without waiting for the list, as the personal editor always has", async () => {
    v2Recorder.answer("GET /api/v2/collections", () => new Promise(() => {}));
    v2Recorder.answer("GET /api/v2/collections/{id}", {
      ...getCollectionOk,
      poster_url: "https://images.example/own.png",
    });
    const { result } = open("c1");
    await waitFor(() => expect(result.current.snapshot).toBeDefined());
    expect(result.current.isLoading).toBe(false);
    expect(result.current.snapshot!.view.posterUrl).toBe("https://images.example/own.png");
  });

  it("reads no collection without an id, and is loading only until the list arrives", async () => {
    const { result } = open(undefined);
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.snapshot).toBeUndefined();
    expect(v2Recorder.callsOf("GET /api/v2/collections/{id}")).toEqual([]);
  });

  it("drops the kept snapshot when the page moves to another collection", async () => {
    const { result, rerender } = open("c1");
    await waitFor(() => expect(result.current.snapshot).toBeDefined());
    v2Recorder.answer("GET /api/v2/collections/{id}", () => new Promise(() => {}));
    rerender({ current: "c2" });
    expect(result.current.snapshot).toBeUndefined();
    expect(result.current.isLoading).toBe(true);
  });
});

describe("useScopeEditor (server)", () => {
  it("waits for the list, since the admin read carries no artwork", async () => {
    let releaseList!: () => void;
    const listReady = new Promise<void>((resolve) => (releaseList = resolve));
    const smart = adminSmartCollection({});
    v2Recorder.answer("GET /api/v2/admin/collections/{id}", smart);
    v2Recorder.answer("GET /api/v2/admin/collections", () =>
      listReady.then(() => adminCollectionList({ ...smart, poster_url: "listed.png" })),
    );
    const { result } = open("c1", SERVER_SCOPE as CollectionScope);
    await waitFor(() =>
      expect(client.getQueryData(SERVER_SCOPE.keys.snapshot("c1"))).toBeDefined(),
    );
    expect(result.current.snapshot).toBeUndefined();
    expect(result.current.isLoading).toBe(true);

    releaseList();
    await waitFor(() => expect(result.current.snapshot).toBeDefined());
    expect(result.current.isLoading).toBe(false);
    expect(result.current.snapshot!.view.posterUrl).toBe("listed.png");
  });
});
