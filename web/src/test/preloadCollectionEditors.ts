/**
 * Loads the collection editor page's lazily loaded earlier editors up front,
 * so a test's first render doesn't wait on a cold module transform (which,
 * under a loaded test run, can outlast a `findBy`).
 */
export async function preloadLegacyCollectionEditors() {
  await Promise.all([
    import("@/pages/AdminCollectionEditor"),
    import("@/pages/ImportedCollectionEditor"),
    import("@/pages/SmartCollectionWizard"),
    import("@/pages/userCollectionsShared"),
  ]);
}
