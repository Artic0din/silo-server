/* eslint-disable react-refresh/only-export-components */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SettingsGroup } from "@/components/settings/SettingsGroup";
import { useProfileHomeRows } from "@/hooks/queries/homeRows/useProfileHomeRows";
import { useUserLibraries } from "@/hooks/queries/libraries";
import type { SettingsSectionEntry } from "@/api/types";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import SectionEditorDrawer from "@/components/sections/SectionEditorDrawer";
import HomeLayoutTransfer from "@/components/sections/HomeLayoutTransfer";
import RecipeGalleryModal from "@/components/RecipeGallery/RecipeGalleryModal";
import RecipeConfigDrawer from "@/components/RecipeGallery/RecipeConfigDrawer";
import type { AddPayload } from "@/components/RecipeGallery/RecipeConfigDrawer";
import { buildProfileGallerySection } from "@/lib/homeRows/payloads";
import type { GalleryPreset, RecipeDefinition } from "@/lib/recipes";
import { fetchRecipeCatalog } from "@/lib/recipes";
import { canAddAdminOnlyRecipes } from "@/lib/sectionTypes";
import type { PageRef } from "@/lib/homeRows/types";
import { Plus } from "lucide-react";
import {
  SectionDragOverlay,
  SortableSectionCardRow,
  type EditableSectionViewModel,
} from "@/components/sections/EditableSectionRows";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragStartEvent, DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { toast } from "sonner";
import { v2 } from "@/api/v2/request";
import { useOptionalAuth } from "@/hooks/useAuth";
import {
  useEffectiveSettings,
  useSetSettingValue,
  type SettingIdentity,
} from "@/hooks/queries/settingValues";
import { SETTING_KEYS } from "@/lib/settingsContract";

export { buildProfileGallerySection };
export {
  applySectionDeletion,
  buildSectionOverrides,
  canMutateSectionSettings,
  createOverrideIdSource,
  hydrateRemovedSystemSections,
  sectionSaveErrorMessage,
  shouldRestoreLatestSaveFailure,
  shouldRestoreSelectionState,
} from "@/lib/homeRows/profileOverrides";

const PROFILE_SCOPE: SettingIdentity = { scope: "profile" };
const HOME_PREFERENCE_KEYS = [SETTING_KEYS.HOME_HIDE_WATCHED_ITEMS] as const;

function toEditableSection(section: SettingsSectionEntry): EditableSectionViewModel {
  return {
    id: section.id,
    title: section.title,
    sectionType: section.section_type,
    itemLimit: section.item_limit,
    featured: section.featured,
    hidden: section.hidden,
    isCustom: section.is_custom,
    config: section.config,
  };
}

export default function HomeScreenSettings() {
  const { data: libraries } = useUserLibraries();
  const { data: recipeCatalog } = useQuery({
    queryKey: ["recipe-catalog"],
    queryFn: fetchRecipeCatalog,
    staleTime: 5 * 60 * 1000,
  });
  const role = useOptionalAuth()?.user?.role;
  const { data: sectionFlags } = useQuery({
    queryKey: ["profile-section-flags"],
    queryFn: () => v2("GET /api/v2/profile/sections/flags"),
    staleTime: 5 * 60 * 1000,
  });
  const allowAdminOnlyRecipes = canAddAdminOnlyRecipes(
    role,
    sectionFlags?.allow_profile_custom_sections,
  );

  // Page and section data; every section save goes through the hook.
  const homeRows = useProfileHomeRows();
  const { scope, sections: orderedSections } = homeRows;
  const scopeValue = homeRows.page.kind === "home" ? "home" : `library:${homeRows.page.libraryId}`;
  const canEditSections = homeRows.canEdit;
  const homePreferences = useEffectiveSettings({ keys: HOME_PREFERENCE_KEYS });
  const saveHomePreference = useSetSettingValue();
  const hideWatchedItems =
    homePreferences.data?.[SETTING_KEYS.HOME_HIDE_WATCHED_ITEMS]?.value === true;

  // DnD state
  const [activeId, setActiveId] = useState<string | null>(null);

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerSection, setDrawerSection] = useState<SettingsSectionEntry | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [pickedRecipe, setPickedRecipe] = useState<{
    def: RecipeDefinition;
    preset: GalleryPreset;
  } | null>(null);

  // Reset confirm state
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [pendingDeleteSection, setPendingDeleteSection] = useState<SettingsSectionEntry | null>(
    null,
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // DnD handlers
  function handleDragStart(event: DragStartEvent) {
    if (!canEditSections) {
      return;
    }
    setActiveId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    if (!canEditSections) {
      setActiveId(null);
      return;
    }
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    homeRows.move(String(active.id), String(over.id));
  }

  function handleDragCancel() {
    setActiveId(null);
  }

  const activeSection = activeId ? (orderedSections.find((s) => s.id === activeId) ?? null) : null;

  // Toggle visibility
  function handleToggleHidden(id: string) {
    if (!canEditSections) {
      return;
    }
    const section = orderedSections.find((s) => s.id === id);
    if (section) homeRows.setHidden(id, !section.hidden);
  }

  function handleRequestDelete(section: SettingsSectionEntry) {
    if (!canEditSections) {
      return;
    }
    setPendingDeleteSection(section);
    setConfirmDeleteOpen(true);
  }

  function handleConfirmDelete() {
    if (!pendingDeleteSection || !canEditSections) {
      return;
    }

    homeRows.remove(pendingDeleteSection.id);
    if (activeId === pendingDeleteSection.id) {
      setActiveId(null);
    }
    setConfirmDeleteOpen(false);
    setPendingDeleteSection(null);
  }

  function handleDeleteDialogChange(open: boolean) {
    setConfirmDeleteOpen(open);
    if (!open) {
      setPendingDeleteSection(null);
    }
  }

  function handleOpenAdd() {
    if (!canEditSections) {
      return;
    }
    setDrawerSection(null);
    setDrawerOpen(true);
  }

  function handleOpenEdit(section: SettingsSectionEntry) {
    if (!canEditSections) {
      return;
    }
    setDrawerSection(section);
    setDrawerOpen(true);
  }

  function handleDrawerSave(updated: SettingsSectionEntry) {
    if (!canEditSections) {
      return;
    }
    homeRows.saveSection(updated);
  }

  // Reset
  function handleReset() {
    if (!canEditSections) {
      return;
    }
    setConfirmResetOpen(true);
  }

  function handleScopeChange(value: string) {
    const page: PageRef =
      value === "home"
        ? { kind: "home" }
        : { kind: "library", libraryId: Number(value.split(":")[1]) };
    // Refused while this page still has saves to send.
    if (!homeRows.setPage(page)) return;
    setActiveId(null);
    setConfirmResetOpen(false);
    setConfirmDeleteOpen(false);
    setPendingDeleteSection(null);
    setDrawerOpen(false);
    setDrawerSection(null);
    setGalleryOpen(false);
    setPickedRecipe(null);
  }

  function handleAddFromGallery(payload: AddPayload) {
    if (!canEditSections) {
      return;
    }
    homeRows.saveSection(buildProfileGallerySection(payload, orderedSections.length));
    setPickedRecipe(null);
  }

  function handleHideWatchedItemsChange(enabled: boolean) {
    saveHomePreference.mutate(
      {
        key: SETTING_KEYS.HOME_HIDE_WATCHED_ITEMS,
        value: enabled,
        identity: PROFILE_SCOPE,
      },
      { onError: () => toast.error("Failed to save Home preference") },
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Home screen</h2>
        <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
          Choose a scope, then arrange the sections that appear on that screen.
        </p>
      </div>

      <ConfirmDialog
        open={confirmResetOpen}
        onOpenChange={(open) => {
          if (!open) setConfirmResetOpen(false);
        }}
        title="Reset section customizations"
        description="Reset all section customizations to defaults? This action cannot be undone."
        confirmLabel="Reset"
        variant="default"
        onConfirm={() => {
          setConfirmResetOpen(false);
          homeRows.reset();
        }}
      />

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={handleDeleteDialogChange}
        title={pendingDeleteSection?.is_custom ? "Delete custom section?" : "Remove section?"}
        description={
          pendingDeleteSection?.is_custom
            ? "Delete this custom section?"
            : "Remove this section from your home screen?"
        }
        confirmLabel={pendingDeleteSection?.is_custom ? "Delete" : "Remove"}
        variant="destructive"
        onConfirm={handleConfirmDelete}
      />

      <SettingsGroup
        title="Home preferences"
        description="Choose how this profile's Home screen handles completed media."
      >
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="hide-watched-home" className="text-sm font-medium">
              Hide watched items
            </Label>
            <p className="text-muted-foreground text-[13px] leading-relaxed">
              Remove watched items from ordinary Home sections. Featured and watch-history sections
              keep them.
            </p>
          </div>
          <Switch
            id="hide-watched-home"
            checked={hideWatchedItems}
            disabled={homePreferences.isLoading || saveHomePreference.isPending}
            onCheckedChange={handleHideWatchedItemsChange}
          />
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Scope"
        description="Pick the home screen or library-specific view you want to customize."
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">Editing scope</Label>
            <p className="text-muted-foreground text-[13px] leading-relaxed">
              Changes apply only to the selected home screen.
            </p>
          </div>
          <Select value={scopeValue} onValueChange={handleScopeChange}>
            <SelectTrigger className="w-full sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="home">Home</SelectItem>
              {libraries?.map((lib) => (
                <SelectItem key={lib.id} value={`library:${lib.id}`}>
                  {lib.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Sections"
        description="Add, reorder, or hide sections. Drag to change order."
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setGalleryOpen(true)}
            disabled={!canEditSections}
          >
            <Plus className="mr-1 h-4 w-4" /> Add from Gallery
          </Button>
          <Button size="sm" onClick={handleOpenAdd} disabled={!canEditSections}>
            <Plus className="mr-1 h-4 w-4" /> Add Section
          </Button>
          <Button size="sm" variant="outline" onClick={handleReset} disabled={!canEditSections}>
            Reset to Default
          </Button>
          <Badge variant="secondary" className="ml-auto">
            {orderedSections.length} sections
          </Badge>
        </div>
        {!canEditSections ? (
          <p className="text-muted-foreground text-[13px]">
            {homeRows.overridesFailed
              ? "Saved section state failed to load. Editing is disabled."
              : "Loading saved section state before section changes are enabled."}
          </p>
        ) : null}

        <DndContext
          sensors={canEditSections ? sensors : []}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext
            items={orderedSections.map((s) => s.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {orderedSections.map((section) => (
                <SortableSectionCardRow
                  key={section.id}
                  section={toEditableSection(section)}
                  catalog={recipeCatalog}
                  onToggleHidden={() => handleToggleHidden(section.id)}
                  onEdit={() => handleOpenEdit(section)}
                  onDelete={() => handleRequestDelete(section)}
                  disabled={!canEditSections}
                />
              ))}
              {orderedSections.length === 0 && (
                <div className="surface-panel-subtle text-muted-foreground rounded-[1.2rem] py-8 text-center text-sm">
                  No sections configured.
                </div>
              )}
            </div>
          </SortableContext>
          <DragOverlay>
            {activeSection ? (
              <SectionDragOverlay
                section={toEditableSection(activeSection)}
                catalog={recipeCatalog}
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      </SettingsGroup>

      <SettingsGroup
        title="Export and import"
        description="Save this profile's Home and library layouts to a file, or load one exported from another profile or server."
      >
        <HomeLayoutTransfer />
      </SettingsGroup>

      <SectionEditorDrawer
        mode="profile"
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        section={drawerSection}
        libraries={libraries ?? []}
        recipeCatalog={recipeCatalog}
        libraryScoped={scope === "library"}
        allowAdminOnlyRecipes={allowAdminOnlyRecipes}
        onSave={handleDrawerSave}
      />

      <RecipeGalleryModal
        open={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        hideAdminOnly
        onPick={(def, preset) => {
          setGalleryOpen(false);
          setPickedRecipe({ def, preset });
        }}
      />

      {pickedRecipe ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <RecipeConfigDrawer
            def={pickedRecipe.def}
            preset={pickedRecipe.preset}
            showBulkApply={false}
            showEnabled={false}
            libraryScoped={scope === "library"}
            onCancel={() => setPickedRecipe(null)}
            onBackToGallery={() => {
              setPickedRecipe(null);
              setGalleryOpen(true);
            }}
            onAdd={handleAddFromGallery}
          />
        </div>
      ) : null}
    </div>
  );
}
