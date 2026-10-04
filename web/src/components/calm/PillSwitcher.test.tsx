import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PillSwitcher } from "./PillSwitcher";

afterEach(cleanup);

const OPTIONS = [
  { value: "all", label: "All libraries" },
  { value: "7", label: "Movies", separated: true },
  { value: "9", label: "Kids" },
];

describe("PillSwitcher", () => {
  it("presses the current pill and reports a different one", async () => {
    const onChange = vi.fn();
    render(
      <PillSwitcher
        label="Library"
        options={OPTIONS}
        value="7"
        onChange={onChange}
        summary="12 collections"
      />,
    );
    expect(screen.getByRole("group", { name: "Library" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Movies" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("12 collections")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Movies" }));
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Kids" }));
    expect(onChange).toHaveBeenCalledWith("9");
  });

  it("can't be used while disabled", () => {
    render(
      <PillSwitcher label="Library" options={OPTIONS} value="all" onChange={vi.fn()} disabled />,
    );
    for (const option of OPTIONS)
      expect(screen.getByRole("button", { name: option.label })).toBeDisabled();
  });
});
