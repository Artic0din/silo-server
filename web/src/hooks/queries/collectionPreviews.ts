import { useQuery } from "@tanstack/react-query";

import type { CollectionPreviewRequest, QueryDefinition, QueryDefinitionInput } from "@/api/types";
import { normalizeQueryDefinition } from "@/api/types";
import { PERSONAL_SCOPE, SERVER_SCOPE } from "@/lib/collections/scope";

export function buildCollectionPreviewRequest(
  queryDefinition?: QueryDefinition | QueryDefinitionInput | null,
  limit = 12,
): CollectionPreviewRequest {
  return {
    query_definition: normalizeQueryDefinition(queryDefinition),
    limit,
  };
}

export function previewFingerprint(
  scope: "user" | "admin",
  request: CollectionPreviewRequest,
): string {
  return JSON.stringify({
    scope,
    limit: request.limit ?? 12,
    query_definition: normalizeQueryDefinition(request.query_definition),
  });
}

function useCollectionPreview(scope: "user" | "admin", request?: CollectionPreviewRequest | null) {
  const collectionScope = scope === "user" ? PERSONAL_SCOPE : SERVER_SCOPE;
  const normalized = request
    ? buildCollectionPreviewRequest(request.query_definition, request.limit)
    : null;

  return useQuery({
    queryKey: collectionScope.keys.preview(
      normalized ? previewFingerprint(scope, normalized) : "disabled",
    ),
    queryFn: () => collectionScope.preview(normalized!.query_definition, normalized!.limit ?? 12),
    enabled: normalized !== null,
    staleTime: 30_000,
  });
}

export function useAdminCollectionPreview(request?: CollectionPreviewRequest | null) {
  return useCollectionPreview("admin", request);
}

export function useUserCollectionPreview(request?: CollectionPreviewRequest | null) {
  return useCollectionPreview("user", request);
}
