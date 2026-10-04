import { useQuery } from "@tanstack/react-query";
import {
  PEEK_GC_MS,
  PEEK_STALE_MS,
  runPeek,
  type PeekRequest,
  type PreviewItem,
} from "@/lib/homeRows/peek";

const NOTHING_YET: PreviewItem[] = [];

/**
 * A row's peek titles; empty until they load, and when there are none. Loads
 * only while `enabled` (the row is shown and has reached the screen), through
 * the page's shared budget of requests in flight.
 */
export function usePeek(request: PeekRequest, enabled: boolean): PreviewItem[] {
  const query = useQuery<PreviewItem[]>({
    queryKey: request.queryKey,
    queryFn: ({ signal }) => runPeek(() => request.fetch(signal), signal),
    placeholderData: () => request.placeholder?.(),
    enabled,
    staleTime: PEEK_STALE_MS,
    gcTime: PEEK_GC_MS,
    retry: false,
    refetchOnWindowFocus: false,
  });
  return query.data ?? NOTHING_YET;
}
