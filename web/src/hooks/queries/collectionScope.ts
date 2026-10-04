import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { isNotFoundProblem } from "@/api/v2/request";
import type { CollectionScope, EditorSnapshot, WireCollection } from "@/lib/collections/scope";

/**
 * The editor read carries no artwork URLs (they are presigned, and would move
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
 * The first snapshot for an id is kept for the life of the page, so a
 * background refetch never replaces what someone is editing. It is taken once
 * the scope's list has settled, to carry the list's artwork. A 404 outranks
 * the kept copy: the collection is gone.
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
  const fetched = useQuery({
    queryKey: scope.keys.snapshot(id ?? ""),
    queryFn: () => scope.fetchSnapshot(id!),
    enabled: Boolean(id),
  });
  const [frozen, setFrozen] = useState<EditorSnapshot<Raw>>();
  if (fetched.data && !list.isLoading && fetched.data.view.id === id && frozen?.view.id !== id) {
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
    isLoading: id ? fetched.isLoading || list.isLoading : list.isLoading,
    isFetching: fetched.isFetching,
    error: fetched.error,
    refetch: fetched.refetch,
  };
}
