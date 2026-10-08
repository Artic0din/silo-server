import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminDownloadStorage, AdminDownloadStorageFile } from "@/api/v2/adminDownloadStorage";
import {
  makeDownloadDevice,
  makeStorage,
  makeStorageFile,
  makeStorageLocation,
} from "@/test/downloadStorage";

const mocks = vi.hoisted(() => ({
  storage: undefined as AdminDownloadStorage | undefined,
  files: [] as AdminDownloadStorageFile[],
  filesQuery: [] as unknown[],
  devicesQuery: [] as unknown[],
  deleteFiles: vi.fn(),
  cleanUp: vi.fn(),
  deleteUntracked: vi.fn(),
  revoke: vi.fn(),
  toastSuccess: vi.fn(),
}));

function page<T>(items: T[]) {
  return {
    data: { pages: [{ items, page: { has_more: false } }] },
    isLoading: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  };
}

vi.mock("@/hooks/queries/admin/downloadStorage", () => ({
  useAdminDownloadStorage: () => ({
    data: mocks.storage,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useAdminDownloadStorageFiles: (query: unknown) => {
    mocks.filesQuery.push(query);
    return page(mocks.files);
  },
  useAdminDownloadStorageEvents: () => page([]),
  useAdminDownloadDevices: (query: unknown) => {
    mocks.devicesQuery.push(query);
    return page([makeDownloadDevice()]);
  },
  useAdminDownloadDeviceEntries: () => page([]),
  useDeleteAdminDownloadStorageFiles: () => ({ mutate: mocks.deleteFiles, isPending: false }),
  useCleanUpAdminDownloadStorageLocation: () => ({
    mutate: mocks.cleanUp,
    isPending: false,
    variables: undefined,
  }),
  useDeleteAdminDownloadStorageUntrackedFiles: () => ({
    mutate: mocks.deleteUntracked,
    isPending: false,
  }),
  useRevokeAdminDownloads: () => ({ mutate: mocks.revoke, isPending: false }),
}));
vi.mock("@/hooks/queries/admin/nodes", () => ({
  useAdminNodes: () => ({ data: [], isLoading: false }),
  useUpdateNode: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, info: vi.fn(), error: vi.fn() },
}));

import AdminDownloads from "./AdminDownloads";

function renderAt(path = "/admin/downloads") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AdminDownloads />
    </MemoryRouter>,
  );
}

const scratchNode = makeStorageLocation({
  key: "node:9",
  kind: "node",
  name: "node-gpu-1",
  node_id: "9",
  dir: "/transcode/download-artifacts",
  dir_source: "default",
  usage: {
    ...makeStorageLocation().usage!,
    fs_used_bytes: 842e9,
    fs_total_bytes: 1000e9,
    shares_scratch: true,
    bytes: 471e9,
  },
  in_use_bytes: 389e9,
  cached_bytes: 44e9,
  untracked_files: 6,
  untracked_bytes: 38e9,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.storage = makeStorage({ locations: [makeStorageLocation(), scratchNode] });
  mocks.files = [];
  mocks.filesQuery = [];
  mocks.devicesQuery = [];
});
afterEach(cleanup);

describe("AdminDownloads storage tab", () => {
  it("shows each location's disk, records and warnings", () => {
    renderAt();
    expect(screen.getByRole("heading", { name: "Downloads" })).toBeInTheDocument();
    const node = screen.getByRole("region", { name: "node-gpu-1" });
    expect(within(node).getByText("Shares disk with transcode scratch")).toBeInTheDocument();
    expect(node.textContent).toContain("842 GB of 1.0 TB used (84%)");
    expect(within(node).getByText(/38 GB untracked/)).toBeInTheDocument();
    expect(screen.getByText("node-gpu-1 is at 84% disk.")).toBeInTheDocument();
    const server = screen.getByRole("region", { name: "Server" });
    expect(within(server).getByText(/On disk matches Silo's records/)).toBeInTheDocument();
  });

  it("runs clean-up for one location", () => {
    renderAt();
    const node = screen.getByRole("region", { name: "node-gpu-1" });
    fireEvent.click(within(node).getByRole("button", { name: /Clean up now/ }));
    expect(mocks.cleanUp).toHaveBeenCalledWith("node:9", expect.any(Object));
  });

  it("confirms before deleting untracked files", () => {
    renderAt();
    const node = screen.getByRole("region", { name: "node-gpu-1" });
    fireEvent.click(within(node).getByRole("button", { name: "Review" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete untracked files" }));
    expect(mocks.deleteUntracked).toHaveBeenCalledWith("node:9", expect.any(Object));
  });

  it("opens a location's files from its card", () => {
    renderAt();
    const node = screen.getByRole("region", { name: "node-gpu-1" });
    fireEvent.click(within(node).getByRole("button", { name: "Browse files" }));
    expect(mocks.filesQuery.at(-1)).toMatchObject({ location: "node:9" });
  });
});

describe("AdminDownloads prepared files tab", () => {
  it("deletes cached files and keeps in-use ones unless asked", () => {
    mocks.files = [
      makeStorageFile({ id: "art-dune" }),
      makeStorageFile({
        id: "art-opp",
        title: "Oppenheimer",
        state: "in_use",
        waiting: 1,
        finished: 0,
        bytes: 11.8e9,
      }),
    ];
    renderAt("/admin/downloads?tab=files");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select every listed file" }));
    fireEvent.click(screen.getByRole("button", { name: /Delete…/ }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/1 in use/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete 1 cached file" }));
    expect(mocks.deleteFiles).toHaveBeenCalledWith(
      { ids: ["art-dune"], includeInUse: false },
      expect.any(Object),
    );

    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Also delete the file in use/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete 2 files" }));
    expect(mocks.deleteFiles).toHaveBeenLastCalledWith(
      { ids: ["art-dune", "art-opp"], includeInUse: true },
      expect.any(Object),
    );
  });
});

describe("AdminDownloads device copies tab", () => {
  it("opens with the stale filter from the storage banner and revokes a whole device", () => {
    renderAt("/admin/downloads?tab=devices&stale=1");
    expect(mocks.devicesQuery.at(-1)).toMatchObject({ stale: true });
    fireEvent.click(screen.getByRole("button", { name: "Revoke all…" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/last seen/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Lost phone" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke 12 downloads" }));
    expect(mocks.revoke).toHaveBeenCalledWith(
      {
        target: { userId: "7", profileId: "p-maya", deviceId: "dev-pixel", pauseMonitors: true },
        reason: "Lost phone",
      },
      expect.any(Object),
    );
  });
});
