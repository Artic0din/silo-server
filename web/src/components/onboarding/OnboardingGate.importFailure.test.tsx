import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocalErrorBoundary } from "@/components/LocalErrorBoundary";

vi.mock("@/api/client", () => ({ captureProfileRequestContext: () => null }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ profile: { id: "profile-1" } }) }));
vi.mock("@/hooks/queries/onboarding", () => ({
  useOnboardingState: () => ({ data: { done: false } }),
  useOnboardingProgress: () => ({ isError: false, mutate: vi.fn() }),
  useOnboardingFlow: () => ({ data: { steps: [{ id: "welcome" }] } }),
}));
vi.mock("@/lib/onboarding", () => ({
  isTourSuppressed: () => false,
  clearTourSuppressed: vi.fn(),
}));
vi.mock("./TourHost", () => {
  throw new Error("Tour chunk unavailable");
});

import { OnboardingGate } from "./OnboardingGate";

afterEach(() => vi.restoreAllMocks());

it("keeps Home usable and offers a reload when the tour import fails", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  render(
    <LocalErrorBoundary fallback={<div role="alert">Application failed</div>}>
      <OnboardingGate>
        <div>Home content</div>
      </OnboardingGate>
    </LocalErrorBoundary>,
  );

  await screen.findByRole("alert");
  expect(screen.getByText("Home content")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Reload page" })).toBeInTheDocument();
});
