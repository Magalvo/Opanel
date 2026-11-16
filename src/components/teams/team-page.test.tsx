import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Person } from "@/lib/schemas/people";
import type { Team } from "@/lib/schemas/teams";

import { bodyOf, calls, installFetch, on, problem } from "./testing";

const router = { replace: vi.fn(), refresh: vi.fn(), push: vi.fn() };

vi.mock("next/navigation", () => ({ useRouter: () => router }));

const { TeamPage } = await import("./team-page");

const TEAM_ID = "11111111-1111-4111-8111-111111111111";
const TEAM_URL = `/api/v1/teams/${TEAM_ID}`;

const ada: Person = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Ada", active: true };
const bob: Person = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Bob", active: false };
const adele: Person = { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "Adele", active: true };
const adam: Person = { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", name: "Adam", active: false };

function team(members: Person[], name = "Frontend"): Team {
  return {
    id: TEAM_ID,
    name,
    members,
    createdAt: "2026-11-12T10:00:00.000Z",
    updatedAt: "2026-11-12T10:00:00.000Z",
  };
}

function json(body: unknown, status = 200) {
  return () => Response.json(body, { status });
}

async function renderLoaded(canManageTeams = true, members: Person[] = [ada, bob]) {
  on(`GET ${TEAM_URL}`, json(team(members)));
  const user = userEvent.setup();
  render(<TeamPage teamId={TEAM_ID} canManageTeams={canManageTeams} />);
  await screen.findByRole("heading", { level: 1, name: "Frontend" });
  return user;
}

function status() {
  return screen.getByRole("status");
}

beforeEach(() => {
  router.push.mockReset();
  installFetch();
});

describe("TeamPage: reading", () => {
  it("shows a placeholder, then the name and the members, a deactivated one marked", async () => {
    on(`GET ${TEAM_URL}`, json(team([ada, bob])));

    render(<TeamPage teamId={TEAM_ID} canManageTeams={false} />);
    expect(screen.getByText("Loading the team…")).toBeInTheDocument();

    expect(await screen.findByRole("heading", { level: 1, name: "Frontend" })).toBeVisible();
    const table = screen.getByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Member"]);
    expect(within(screen.getByRole("row", { name: /Bob/ })).getByText("Deactivated")).toBeVisible();
    expect(within(screen.getByRole("row", { name: /Ada/ })).queryByText("Deactivated")).toBeNull();
    expect(screen.getByRole("link", { name: "All teams" })).toHaveAttribute("href", "/teams");
  });

  it("says when the team has no members", async () => {
    await renderLoaded(false, []);

    expect(screen.getByText("No members yet.")).toBeInTheDocument();
  });

  it("says a team that the API does not know does not exist, with a way back", async () => {
    on(`GET ${TEAM_URL}`, problem(404, "not_found"));

    render(<TeamPage teamId={TEAM_ID} canManageTeams />);

    expect(await screen.findByText("This team does not exist.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All teams" })).toHaveAttribute("href", "/teams");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("shows any other failure with Retry", async () => {
    on(`GET ${TEAM_URL}`, problem(500, "internal_error"));
    const user = userEvent.setup();
    render(<TeamPage teamId={TEAM_ID} canManageTeams />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the team.");
    on(`GET ${TEAM_URL}`, json(team([ada])));
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Frontend" })).toBeVisible();
  });

  it("shows no control to someone who cannot manage teams", async () => {
    await renderLoaded(false);

    for (const name of ["Rename", "Add member", "Delete team", /^Remove/]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });
});

describe("TeamPage: rename", () => {
  it("prefills the name, shows a taken name at the field, then renames", async () => {
    const user = await renderLoaded();

    await user.click(screen.getByRole("button", { name: "Rename" }));
    const dialog = screen.getByRole("dialog", { name: "Rename team" });
    const field = within(dialog).getByLabelText("Name");
    expect(field).toHaveValue("Frontend");

    on(`PATCH ${TEAM_URL}`, problem(409, "team_name_taken"));
    await user.clear(field);
    await user.type(field, "Backend");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText("Another team has this name.")).toBeInTheDocument();

    on(`PATCH ${TEAM_URL}`, json(team([ada, bob], "Web")));
    await user.clear(field);
    await user.type(field, "Web");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Web" })).toBeVisible();
    expect(bodyOf(calls("PATCH").at(-1)?.[1])).toEqual({ name: "Web" });
    expect(status()).toHaveTextContent("The team is now called Web.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("checks the name in the browser before sending", async () => {
    const user = await renderLoaded();

    await user.click(screen.getByRole("button", { name: "Rename" }));
    const dialog = screen.getByRole("dialog", { name: "Rename team" });
    await user.clear(within(dialog).getByLabelText("Name"));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(within(dialog).getByText("Enter a name.")).toBeInTheDocument();
    expect(calls("PATCH")).toHaveLength(0);
  });
});

describe("TeamPage: add a member", () => {
  it("searches people once typing stops, offering only active people who are not members", async () => {
    on("GET /api/v1/people?q=Ad&limit=20", json({ items: [ada, adele, adam], nextCursor: null }));
    const user = await renderLoaded(true, [ada]);

    await user.click(screen.getByRole("button", { name: "Add member" }));
    const dialog = screen.getByRole("dialog", { name: "Add a member" });
    await user.type(within(dialog).getByLabelText("Search people"), "Ad");

    expect(await within(dialog).findByRole("button", { name: "Add Adele" })).toBeVisible();
    expect(within(dialog).queryByRole("button", { name: "Add Ada" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Add Adam" })).not.toBeInTheDocument();
    expect(calls("GET").filter(([url]) => url.startsWith("/api/v1/people"))).toHaveLength(1);
  });

  it("adds the chosen person and shows the team as the API returns it", async () => {
    on("GET /api/v1/people?q=Ade&limit=20", json({ items: [adele], nextCursor: null }));
    on(`POST ${TEAM_URL}/members`, json(team([ada, adele])));
    const user = await renderLoaded(true, [ada]);

    await user.click(screen.getByRole("button", { name: "Add member" }));
    const dialog = screen.getByRole("dialog", { name: "Add a member" });
    await user.type(within(dialog).getByLabelText("Search people"), "Ade");
    await user.click(await within(dialog).findByRole("button", { name: "Add Adele" }));

    expect(await screen.findByRole("row", { name: /Adele/ })).toBeVisible();
    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({ accountId: adele.id });
    expect(status()).toHaveTextContent("Adele was added to Frontend.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("says when the person was deactivated meanwhile", async () => {
    on("GET /api/v1/people?q=Ade&limit=20", json({ items: [adele], nextCursor: null }));
    on(`POST ${TEAM_URL}/members`, problem(409, "account_inactive"));
    const user = await renderLoaded(true, [ada]);

    await user.click(screen.getByRole("button", { name: "Add member" }));
    const dialog = screen.getByRole("dialog", { name: "Add a member" });
    await user.type(within(dialog).getByLabelText("Search people"), "Ade");
    await user.click(await within(dialog).findByRole("button", { name: "Add Adele" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Adele is deactivated and cannot be added.",
    );
    expect(screen.queryByRole("row", { name: /Adele/ })).not.toBeInTheDocument();
  });

  it("says when nobody matches", async () => {
    on("GET /api/v1/people?q=Zed&limit=20", json({ items: [], nextCursor: null }));
    const user = await renderLoaded(true, [ada]);

    await user.click(screen.getByRole("button", { name: "Add member" }));
    const dialog = screen.getByRole("dialog", { name: "Add a member" });
    await user.type(within(dialog).getByLabelText("Search people"), "Zed");

    expect(await within(dialog).findByText("Nobody to add matches “Zed”.")).toBeVisible();
  });
});

describe("TeamPage: remove a member", () => {
  it("removes with a named button and announces it", async () => {
    on(`DELETE ${TEAM_URL}/members/${bob.id}`, () => new Response(null, { status: 204 }));
    const user = await renderLoaded();

    await user.click(screen.getByRole("button", { name: "Remove Bob from Frontend" }));

    await vi.waitFor(() => {
      expect(screen.queryByRole("row", { name: /Bob/ })).not.toBeInTheDocument();
    });
    expect(status()).toHaveTextContent("Bob was removed from Frontend.");
  });

  it("keeps the row and says so when removing fails", async () => {
    on(`DELETE ${TEAM_URL}/members/${bob.id}`, problem(500, "internal_error"));
    const user = await renderLoaded();

    await user.click(screen.getByRole("button", { name: "Remove Bob from Frontend" }));

    await vi.waitFor(() => {
      expect(status()).toHaveTextContent("Could not remove Bob. Try again.");
    });
    expect(screen.getByRole("row", { name: /Bob/ })).toBeVisible();
  });
});

describe("TeamPage: delete the team", () => {
  it("asks first; Cancel does nothing", async () => {
    const user = await renderLoaded();

    await user.click(screen.getByRole("button", { name: "Delete team" }));
    const confirm = screen.getByRole("alertdialog", { name: "Delete Frontend?" });
    expect(confirm).toHaveTextContent("Its members stay; only the team goes.");
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));

    expect(calls("DELETE")).toHaveLength(0);
  });

  it("deletes and goes back to the list", async () => {
    on(`DELETE ${TEAM_URL}`, () => new Response(null, { status: 204 }));
    const user = await renderLoaded();

    await user.click(screen.getByRole("button", { name: "Delete team" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }),
    );

    await vi.waitFor(() => {
      expect(router.push).toHaveBeenCalledWith("/teams");
    });
  });

  it("keeps a team that tasks use and says why", async () => {
    on(`DELETE ${TEAM_URL}`, problem(409, "team_in_use"));
    const user = await renderLoaded();

    await user.click(screen.getByRole("button", { name: "Delete team" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }),
    );

    await vi.waitFor(() => {
      expect(status()).toHaveTextContent(
        "Tasks are assigned to this team. Assign them elsewhere before deleting it.",
      );
    });
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "Frontend" })).toBeVisible();
  });
});
