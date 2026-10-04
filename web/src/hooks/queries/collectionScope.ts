import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { isNotFoundProblem, V2ProblemError } from "@/api/v2/request";
import type { CollectionScope, EditorSnapshot, WireCollection } from "@/lib/collections/scope";

/**
 * An editor read may carry no artwork URLs (they are presigned, and would move
 * its ETag), so a collection's artwork comes from the scope's list.
 */
function withListedArtwork<Raw extends WireCollection>(fetched: Raw, listed: Raw | undefined): Raw {
  if (!listed) return fetched;
  return "backdrop_url" in fetched && "backdrop_url" in listed
    ? { ...fetched, poster_url: listed.poster_url, backdrop_url: listed.backdrop_url }
    : { ...fetched, poster_url: listed.poster_url ?? fetched.poster_url };
}

/**
 * The collection an editor opens, with the ETag its next save must send.
 *
 * The editor reads the collection when it opens, even when the collection's
 * page cached a copy, so it never starts from a version whose save can only
 * answer 412. That read is kept for the life of the page, so a background
 * refetch never replaces what someone is editing. It carries the list's
 * artwork when the list is there; a scope with `editorAwaitsList` waits for
 * the list first. A 404 outranks the kept copy: the collection is gone.
 */
export function useScopeEditor<Raw extends WireCollection>(
  scope: CollectionScope<Raw>,
  id: string | undefined,
) {
  const list = useQuery({
    queryKey: scope.keys.list,
    queryFn: () => scope.fetchList(),
    select: (data) => data.collections,
  });
  const fetched = useScopeSnapshot(scope, id, { refetchOnMount: "always" });
  const [frozen, setFrozen] = useState<EditorSnapshot<Raw>>();
  const awaitingList = scope.editorAwaitsList && list.isLoading;
  const awaitingRead = Boolean(id) && !fetched.isFetchedAfterMount;
  if (
    fetched.data &&
    !awaitingList &&
    !awaitingRead &&
    fetched.data.view.id === id &&
    frozen?.view.id !== id
  ) {
    const listed = list.data?.find((entry) => entry.id === id);
    setFrozen({
      ...fetched.data,
      view: scope.toView(withListedArtwork(fetched.data.view.raw, listed)),
    });
  }
  const gone = isNotFoundProblem(fetched.error);
  return {
    snapshot: id && frozen?.view.id === id && !gone ? frozen : undefined,
    /** Still reading what the editor needs: the collection with an id, or the list without one. */
    isLoading: id ? awaitingRead || awaitingList : list.isLoading,
    isFetching: fetched.isFetching,
    error: fetched.error,
    refetch: fetched.refetch,
  };
}

/** The collection with the ETag a guarded write must send, on the key the editor reads. */
export function useScopeSnapshot<Raw extends WireCollection>(
  scope: CollectionScope<Raw>,
  id: string | undefined,
  { enabled = true, refetchOnMount }: { enabled?: boolean; refetchOnMount?: "always" } = {},
) {
  return useQuery({
    queryKey: scope.keys.snapshot(id ?? ""),
    queryFn: () => scope.fetchSnapshot(id!),
    enabled: enabled && Boolean(id),
    refetchOnMount,
  });
}

/** Sync now for a synced list: the mutation takes the collection id. */
export function useScopeSync<Raw extends WireCollection>(scope: CollectionScope<Raw>) {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (id: string) => scope.sync(id),
    onSuccess: (result, id) => {
      const matched = `${result.itemsMatched} item${result.itemsMatched === 1 ? "" : "s"}`;
      toast.success(
        result.status === "warning"
          ? `Synced with warnings — matched ${matched}`
          : `Synced — matched ${matched}`,
      );
      void scope.invalidate(queryClient, id);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Sync failed");
    },
  });
}

/**
 * Deletes a collection with the ETag its caller read. `onDeleted` runs before
 * the scope's queries refresh, so a page showing the collection can leave
 * before its own read answers 404. A 412 refreshes them, so the next try sends
 * the current version.
 */
export function useScopeDelete<Raw extends WireCollection>(
  scope: CollectionScope<Raw>,
  options: { onDeleted?: (id: string) => void } = {},
) {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (ref: { id: string; etag: string }) => scope.remove(ref),
    onSuccess: (_data, { id }) => {
      toast.success("Collection deleted");
      options.onDeleted?.(id);
      return scope.invalidate(queryClient, id);
    },
    onError: (error) => {
      toast.error(scope.errorMessage(error, "Failed to delete"));
      if (error instanceof V2ProblemError && error.status === 412)
        void scope.invalidate(queryClient);
    },
  });
}
