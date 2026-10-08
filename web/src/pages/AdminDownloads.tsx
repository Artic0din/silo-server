import { useSearchParams } from "react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import DeviceCopiesTab from "@/pages/admin-downloads/DeviceCopiesTab";
import HistoryTab from "@/pages/admin-downloads/HistoryTab";
import PreparedFilesTab from "@/pages/admin-downloads/PreparedFilesTab";
import StorageTab, { type StorageTabTarget } from "@/pages/admin-downloads/StorageTab";
import {
  parseAdminDownloadsTab,
  type AdminDownloadsTab,
} from "@/pages/admin-downloads/adminDownloadsTabs";

export default function AdminDownloads() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = parseAdminDownloadsTab(searchParams.get("tab"));
  const location = searchParams.get("location") ?? "";

  function open(next: AdminDownloadsTab, extra: Record<string, string> = {}) {
    const params = new URLSearchParams();
    if (next !== "storage") params.set("tab", next);
    for (const [key, value] of Object.entries(extra)) if (value) params.set(key, value);
    setSearchParams(params, { replace: true });
  }

  function navigate(target: StorageTabTarget) {
    if (target === "devices") open("devices", { stale: "1" });
    else open("files", { location: target.files });
  }

  return (
    <div className="space-y-5 lg:space-y-6">
      <div className="page-header">
        <div className="space-y-3">
          <h1 className="page-title text-[clamp(2rem,4vw,3.25rem)]">Downloads</h1>
          <p className="page-subtitle text-sm sm:text-base">
            Prepared download files on the server and nodes, and the copies on people's devices.
          </p>
        </div>
      </div>
      <Tabs
        value={tab}
        onValueChange={(value) => open(parseAdminDownloadsTab(value))}
        className="gap-5 lg:gap-6"
      >
        <TabsList variant="line" className="border-border w-full justify-start border-b">
          <TabsTrigger value="storage" className="flex-none">
            Storage
          </TabsTrigger>
          <TabsTrigger value="files" className="flex-none">
            Prepared files
          </TabsTrigger>
          <TabsTrigger value="devices" className="flex-none">
            Device copies
          </TabsTrigger>
          <TabsTrigger value="history" className="flex-none">
            History
          </TabsTrigger>
        </TabsList>
        <TabsContent value="storage">
          <StorageTab onNavigate={navigate} />
        </TabsContent>
        <TabsContent value="files">
          <PreparedFilesTab
            location={location}
            onLocationChange={(next) => open("files", { location: next })}
          />
        </TabsContent>
        <TabsContent value="devices">
          <DeviceCopiesTab
            key={searchParams.get("stale") ?? ""}
            initialStale={searchParams.get("stale") === "1"}
          />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
