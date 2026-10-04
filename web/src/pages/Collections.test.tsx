import { describe, expect, it } from "vitest";
import type { Collection, QueryDefinition } from "@/api/types";

import {
  buildUserCollectionCatalogHref,
  toCreateCollectionBody,
  toUpdateCollectionBody,
  toUserCollectionBuilderValue,
} from "./userCollectionsShared";

describe("Collections helpers", () => {
  it("serializes the sharing switch, and no profile list, into the request bodies", () => {
    const builder = toUserCollectionBuilderValue(null);
    builder.title = "Action Night";
    builder.is_shared = true;

    expect(toCreateCollectionBody(builder)).toMatchObject({
      name: "Action Night",
      is_shared: true,
    });
    expect(toCreateCollectionBody(builder)).not.toHaveProperty("allowed_profile_ids");
    expect(toUpdateCollectionBody(builder)).toMatchObject({ is_shared: true });
    expect(toUpdateCollectionBody(builder)).not.toHaveProperty("allowed_profile_ids");
  });

  it.each([
    ["no limit", undefined, undefined],
    ["the server's no-limit sentinel", 10_000_000, undefined],
    ["an explicit limit", 250, 250],
  ])("saves a smart collection with %s without changing it", (_label, stored, sent) => {
    const queryDefinition: QueryDefinition = {
      library_ids: [],
      match: "all",
      groups: [],
      sort: { field: "added_at", order: "desc" },
      limit: stored,
    };
    const draft = toUserCollectionBuilderValue({
      id: "col-1",
      name: "Big Picks",
      collection_type: "smart",
      query_definition: queryDefinition,
    } as Collection);
    const sentLimit = (body: unknown) =>
      JSON.parse(JSON.stringify(body)).query_definition.limit as number | undefined;

    expect(draft.query_definition.limit).toBe(sent);
    expect(sentLimit(toUpdateCollectionBody(draft))).toBe(sent);
    expect(sentLimit(toCreateCollectionBody(draft))).toBe(sent);
  });

  it("sends a canonical display_query_definition fragment for manual collections", () => {
    const builder = toUserCollectionBuilderValue(null);
    builder.title = "Unwatched Movies";
    builder.collection_type = "manual";
    builder.display_query_definition = {
      match: "all",
      groups: [
        {
          match: "all",
          rules: [
            { field: "watched", op: "is", value: false },
            { field: "type", op: "is", value: "movie" },
          ],
        },
      ],
    };

    const createBody = toCreateCollectionBody(builder);
    expect(createBody.display_query_definition).toEqual({
      match: "all",
      groups: [
        {
          match: "all",
          rules: [
            { field: "watched", op: "is", value: false },
            { field: "type", op: "is", value: "movie" },
          ],
        },
      ],
    });
    expect(createBody).not.toHaveProperty("watch_filter");
    expect(createBody).not.toHaveProperty("media_filter");

    const updateBody = toUpdateCollectionBody(builder);
    expect(updateBody.display_query_definition).toEqual(createBody.display_query_definition);
    expect(updateBody).not.toHaveProperty("watch_filter");
    expect(updateBody).not.toHaveProperty("media_filter");
  });

  it("omits display_query_definition for manual collections with no display filter", () => {
    const builder = toUserCollectionBuilderValue(null);
    builder.collection_type = "manual";
    builder.display_query_definition = undefined;

    const createBody = toCreateCollectionBody(builder);
    expect(createBody.display_query_definition).toBeUndefined();
    expect(createBody).not.toHaveProperty("watch_filter");
  });

  it("builds the catalog route for viewing a user collection", () => {
    expect(buildUserCollectionCatalogHref("col-3", "Shared Picks")).toBe(
      "/catalog?source=user_collection&collection_id=col-3&title=Shared+Picks",
    );
  });
});
