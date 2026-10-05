/**
 * Your collections cards drag from anywhere on the card, so the
 * card must not open after a drag, a press inside its ⋯ menu must not drag it,
 * and its confirm dialogs hand focus back to the ⋯ that opened them.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import listCollectionsOk from "../../../contracts/api/v2/fixtures/list_collections_ok.json";
import { personalCapabilities } from "@/test/fixtures/collectionAnswers";
import { installV2Recorder, v2Recorder } from "@/test/v2Recorder";
import Collections from "./Collections";

vi.mock("@/api/v2/request", async () => (await import("@/test/v2Recorder")).mockV2Request());
vi.mock("@/hooks/queries/profiles", () => ({
  useProfiles: () => ({
    data: [
      { id: "p-owner", name: "Owner" },
      { id: "p-kid", name: "Leo" },
    ],
  }),
}));
vi.mock("@/hooks/useCurrentProfile", () => ({
  useCurrentProfile: () => ({ profile: { id: "p-owner" } }),
}));
vi.mock("@/hooks/useUICustomization", () => ({
  useUICustomization: () => ({ cardPresentation: { poster_size: "medium", caption: "title" } }),
}));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

installV2Recorder();

const [rainyDays, familyNight] = listCollectionsOk.items;

beforeEach(() => {
  v2Recorder.answer("GET /api/v2/collections/capabilities", personalCapabilities);
  v2Recorder.answer("GET /api/v2/collections", {
    items: [{ ...rainyDays, is_shared: true }, familyNight],
  });
  v2Recorder.answer("GET /api/v2/collections/server", { libraries: [] });
  v2Recorder.answer("GET /api/v2/collections/order", { ordered_ids: ["c1", "c2"] });
});

function show() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <MemoryRouter initialEntries={["/collections"]}>
        <Routes>
          <Route path="/collections" element={<Collections />} />
          <Route path="*" element={<p>Somewhere else</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const pointer = { isPrimary: true, button: 0, pointerId: 1 };

/**
 * Presses on target, moves well past the drag threshold, and releases. Each
 * step is its own act(), so React renders between them as a browser would.
 */
function pointerDrag(target: Element) {
  act(() => void fireEvent.pointerDown(target, { ...pointer, clientX: 10, clientY: 10 }));
  act(() => void fireEvent.pointerMove(document, { ...pointer, clientX: 60, clientY: 10 }));
  act(() => void fireEvent.pointerMove(document, { ...pointer, clientX: 120, clientY: 10 }));
  act(() => void fireEvent.pointerUp(document, { ...pointer, clientX: 120, clientY: 10 }));
}

function cardOf(name: string) {
  return screen.getByRole("button", { name: `More for ${name}` }).closest("li")!;
}

describe("Dragging a Your collections card", () => {
  it("does not open the collection on the click that ends a pointer drag", async () => {
    show();
    await screen.findByRole("button", { name: "More for Rainy days" });
    const link = within(cardOf("Rainy days")).getAllByRole("link")[0]!;

    pointerDrag(link);
    expect(fireEvent.click(link)).toBe(false);
    expect(screen.queryByText("Somewhere else")).toBeNull();

    // Only that click: a moment later the card opens again.
    await vi.waitFor(() => {
      fireEvent.click(link);
      expect(screen.getByText("Somewhere else")).toBeInTheDocument();
    });
  });

  it("still opens the collection on a plain click", async () => {
    show();
    await screen.findByRole("button", { name: "More for Rainy days" });
    const link = within(cardOf("Rainy days")).getAllByRole("link")[0]!;

    fireEvent.click(link);
    expect(await screen.findByText("Somewhere else")).toBeInTheDocument();
  });

  it("does not drag the card when a press inside its ⋯ menu moves", async () => {
    show();
    await userEvent.click(await screen.findByRole("button", { name: "More for Rainy days" }));
    const remove = within(await screen.findByRole("menu")).getByRole("menuitem", {
      name: "Delete…",
    });

    pointerDrag(remove);
    expect(v2Recorder.operations()).not.toContain("GET /api/v2/collections/order");
    expect(cardOf("Rainy days")).toHaveStyle({ opacity: "1" });
  });
});

describe("Your collections confirm dialogs", () => {
  it("return focus to the card's ⋯ when Delete… is cancelled", async () => {
    show();
    const trigger = await screen.findByRole("button", { name: "More for Rainy days" });
    await userEvent.click(trigger);
    await userEvent.click(
      within(await screen.findByRole("menu")).getByRole("menuitem", { name: "Delete…" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await vi.waitFor(() => expect(trigger).toHaveFocus());
  });

  it("return focus to the card's ⋯ when stopping sharing is cancelled", async () => {
    show();
    const trigger = await screen.findByRole("button", { name: "More for Rainy days" });
    await userEvent.click(trigger);
    await userEvent.click(
      within(await screen.findByRole("menu")).getByRole("menuitemcheckbox", {
        name: "Show to other profiles",
      }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.keyboard("{Escape}");
    expect(dialog).not.toBeInTheDocument();

    await vi.waitFor(() => expect(trigger).toHaveFocus());
  });
});
