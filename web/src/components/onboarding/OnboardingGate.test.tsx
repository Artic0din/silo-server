import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { state, loadTour } = vi.hoisted(() => ({
  state: { done: true },
  loadTour: vi.fn(),
}));

vi.mock("@/api/client", () => ({ captureProfileRequestContext: () => null }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ profile: { id: "profile-1" } }) }));
vi.mock("@/hooks/queries/onboarding", () => ({
  useOnboardingState: () => ({ data: state }),
  useOnboardingProgress: () => ({ isError: false, mutate: vi.fn() }),
  useOnboardingFlow: () => ({ data: { steps: [{ id: "welcome" }] } }),
}));
vi.mock("@/lib/onboarding", () => ({
  isTourSuppressed: () => false,
  clearTourSuppressed: vi.fn(),
}));
vi.mock("./TourHost", () => {
  loadTour();
  return { TourHost: () => <div role="dialog">First-run tour</div> };
});

import { OnboardingGate } from "./OnboardingGate";

describe("onboarding tour loading", () => {
  it("does not load the tour UI for a profile that completed onboarding", () => {
    render(
      <OnboardingGate>
        <div>Home content</div>
      </OnboardingGate>,
    );

    expect(screen.getByText("Home content")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(loadTour).not.toHaveBeenCalled();
  });

  it("loads a needed tour while keeping Home content mounted", async () => {
    state.done = false;
    render(
      <OnboardingGate>
        <div>Home content</div>
      </OnboardingGate>,
    );

    expect(screen.getByText("Home content")).toBeInTheDocument();
    expect(await screen.findByRole("dialog")).toHaveTextContent("First-run tour");
    expect(screen.getByText("Home content")).toBeInTheDocument();
    expect(loadTour).toHaveBeenCalledOnce();
  });
});
