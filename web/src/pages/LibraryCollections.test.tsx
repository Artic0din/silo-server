import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import LibraryCollections from "./LibraryCollections";

vi.mock("@/hooks/queries/libraryCollections", () => ({
  useLibraryCollections: () => ({
    isLoading: false,
    data: {
      groups: [
        {
          id: "lcg_user_1",
          name: "My collections",
          kind: "user_collections",
          sort_mode: "manual",
          sort_order: 0,
          collections: [
            {
              id: "mine",
              title: "Rainy days",
              poster_url: "",
              item_count: 3,
              creator_profile_id: "p-me",
            },
            {
              id: "theirs",
              title: "Family night",
              poster_url: "",
              item_count: 5,
              creator_profile_id: "p-parent",
            },
          ],
        },
      ],
      ungrouped: null,
    },
  }),
}));
vi.mock("@/hooks/queries/profiles", () => ({
  useProfiles: () => ({
    data: [
      { id: "p-me", name: "Me" },
      { id: "p-parent", name: "Parent" },
    ],
  }),
}));
vi.mock("@/hooks/useCurrentProfile", () => ({
  useCurrentProfile: () => ({ profile: { id: "p-me" } }),
}));
vi.mock("@/hooks/useUICustomization", () => ({
  useUICustomization: () => ({
    cardPresentation: { poster_size: "medium", caption: "title_metadata" },
  }),
}));
vi.mock("@/hooks/queries/sidebarPins", () => ({
  useToggleSidebarPin: () => ({ togglePin: vi.fn(), isPinned: () => false, canToggle: false }),
}));
vi.mock("@/hooks/useViewTransition", () => ({ useViewTransitionNavigate: () => vi.fn() }));

describe("LibraryCollections", () => {
  it("labels another profile's shared collection with its owner", () => {
    render(
      <MemoryRouter>
        <LibraryCollections libraryId={1} />
      </MemoryRouter>,
    );
    expect(screen.getByText("by Parent")).toBeTruthy();
    expect(screen.queryByText("by Me")).toBeNull();
    expect(screen.getByText("User collection")).toBeTruthy();
  });
});
