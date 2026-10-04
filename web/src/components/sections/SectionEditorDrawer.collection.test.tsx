import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PageSectionConfig, SettingsSectionEntry } from "@/api/types";
import type { CollectionOption } from "@/hooks/queries/useAllUserCollections";
import SectionEditorDrawer from "./SectionEditorDrawer";

const options = vi.hoisted(() => ({
  collections: [] as CollectionOption[],
  isLoading: false,
}));

vi.mock("@/hooks/queries/useAllUserCollections", () => ({
  useAllUserCollections: () => options,
}));

vi.mock("@/hooks/queries/libraries", () => ({
  useAvailableUserLibraries: () => ({ data: [] }),
}));

const COLLECTIONS: CollectionOption[] = [
  { id: "user-1", title: "Mine", source: "user", group: "My Collections" },
  { id: "lib-1", title: "Studio Ghibli", source: "library", group: "Movies" },
];

beforeEach(() => {
  options.collections = COLLECTIONS;
  options.isLoading = false;
});

function profileRow(config: Record<string, unknown>): SettingsSectionEntry {
  return {
    id: "row-1",
    section_type: "collection",
    title: "Shared Picks",
    featured: false,
    item_limit: 20,
    hidden: false,
    is_custom: true,
    customized: true,
    position: 2,
    config,
  };
}

function adminRow(config: Record<string, unknown>): PageSectionConfig {
  return {
    id: "row-1",
    scope: "home",
    library_id: null,
    position: 2,
    section_type: "collection",
    title: "Studio Ghibli",
    featured: false,
    item_limit: 20,
    config,
    enabled: true,
    created_at: "2026-01-02T03:04:05.000Z",
    updated_at: "2026-01-02T03:04:05.000Z",
  };
}

function renderProfile(section: SettingsSectionEntry) {
  const onSave = vi.fn<(section: SettingsSectionEntry) => void>();
  render(
    <SectionEditorDrawer
      mode="profile"
      open
      onOpenChange={() => {}}
      section={section}
      libraries={[]}
      onSave={onSave}
    />,
  );
  return onSave;
}

function renderAdmin(section: PageSectionConfig) {
  const onSave = vi.fn<(section: Partial<PageSectionConfig>) => void>();
  render(
    <SectionEditorDrawer
      mode="admin"
      open
      onOpenChange={() => {}}
      section={section}
      scope="home"
      currentLibraryId={null}
      libraries={[]}
      onSave={onSave}
    />,
  );
  return onSave;
}

async function rename(name: string) {
  const title = screen.getByPlaceholderText("Collection");
  await userEvent.clear(title);
  await userEvent.type(title, name);
}

describe("SectionEditorDrawer collection rows", () => {
  it("keeps a personal collection the picker list doesn't hold after a rename", async () => {
    const config = { user_collection_id: "shared-with-me", sort_by: "release_date" };
    const onSave = renderProfile(profileRow(config));

    await rename("Weekend Picks");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]![0]).toMatchObject({ title: "Weekend Picks", config });
  });

  it("keeps every other config key on a hero toggle", async () => {
    const config = { library_collection_id: "lib-1", generated_source: "collection_auto" };
    const onSave = renderProfile(profileRow(config));

    await userEvent.click(screen.getByRole("switch", { name: "Featured" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave.mock.calls[0]![0]).toMatchObject({ featured: true, config });
  });

  it("writes the picked collection's key and drops the old one", async () => {
    const onSave = renderProfile(
      profileRow({ library_collection_id: "lib-1", sort_by: "release_date" }),
    );

    await userEvent.click(screen.getByRole("combobox", { name: "Collection" }));
    await userEvent.click(await screen.findByRole("button", { name: "Mine" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave.mock.calls[0]![0].config).toEqual({
      user_collection_id: "user-1",
      sort_by: "release_date",
    });
  });

  it("can't save while the collection list is loading", () => {
    options.collections = [];
    options.isLoading = true;
    renderProfile(profileRow({ user_collection_id: "user-1" }));

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("can't save an admin collection row while the collection list is loading", () => {
    options.collections = [];
    options.isLoading = true;
    renderAdmin(adminRow({ library_collection_id: "lib-1" }));

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("keeps an admin row's stored collection key on a rename", async () => {
    const config = { user_collection_id: "legacy", sort_by: "title" };
    const onSave = renderAdmin(adminRow(config));

    await rename("Ghibli");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave.mock.calls[0]![0]).toMatchObject({ title: "Ghibli", config });
  });
});
