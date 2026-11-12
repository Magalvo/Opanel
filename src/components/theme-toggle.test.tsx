import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setTheme = vi.fn();
let currentTheme = "system";

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: currentTheme, setTheme }),
}));

const { ThemeToggle } = await import("./theme-toggle");

describe("ThemeToggle", () => {
  beforeEach(() => {
    setTheme.mockReset();
    currentTheme = "system";
  });

  it("offers light, dark and system", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: "Theme" }));

    const options = screen.getAllByRole("menuitemradio").map((item) => item.textContent);
    expect(options).toEqual(["Light", "Dark", "System"]);
  });

  it.each([
    ["Light", "light"],
    ["Dark", "dark"],
    ["System", "system"],
  ])("sets the theme when %s is chosen", async (label, value) => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: "Theme" }));
    await user.click(screen.getByRole("menuitemradio", { name: label }));

    expect(setTheme).toHaveBeenCalledExactlyOnceWith(value);
  });

  it("marks the current theme as selected", async () => {
    currentTheme = "dark";
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole("button", { name: "Theme" }));

    expect(screen.getByRole("menuitemradio", { name: "Dark" })).toBeChecked();
    expect(screen.getByRole("menuitemradio", { name: "Light" })).not.toBeChecked();
  });
});
