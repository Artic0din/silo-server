/** The tabs of the Downloads admin page, in display order. */
export type AdminDownloadsTab = "storage" | "files" | "devices" | "history";
const TABS: readonly AdminDownloadsTab[] = ["storage", "files", "devices", "history"];

/** The tab a `?tab=` value names; anything missing or unknown opens Storage. */
export function parseAdminDownloadsTab(value: string | null): AdminDownloadsTab {
  return (TABS as readonly string[]).includes(value ?? "")
    ? (value as AdminDownloadsTab)
    : "storage";
}
