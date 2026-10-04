import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AddToCollectionDialog from "./AddToCollectionDialog";

vi.mock("@/hooks/queries/collections", () => ({
  useCollections: () => ({
    isLoading: false,
    data: [
      { id: "mine", name: "My manual list", collection_type: "manual", creator_profile_id: "p-me" },
      {
        id: "mine-smart",
        name: "My smart list",
        collection_type: "smart",
        creator_profile_id: "p-me",
      },
      {
        id: "theirs",
        name: "Parent's shared list",
        collection_type: "manual",
        creator_profile_id: "p-parent",
        is_shared: true,
      },
    ],
  }),
  useAddItemToCollection: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/queries/libraries", () => ({ useUserLibraries: () => ({ data: [] }) }));
vi.mock("@/hooks/useIsActingAdmin", () => ({ useIsActingAdmin: () => false }));
vi.mock("@/hooks/useCurrentProfile", () => ({
  useCurrentProfile: () => ({ profile: { id: "p-me" } }),
}));

describe("AddToCollectionDialog", () => {
  it("offers only the profile's own manual collections", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AddToCollectionDialog open onOpenChange={vi.fn()} mediaItemId="item" />
      </QueryClientProvider>,
    );
    expect(screen.getByText("My manual list")).toBeTruthy();
    // Another profile's shared collection is read-only for this profile.
    expect(screen.queryByText("Parent's shared list")).toBeNull();
    expect(screen.queryByText("My smart list")).toBeNull();
  });
});
