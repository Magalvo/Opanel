import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

const { AppShell } = await import("./app-shell");

const account = {
  id: "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f",
  kind: "human" as const,
  name: "Ada Admin",
  email: "ada@example.com",
  role: "admin",
};

function renderShell(canManageAccounts = false) {
  return render(
    <AppShell defaultSidebarOpen account={account} canManageAccounts={canManageAccounts}>
      <p>page content</p>
    </AppShell>,
  );
}

describe("AppShell", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(Response.json({}))),
    );
  });

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

  it("has the account menu of the signed-in account in the top bar", () => {
    renderShell();

    const topBar = screen.getByRole("banner");
    expect(within(topBar).getByRole("button", { name: "Account menu" })).toHaveTextContent("A");
  });

  it("has a main navigation area that contains no links yet", () => {
    renderShell();

    const navigation = screen.getByRole("navigation", { name: "Main" });
    expect(within(navigation).queryAllByRole("link")).toHaveLength(0);
  });

  it("shows a People link to /people only to someone who can manage accounts", () => {
    renderShell(true);

    const navigation = screen.getByRole("navigation", { name: "Main" });
    expect(within(navigation).getByRole("link", { name: "People" })).toHaveAttribute(
      "href",
      "/people",
    );
  });

  it("shows no People link to anyone else", () => {
    renderShell(false);

    expect(screen.queryByRole("link", { name: "People" })).not.toBeInTheDocument();
  });

  it("shows the brand as a link to the home page", () => {
    renderShell();

    expect(screen.getByRole("link", { name: "Opanel" })).toHaveAttribute("href", "/");
  });
});
