import { useEffect, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Pencil } from "lucide-react";
import { TouchSensor } from "@dnd-kit/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HomeRow, HomeRowsAdapter, PageRef, Surface } from "@/lib/homeRows/types";
import { HomeRowsPage } from "./HomeRowsPage";
import { useRowFocus } from "./useRowFocus";

const dnd = vi.hoisted(() => ({ sensorOptions: vi.fn() }));
vi.mock("@dnd-kit/core", async () => {
  const actual = await vi.importActual<typeof import("@dnd-kit/core")>("@dnd-kit/core");
  return {
    ...actual,
    useSensor: ((sensor, options) => {
      dnd.sensorOptions(sensor, options);
      return actual.useSensor(sensor, options);
    }) as typeof actual.useSensor,
  };
});

function makeRow(id: string, overrides: Partial<HomeRow> = {}): HomeRow {
  return {
    id,
    title: `Row ${id.toUpperCase()}`,
    sectionType: "recently_added",
    config: {},
    itemLimit: 20,
    hero: false,
    shown: true,
    own: false,
    legacyTrakt: false,
    ...overrides,
  };
}

function makeHarness() {
  return {
    reorder: vi.fn<(ids: string[], token: unknown) => void>(),
    setPage: vi.fn<(ref: PageRef) => void>(),
    reload: vi.fn<() => Promise<void>>(async () => {}),
    onClear: vi.fn<() => void>(),
    onSelect: vi.fn<(id: string, checked: boolean, extendRange: boolean) => void>(),
    settle: () => {},
    setOrderToken: (_token: string) => {},
  };
}

let harness: ReturnType<typeof makeHarness>;

function FakePage({
  initialRows,
  surface = "admin",
  page = { kind: "home" },
  pending: initialPending = false,
  conflict = null,
  selectable = false,
}: {
  initialRows: HomeRow[];
  surface?: Surface;
  page?: PageRef;
  pending?: boolean;
  conflict?: HomeRowsAdapter["conflict"];
  selectable?: boolean;
}) {
  const [rows, setRows] = useState(initialRows);
  const [pending, setPending] = useState(initialPending);
  const [selected, setSelected] = useState<Set<string>>(new Set(selectable ? ["a"] : []));
  const [orderToken, setOrderToken] = useState("token-1");
  useEffect(() => {
    harness.settle = () => setPending(false);
    harness.setOrderToken = (token) => setOrderToken(token);
  });
  const adapter: HomeRowsAdapter = {
    surface,
    page,
    pages: [
      { ref: { kind: "home" }, label: "Home" },
      { ref: { kind: "library", libraryId: 7 }, label: "Movies" },
    ],
    setPage: harness.setPage,
    status: "ready",
    error: null,
    canEdit: true,
    rows,
    pending,
    conflict,
    reload: harness.reload,
    canReorder: !pending,
    orderToken,
    reorder: async (ids, token) => {
      harness.reorder(ids, token);
      setPending(true);
      setRows((current) => ids.map((id) => current.find((row) => row.id === id)!));
    },
    setShown: async (id, shown) =>
      setRows((current) => current.map((row) => (row.id === id ? { ...row, shown } : row))),
    setHero: async () => {},
  };
  const focus = useRowFocus(rows, pending);
  const { attachAddButton } = focus;
  return (
    <HomeRowsPage
      adapter={adapter}
      title="Home rows"
      subtitle="Subtitle"
      actions={<button ref={attachAddButton}>Add row</button>}
      focus={focus}
      selection={
        selectable
          ? {
              selectedIds: selected,
              onChange: harness.onSelect,
              onClear: () => {
                harness.onClear();
                setSelected(new Set());
              },
              label: (row) => `Select ${row.title}`,
            }
          : undefined
      }
      rowMenuItems={(_row, shared) => [
        { key: "edit", label: "Edit row…", icon: Pencil, onSelect: () => {} },
        shared.moveToTop,
        shared.moveToBottom,
      ]}
    />
  );
}

beforeEach(() => {
  harness = makeHarness();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openMenu(title: string) {
  await userEvent.click(screen.getByRole("button", { name: `More for ${title}` }));
  return screen.findByRole("menu");
}

describe("HomeRowsPage", () => {
  it("shows one line per row with its sentence, count and hero tag", () => {
    render(
      <FakePage
        initialRows={[
          makeRow("a", { hero: true }),
          makeRow("b", { sectionType: "trending_on_server", config: { window: "7d" } }),
          makeRow("c", { shown: false }),
        ]}
      />,
    );
    const list = screen.getByRole("list", { name: "Rows on Home" });
    const [first, second, third] = within(list).getAllByRole("listitem");
    expect(first).toHaveTextContent("Row AHero banner");
    expect(first).toHaveTextContent("Newest movies and episodes from all libraries·20 titles");
    expect(second).toHaveTextContent("Most played on this server in the last 7 days");
    expect(third).toHaveTextContent("Row C is off. Nobody sees this row.");
    expect(screen.getByText("3 rows · 2 on")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Row A is on for everyone" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Row C is off for everyone" })).not.toBeChecked();
    expect(screen.getByText(/Drag a row to move it/)).toBeInTheDocument();
  });

  it("keeps focus on the switch while a row collapses and expands", async () => {
    render(<FakePage initialRows={[makeRow("a"), makeRow("b")]} />);
    const toggle = () => screen.getByRole("switch", { name: /^Row A is/ });
    toggle().focus();
    await userEvent.keyboard(" ");
    expect(screen.getByText(/is off\. Nobody sees this row\./)).toBeInTheDocument();
    expect(document.activeElement).toBe(toggle());
    await userEvent.keyboard(" ");
    expect(screen.queryByText(/is off\. Nobody sees this row\./)).not.toBeInTheDocument();
    expect(document.activeElement).toBe(toggle());
    await userEvent.keyboard(" ");
    expect(document.activeElement).toBe(toggle());
    expect(toggle()).not.toBeChecked();
  });

  it("does not let a legacy Trakt row be turned back on", () => {
    render(<FakePage initialRows={[makeRow("a", { shown: false, legacyTrakt: true })]} />);
    expect(screen.getByRole("switch", { name: "Row A is off for everyone" })).toBeDisabled();
  });

  it("marks the current page and disables the switcher while a write is pending", async () => {
    const { unmount } = render(<FakePage initialRows={[makeRow("a")]} />);
    const group = screen.getByRole("group", { name: "Page" });
    expect(within(group).getByRole("button", { name: "Home" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await userEvent.click(within(group).getByRole("button", { name: "Movies" }));
    expect(harness.setPage).toHaveBeenCalledWith({ kind: "library", libraryId: 7 });
    unmount();

    render(<FakePage initialRows={[makeRow("a")]} pending />);
    expect(screen.getByRole("button", { name: "Movies" })).toBeDisabled();
  });

  it("explains library pages", () => {
    render(<FakePage initialRows={[makeRow("a")]} page={{ kind: "library", libraryId: 7 }} />);
    expect(screen.getByText("These rows show above the full Movies grid.")).toBeInTheDocument();
    expect(screen.getByText("Newest additions to this library", { exact: false })).toBeVisible();
  });

  it("offers Reload rows when the rows changed elsewhere", async () => {
    render(<FakePage initialRows={[makeRow("a")]} conflict={{ scope: "page" }} />);
    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent("Home rows changed since you opened this page.");
    await userEvent.click(within(banner).getByRole("button", { name: "Reload rows" }));
    expect(harness.reload).toHaveBeenCalled();
  });

  it("moves a row to the bottom from its menu and focuses its menu once the move settles", async () => {
    render(<FakePage initialRows={[makeRow("a"), makeRow("b"), makeRow("c")]} />);
    const menu = await openMenu("Row A");
    expect(within(menu).getByRole("menuitem", { name: "Move to top" })).toHaveAttribute(
      "data-disabled",
    );
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Move to bottom" }));
    expect(harness.reorder).toHaveBeenCalledWith(["b", "c", "a"], undefined);
    act(() => harness.settle());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "More for Row A" })),
    );
  });

  it("drags only by the grip, which does not scroll the page on touch", () => {
    render(<FakePage initialRows={[makeRow("a")]} />);
    const grip = screen.getByRole("button", { name: "Move Row A" });
    expect(grip).toHaveClass("touch-none");
    expect(grip).toHaveAttribute("aria-roledescription", "sortable");
    // A touch drag starts only after a press and hold, so a swipe still scrolls.
    expect(dnd.sensorOptions).toHaveBeenCalledWith(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    });
  });

  it("reorders with the keyboard against the version it picked up, and announces rows by title", async () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      const item = this.closest("li[data-row-id]");
      const index = item ? Array.from(item.parentElement!.children).indexOf(item) : 0;
      const top = item ? index * 60 : 0;
      const height = item ? 60 : 0;
      return {
        x: 0,
        y: top,
        top,
        left: 0,
        right: 800,
        bottom: top + height,
        width: 800,
        height,
        toJSON: () => ({}),
      } as DOMRect;
    });
    Element.prototype.scrollIntoView = vi.fn();
    render(<FakePage initialRows={[makeRow("a"), makeRow("b"), makeRow("c")]} />);
    const grip = screen.getByRole("button", { name: "Move Row A" });
    grip.focus();
    fireEvent.keyDown(grip, { code: "Space", key: " " });
    await screen.findByText("Picked up Row A, position 1 of 3.");
    // A refetch while the row is in the air brings a newer version.
    act(() => harness.setOrderToken("token-2"));
    fireEvent.keyDown(grip, { code: "ArrowDown", key: "ArrowDown" });
    await screen.findByText("Row A is now at position 2 of 3.");
    fireEvent.keyDown(grip, { code: "Space", key: " " });
    await waitFor(() => expect(harness.reorder).toHaveBeenCalledWith(["b", "a", "c"], "token-1"));
  });

  it("clears the selection on Escape inside the list, but not from an open menu", async () => {
    render(<FakePage initialRows={[makeRow("a"), makeRow("b")]} selectable />);
    const menu = await openMenu("Row B");
    fireEvent.keyDown(within(menu).getAllByRole("menuitem")[0]!, { key: "Escape" });
    expect(harness.onClear).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("checkbox", { name: "Select Row A" }), { key: "Escape" });
    expect(harness.onClear).toHaveBeenCalledTimes(1);
  });

  it("asks for a range when a row's checkbox is shift-clicked", () => {
    render(<FakePage initialRows={[makeRow("a"), makeRow("b")]} selectable />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Row B" }));
    expect(harness.onSelect).toHaveBeenLastCalledWith("b", true, false);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Row B" }), { shiftKey: true });
    expect(harness.onSelect).toHaveBeenLastCalledWith("b", true, true);
  });

  it("uses profile wording on the profile surface", () => {
    render(
      <FakePage
        surface="profile"
        page={{ kind: "library", libraryId: 7 }}
        initialRows={[makeRow("a", { own: true }), makeRow("b", { shown: false })]}
      />,
    );
    expect(screen.getByRole("switch", { name: "Show Row A on my Movies page" })).toBeChecked();
    expect(screen.getByText("Yours")).toBeInTheDocument();
    expect(screen.getByText(/is hidden on your Movies page\./)).toBeInTheDocument();
    expect(screen.getByText("2 rows · 1 shown")).toBeInTheDocument();
  });
});
