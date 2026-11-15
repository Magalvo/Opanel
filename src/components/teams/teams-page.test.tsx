import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Team, TeamSummary } from "@/lib/schemas/teams";

const { TeamsPage } = await import("./teams-page");

const PLATFORM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DESIGN_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MIA = { id: "11111111-1111-4111-8111-111111111111", name: "Mia", active: true };
const MAX = { id: "22222222-2222-4222-8222-222222222222", name: "Max", active: false };
const GRACE = { id: "33333333-3333-4333-8333-333333333333", name: "Grace", active: true };

function summary(id: string, name: string, memberCount: number): TeamSummary {
  return { id, name, memberCount, createdAt: "2026-11-12T10:00:00.000Z" };
}

function team(id: string, name: string, members: Team["members"]): Team {
  return {
    id,
    name,
    members,
    createdAt: "2026-11-12T10:00:00.000Z",
    updatedAt: "2026-11-12T10:00:00.000Z",
  };
}

const platform = summary(PLATFORM_ID, "Platform", 2);
const design = summary(DESIGN_ID, "Design", 0);

function problem(status: number, body: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      type: "about:blank",
      title: "Problem",
      status,
      code: "invalid_request",
      detail: "A problem.",
      requestId: "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f",
      ...body,
    }),
    { status, headers: { "Content-Type": "application/problem+json" } },
  );
}

const fetchMock = vi.fn<typeof fetch>();
const responses = new Map<string, () => Response>();

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function on(key: string, response: () => Response) {
  responses.set(key, response);
}

function calls(method: string): [string, RequestInit | undefined][] {
  return fetchMock.mock.calls
    .filter(([, init]) => (init?.method ?? "GET") === method)
    .map(([url, init]) => [urlOf(url), init]);
}

function bodyOf(init: RequestInit | undefined): unknown {
  return JSON.parse(typeof init?.body === "string" ? init.body : "null");
}

function list(items: TeamSummary[], nextCursor: string | null = null) {
  return () => Response.json({ items, nextCursor });
}

async function renderLoaded(canManage: boolean, items: TeamSummary[] = [platform, design]) {
  on("GET /api/v1/teams?limit=50", list(items));
  const user = userEvent.setup();
  render(<TeamsPage canManage={canManage} />);
  await screen.findByRole("table");
  return user;
}

function row(name: string) {
  return screen.getByRole("row", { name: new RegExp(name) });
}

async function openTeam(
  user: ReturnType<typeof userEvent.setup>,
  buttonName: string,
  dialogName: string,
) {
  await user.click(screen.getByRole("button", { name: buttonName }));
  return screen.findByRole("dialog", { name: dialogName });
}

beforeEach(() => {
  fetchMock.mockReset();
  responses.clear();
  fetchMock.mockImplementation((input, init) => {
    const key = `${init?.method ?? "GET"} ${urlOf(input)}`;
    const respond = responses.get(key);
    if (!respond) throw new Error(`unexpected request: ${key}`);
    return Promise.resolve(respond());
  });
  vi.stubGlobal("fetch", fetchMock);
});

describe("TeamsPage: the list", () => {
  it("shows a placeholder while loading, then the teams with their member counts", async () => {
    on("GET /api/v1/teams?limit=50", list([platform, design]));

    render(<TeamsPage canManage={false} />);
    expect(screen.getByText("Loading teams…")).toBeInTheDocument();

    const table = await screen.findByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Team", "Members", "Actions"]);
    expect(within(row("Platform")).getByText("2")).toBeInTheDocument();
    expect(within(row("Design")).getByText("0")).toBeInTheDocument();
  });

  it("says it could not load and retries", async () => {
    on("GET /api/v1/teams?limit=50", () => problem(500, { code: "internal_error" }));
    const user = userEvent.setup();
    render(<TeamsPage canManage={false} />);

    expect(await screen.findByText("Could not load teams.")).toBeInTheDocument();
    on("GET /api/v1/teams?limit=50", list([platform]));
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("loads more with the cursor, appends, and stops offering it on the last page", async () => {
    on("GET /api/v1/teams?limit=50", list([platform], "CURSOR1"));
    on("GET /api/v1/teams?limit=50&cursor=CURSOR1", list([design]));
    const user = userEvent.setup();
    render(<TeamsPage canManage={false} />);
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByText("Design")).toBeInTheDocument();
    expect(screen.getByText("Platform")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("says so when there are no teams", async () => {
    await renderLoaded(false, []);

    expect(screen.getByText("There are no teams yet.")).toBeInTheDocument();
  });
});

describe("TeamsPage: a reader", () => {
  it("lists the members by name with a Deactivated badge, and offers no management control", async () => {
    on(`GET /api/v1/teams/${PLATFORM_ID}`, () =>
      Response.json(team(PLATFORM_ID, "Platform", [MIA, MAX])),
    );
    const user = await renderLoaded(false);

    expect(screen.queryByRole("button", { name: "New team" })).not.toBeInTheDocument();
    const dialog = await openTeam(user, "Members of Platform", "Team Platform");

    const members = within(within(dialog).getByRole("list", { name: "Members" })).getAllByRole(
      "listitem",
    );
    expect(members.map((item) => item.textContent)).toEqual(["Mia", "MaxDeactivated"]);
    for (const name of [
      "Rename",
      "Delete team",
      "Remove Mia",
      "Add a person",
      "Team name",
    ] as const) {
      expect(within(dialog).queryByRole("button", { name })).not.toBeInTheDocument();
      expect(within(dialog).queryByRole("textbox", { name })).not.toBeInTheDocument();
    }
    expect(calls("POST")).toHaveLength(0);
  });

  it("says a team with no members has none", async () => {
    on(`GET /api/v1/teams/${DESIGN_ID}`, () => Response.json(team(DESIGN_ID, "Design", [])));
    const user = await renderLoaded(false);

    const dialog = await openTeam(user, "Members of Design", "Team Design");

    expect(within(dialog).getByText("No members yet.")).toBeInTheDocument();
  });
});

describe("TeamsPage: creating", () => {
  async function openCreate(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "New team" }));
    return screen.findByRole("dialog", { name: "New team" });
  }

  it("validates in the browser, posts the name and adds the row", async () => {
    const user = await renderLoaded(true, [platform]);
    const dialog = await openCreate(user);

    await user.click(within(dialog).getByRole("button", { name: "Create team" }));
    expect(calls("POST")).toHaveLength(0);
    expect(within(dialog).getByText(/required|at least/i)).toBeInTheDocument();

    on("POST /api/v1/teams", () => Response.json(team(DESIGN_ID, "Design", []), { status: 201 }));
    await user.type(within(dialog).getByLabelText("Name"), "  Design  ");
    await user.click(within(dialog).getByRole("button", { name: "Create team" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({ name: "Design" });
    expect(row("Design")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Created Design.");
  });

  it("shows a taken name next to the field and adds nothing", async () => {
    const user = await renderLoaded(true, [platform]);
    const dialog = await openCreate(user);
    on("POST /api/v1/teams", () => problem(409, { code: "team_name_taken" }));

    await user.type(within(dialog).getByLabelText("Name"), "platform");
    await user.click(within(dialog).getByRole("button", { name: "Create team" }));

    expect(
      await within(dialog).findByText("A team with this name already exists."),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(2);
  });
});

describe("TeamsPage: managing a team", () => {
  function loadTeam(members: Team["members"] = [MIA]) {
    on(`GET /api/v1/teams/${PLATFORM_ID}`, () =>
      Response.json(team(PLATFORM_ID, "Platform", members)),
    );
  }

  it("renames the team, updating the dialog and the row, and shows a taken name", async () => {
    loadTeam();
    const user = await renderLoaded(true);
    const dialog = await openTeam(user, "Manage Platform", "Team Platform");

    on(`PATCH /api/v1/teams/${PLATFORM_ID}`, () => problem(409, { code: "team_name_taken" }));
    await user.clear(within(dialog).getByRole("textbox", { name: "Team name" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Team name" }), "Design");
    await user.click(within(dialog).getByRole("button", { name: "Rename" }));
    expect(
      await within(dialog).findByText("A team with this name already exists."),
    ).toBeInTheDocument();

    on(`PATCH /api/v1/teams/${PLATFORM_ID}`, () =>
      Response.json(team(PLATFORM_ID, "Infra", [MIA])),
    );
    await user.clear(within(dialog).getByRole("textbox", { name: "Team name" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Team name" }), "Infra");
    await user.click(within(dialog).getByRole("button", { name: "Rename" }));

    expect(await screen.findByRole("dialog", { name: "Team Infra" })).toBeInTheDocument();
    expect(within(dialog).getByRole("status")).toHaveTextContent("Renamed the team to Infra.");
    const patches = calls("PATCH");
    expect(bodyOf(patches[1]?.[1])).toEqual({ name: "Infra" });
    expect(row("Infra")).toBeInTheDocument();
  });

  it("searches people as one types, hiding members and inactive people, and adds from the response", async () => {
    loadTeam([MIA]);
    const user = await renderLoaded(true);
    const dialog = await openTeam(user, "Manage Platform", "Team Platform");
    on("GET /api/v1/people?limit=20&q=Gra", () =>
      Response.json({ items: [GRACE, MIA, MAX], nextCursor: null }),
    );
    on(`POST /api/v1/teams/${PLATFORM_ID}/members`, () =>
      Response.json(team(PLATFORM_ID, "Platform", [MIA, GRACE])),
    );

    await user.type(within(dialog).getByRole("searchbox", { name: "Add a person" }), "Gra");

    expect(await within(dialog).findByRole("button", { name: "Add Grace" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Add Mia" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Add Max" })).not.toBeInTheDocument();
    // One search for the typed text, not one per keystroke.
    expect(
      fetchMock.mock.calls.filter(([url]) => urlOf(url).startsWith("/api/v1/people")),
    ).toHaveLength(1);

    await user.click(within(dialog).getByRole("button", { name: "Add Grace" }));

    await waitFor(() => {
      expect(
        within(within(dialog).getByRole("list", { name: "Members" }))
          .getAllByRole("listitem")
          .map((item) => item.textContent),
      ).toEqual(["Mia", "Grace"]);
    });
    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({ accountId: GRACE.id });
    expect(within(dialog).getByRole("status")).toHaveTextContent("Added Grace to Platform.");
    expect(within(row("Platform")).getByText("2")).toBeInTheDocument();
  });

  it("removes a member, and the count in the list drops", async () => {
    loadTeam([MIA, GRACE]);
    const user = await renderLoaded(true);
    const dialog = await openTeam(user, "Manage Platform", "Team Platform");
    on(
      `DELETE /api/v1/teams/${PLATFORM_ID}/members/${MIA.id}`,
      () => new Response(null, { status: 204 }),
    );

    await user.click(within(dialog).getByRole("button", { name: "Remove Mia" }));

    await waitFor(() => {
      expect(within(dialog).queryByText("Mia")).not.toBeInTheDocument();
    });
    expect(within(dialog).getByText("Grace")).toBeInTheDocument();
    expect(within(dialog).getByRole("status")).toHaveTextContent("Removed Mia from Platform.");
    expect(within(row("Platform")).getByText("1")).toBeInTheDocument();
  });
});

describe("TeamsPage: deleting", () => {
  async function openDelete() {
    on(`GET /api/v1/teams/${PLATFORM_ID}`, () =>
      Response.json(team(PLATFORM_ID, "Platform", [MIA])),
    );
    const user = await renderLoaded(true);
    const dialog = await openTeam(user, "Manage Platform", "Team Platform");
    await user.click(within(dialog).getByRole("button", { name: "Delete team" }));
    const confirmation = await screen.findByRole("alertdialog", { name: "Delete this team?" });
    return { user, confirmation };
  }

  it("asks first, and cancelling deletes nothing", async () => {
    const { user, confirmation } = await openDelete();
    expect(
      within(confirmation).getByText("This deletes the team and its memberships. The people stay."),
    ).toBeInTheDocument();

    await user.click(within(confirmation).getByRole("button", { name: "Cancel" }));

    expect(calls("DELETE")).toHaveLength(0);
    expect(row("Platform")).toBeInTheDocument();
  });

  it("deletes on confirmation and removes the row", async () => {
    const { user, confirmation } = await openDelete();
    on(`DELETE /api/v1/teams/${PLATFORM_ID}`, () => new Response(null, { status: 204 }));

    await user.click(within(confirmation).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("row", { name: /Platform/ })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Deleted Platform.");
  });

  it("explains a team that tasks are assigned to, and keeps it", async () => {
    const { user, confirmation } = await openDelete();
    on(`DELETE /api/v1/teams/${PLATFORM_ID}`, () => problem(409, { code: "team_in_use" }));

    await user.click(within(confirmation).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Tasks are assigned to this team. Reassign them first.",
    );
    expect(row("Platform")).toBeInTheDocument();
  });

  it("removes the row when another Manager already deleted the team", async () => {
    const { user, confirmation } = await openDelete();
    on(`DELETE /api/v1/teams/${PLATFORM_ID}`, () => problem(404, { code: "not_found" }));

    await user.click(within(confirmation).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.queryByRole("row", { name: /Platform/ })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("status")).toHaveTextContent("This team no longer exists.");
  });
});

describe("TeamsPage: accessibility", () => {
  it("has an announced status region, a heading, a headed table and named controls", async () => {
    await renderLoaded(true);

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Teams" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New team" })).toBeInTheDocument();
    for (const name of ["Platform", "Design"]) {
      expect(screen.getByRole("button", { name: `Manage ${name}` })).toBeInTheDocument();
    }
  });

  it("closes a dialog with Escape and returns focus to the button that opened it", async () => {
    on(`GET /api/v1/teams/${PLATFORM_ID}`, () =>
      Response.json(team(PLATFORM_ID, "Platform", [MIA])),
    );
    const user = await renderLoaded(false);
    const opener = screen.getByRole("button", { name: "Members of Platform" });
    await user.click(opener);
    await screen.findByRole("dialog", { name: "Team Platform" });

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(opener).toHaveFocus();
  });
});
