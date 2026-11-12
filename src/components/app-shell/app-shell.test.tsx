import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppShell } from "./app-shell";

function renderShell() {
  return render(
    <AppShell defaultSidebarOpen>
      <p>page content</p>
    </AppShell>,
  );
}

describe("AppShell", () => {
  it("renders the page inside the main region", () => {
    renderShell();

    expect(within(screen.getByRole("main")).getByText("page content")).toBeInTheDocument();
  });

  it("has a top bar with the sidebar and theme controls", () => {
    renderShell();

    const topBar = screen.getByRole("banner");
    expect(within(topBar).getByRole("button", { name: "Toggle sidebar" })).toBeInTheDocument();
    expect(within(topBar).getByRole("button", { name: "Theme" })).toBeInTheDocument();
  });

  it("has a main navigation area that contains no links yet", () => {
    renderShell();

    const navigation = screen.getByRole("navigation", { name: "Main" });
    expect(within(navigation).queryAllByRole("link")).toHaveLength(0);
  });

  it("shows the brand as a link to the home page", () => {
    renderShell();

    expect(screen.getByRole("link", { name: "Opanel" })).toHaveAttribute("href", "/");
  });
});
