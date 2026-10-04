import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { v2 } from "@/api/v2/request";
import { discoveryFromV2, importBodyToV2, importFromV2 } from "@/api/personalCollections";
import type {
  ImportUserMDBListCollectionRequest,
  ImportUserTMDBCollectionRequest,
  ImportUserTMDBListCollectionRequest,
} from "@/api/types";
import { TEMPLATE_STALE_TIME, type CollectionTemplateCatalog } from "@/lib/collectionTemplates";
import { PERSONAL_SCOPE } from "@/lib/collections/scope";
import { useScopeSync } from "./collectionScope";
import { collectionKeys } from "./keys";

export function useUserCollectionTemplates(enabled = true) {
  return useQuery({
    queryKey: collectionKeys.templates(),
    queryFn: () =>
      v2("GET /api/v2/collections/templates").then((value) => value as CollectionTemplateCatalog),
    enabled,
    staleTime: TEMPLATE_STALE_TIME,
  });
}

export function useMDBListSearch(query: string, enabled = true) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: collectionKeys.mdblistSearch(trimmed),
    queryFn: () =>
      v2("GET /api/v2/collections/import/mdblist/search", { query: { q: trimmed } }).then(
        discoveryFromV2,
      ),
    enabled: enabled && trimmed.length > 0,
    staleTime: 60_000,
  });
}

export function useMDBListTop(enabled = true) {
  return useQuery({
    queryKey: collectionKeys.mdblistTop(),
    queryFn: () => v2("GET /api/v2/collections/import/mdblist/top").then(discoveryFromV2),
    enabled,
    staleTime: 5 * 60_000,
  });
}

function importToastMessage(label: string, status: string | undefined) {
  if (status === "warning") return `${label} imported with warnings`;
  if (status === "failed") return `${label} imported but sync failed`;
  return `${label} imported`;
}

export function useImportUserMDBListCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ImportUserMDBListCollectionRequest) =>
      v2("POST /api/v2/collections/import/mdblist", { body: importBodyToV2(body) }).then(
        importFromV2,
      ),
    onSuccess: (result) => {
      toast.success(importToastMessage("MDBList", result.sync?.status));
      void PERSONAL_SCOPE.invalidate(queryClient);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Import failed");
    },
  });
}

export function useImportUserTMDBCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ImportUserTMDBCollectionRequest) =>
      v2("POST /api/v2/collections/import/tmdb", { body: importBodyToV2(body) }).then(importFromV2),
    onSuccess: (result) => {
      toast.success(importToastMessage("TMDB collection", result.sync?.status));
      void PERSONAL_SCOPE.invalidate(queryClient);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Import failed");
    },
  });
}

export function useImportUserTMDBListCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ImportUserTMDBListCollectionRequest) =>
      v2("POST /api/v2/collections/import/tmdb-list", { body: importBodyToV2(body) }).then(
        importFromV2,
      ),
    onSuccess: (result) => {
      toast.success(importToastMessage("TMDB list", result.sync?.status));
      void PERSONAL_SCOPE.invalidate(queryClient);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Import failed");
    },
  });
}

export function useSyncUserCollection() {
  return useScopeSync(PERSONAL_SCOPE);
}
