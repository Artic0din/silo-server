/**
 * Loads the collection editor page's lazily loaded server create chooser up
 * front, so a test's first render doesn't wait on a cold module transform
 * (which, under a loaded test run, can outlast a `findBy`).
 */
export async function preloadLegacyCollectionEditors() {
  await import("@/pages/AdminCollectionEditor");
}
