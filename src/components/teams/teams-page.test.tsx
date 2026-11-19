import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bodyOf, calls, installFetch, on, problem } from "@/components/fake-api";
import type { TeamSummary } from "@/lib/schemas/teams";

const router = { replace: vi.fn(), refresh: vi.fn(), push: vi.fn() };

vi.mock("next/navigation", () => ({ useRouter: () => router }));

const { TeamsPage } = await import("./teams-page");

function team(id: string, name: string, memberCount: number): TeamSummary {
  return { id, name, memberCount, createdAt: "2026-11-12T10:00:00.000Z" };
}

const backend = team("11111111-1111-4111-8111-111111111111", "Backend", 3);
const frontend = team("22222222-2222-4222-8222-222222222222", "Frontend", 1);
const qa = team("33333333-3333-4333-8333-333333333333", "QA", 0);

const FIRST = "GET /api/v1/teams?limit=50";

function page(items: TeamSummary[], nextCursor: string | null = null) {
  return () => Response.json({ items, nextCursor });
}

async function renderLoaded(canManageTeams = true, items = [backend, frontend]) {
  on(FIRST, page(items));
  const user = userEvent.setup();
  render(<TeamsPage canManageTeams={canManageTeams} />);
  await screen.findByRole(items.length === 0 ? "heading" : "table");
  return user;
}

beforeEach(() => {
  router.push.mockReset();
  installFetch();
});

describe("TeamsPage: the list", () => {
  it("shows a placeholder, then each team as a link with its member count", async () => {
    on(FIRST, page([backend, frontend]));

    render(<TeamsPage canManageTeams={false} />);
    expect(screen.getByText("Loading teams…")).toBeInTheDocument();

    const table = await screen.findByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Team", "Members"]);
    expect(within(table).getByRole("link", { name: "Backend" })).toHaveAttribute(
      "href",
      `/teams/${backend.id}`,
    );
    expect(within(screen.getByRole("row", { name: /Frontend/ })).getByText("1")).toBeVisible();
    expect(screen.getByRole("heading", { level: 1, name: "Teams" })).toBeInTheDocument();
  });

  it("says when there are no teams yet", async () => {
    await renderLoaded(false, []);

    expect(await screen.findByText("No teams yet.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows an error with Retry, which loads again", async () => {
    on(FIRST, problem(500, "internal_error"));
    const user = userEvent.setup();
    render(<TeamsPage canManageTeams={false} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load teams.");
    on(FIRST, page([backend]));
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("link", { name: "Backend" })).toBeInTheDocument();
  });

  it("loads more with the cursor, appends, and hides the button on the last page", async () => {
    on(FIRST, page([backend, frontend], "c1"));
    on("GET /api/v1/teams?limit=50&cursor=c1", page([qa]));
    const user = userEvent.setup();
    render(<TeamsPage canManageTeams={false} />);
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByRole("link", { name: "QA" })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(4);
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });
});

describe("TeamsPage: paging (WS-080)", () => {
  it("shows a team that comes back with a later page once", async () => {
    on(FIRST, page([backend, frontend], "c1"));
    on("GET /api/v1/teams?limit=50&cursor=c1", page([frontend, qa]));
    const user = userEvent.setup();
    render(<TeamsPage canManageTeams={false} />);
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByRole("link", { name: "QA" })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(4);
  });
});

describe("TeamsPage: a new team", () => {
  it("has no New team button for someone who cannot manage teams", async () => {
    await renderLoaded(false);

    expect(screen.queryByRole("button", { name: "New team" })).not.toBeInTheDocument();
  });

  it("checks the name in the browser before sending", async () => {
    const user = await renderLoaded();

    await user.click(screen.getByRole("button", { name: "New team" }));
    const dialog = screen.getByRole("dialog", { name: "New team" });
    await user.type(within(dialog).getByLabelText("Name"), "   ");
    await user.click(within(dialog).getByRole("button", { name: "Create team" }));

    expect(within(dialog).getByText("Enter a name.")).toBeInTheDocument();
    expect(calls("POST")).toHaveLength(0);
  });

  it("shows a taken name at the field", async () => {
    on("POST /api/v1/teams", problem(409, "team_name_taken"));
    const user = await renderLoaded();

    await user.click(screen.getByRole("button", { name: "New team" }));
    const dialog = screen.getByRole("dialog", { name: "New team" });
    await user.type(within(dialog).getByLabelText("Name"), "backend");
    await user.click(within(dialog).getByRole("button", { name: "Create team" }));

    expect(await within(dialog).findByText("Another team has this name.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("creates the team and goes to its page", async () => {
    const created = {
      id: qa.id,
      name: qa.name,
      members: [],
      createdAt: qa.createdAt,
      updatedAt: qa.createdAt,
    };
    on("POST /api/v1/teams", () => Response.json(created, { status: 201 }));
    const user = await renderLoaded();

    await user.click(screen.getByRole("button", { name: "New team" }));
    const dialog = screen.getByRole("dialog", { name: "New team" });
    await user.type(within(dialog).getByLabelText("Name"), "QA");
    await user.click(within(dialog).getByRole("button", { name: "Create team" }));

    await vi.waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(`/teams/${qa.id}`);
    });
    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({ name: "QA" });
  });

  it("closes with Escape and returns focus to the New team button", async () => {
    const user = await renderLoaded();
    const button = screen.getByRole("button", { name: "New team" });

    await user.click(button);
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });
});
