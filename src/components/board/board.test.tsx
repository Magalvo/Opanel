import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bodyOf, calls, hold, installFetch, on, problem } from "@/components/fake-api";
import { FakeSource } from "@/hooks/fake-event-source";
import type { Project } from "@/lib/schemas/projects";

import {
  COLUMNS,
  doing,
  done,
  full,
  json,
  opa,
  page,
  PROJECT,
  PROJECT_ID,
  task,
  TASKS,
  todo,
} from "./test-data";

const navigation = vi.hoisted(() => ({
  search: new URLSearchParams(),
  replace: (() => undefined) as (href: string, options?: unknown) => void,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace, refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/projects/OPA",
  useSearchParams: () => navigation.search,
}));

const { ProjectFrame } = await import("@/components/projects/project-frame");
const { Board } = await import("./board");

const ada = { id: "66666666-6666-4666-8666-666666666666", name: "Ada Lovelace", active: true };
const bob = { id: "77777777-7777-4777-8777-777777777777", name: "Bob Ross", active: false };
const web = { id: "88888888-8888-4888-8888-888888888888", name: "Frontend" };

const t1 = task(1, todo.id, { title: "Write the board", assignee: ada, assigneeTeam: web });
const t2 = task(2, todo.id, { title: "Fix the login", type: "bug", assignee: bob });
const t3 = task(3, doing.id, { title: "A story", type: "story" });

async function renderBoard({
  project = opa,
  canWriteTasks = true,
}: { project?: Project; canWriteTasks?: boolean } = {}) {
  on(PROJECT, json(project));
  const user = userEvent.setup();
  render(
    <ProjectFrame projectKey="OPA" canManageProjects={false}>
      <Board canWriteTasks={canWriteTasks} />
    </ProjectFrame>,
  );
  await screen.findByRole("region", { name: /^Done/ });
  return user;
}

function columnRegion(name: string) {
  return screen.getByRole("region", { name: new RegExp(`^${name}`) });
}

beforeEach(() => {
  installFetch();
  navigation.search = new URLSearchParams();
  navigation.replace = vi.fn();
  FakeSource.all = [];
  FakeSource.autoOpen = true;
  vi.stubGlobal("EventSource", FakeSource);
  on(COLUMNS, page([todo, doing, done]));
  on(TASKS, page([t1, t2, t3]));
});

describe("Board: showing", () => {
  it("says it is loading first", async () => {
    on(PROJECT, json(opa));
    render(
      <ProjectFrame projectKey="OPA" canManageProjects={false}>
        <Board canWriteTasks />
      </ProjectFrame>,
    );

    expect(await screen.findByText("Loading the board…")).toBeInTheDocument();
    await screen.findByRole("region", { name: /^Done/ });
  });

  it("shows the columns in board order with category and count", async () => {
    await renderBoard();

    const headings = within(screen.getByRole("region", { name: "Board" })).getAllByRole("heading", {
      level: 2,
    });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "To do",
      "In progress",
      "Done",
    ]);
    expect(columnRegion("To do")).toHaveTextContent("2 tasks");
    expect(columnRegion("In progress")).toHaveTextContent("1 task");
    expect(
      within(columnRegion("In progress")).getByText("In progress", { selector: "span" }),
    ).toBeInTheDocument();
    expect(within(columnRegion("Done")).getByText("No tasks")).toBeInTheDocument();
  });

  it("shows each card with key, title, type, assignee and team, in order", async () => {
    await renderBoard();

    const cards = within(columnRegion("To do")).getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent("OPA-1");
    expect(cards[0]).toHaveTextContent("Write the board");
    expect(cards[0]).toHaveTextContent("Task");
    expect(cards[0]).toHaveTextContent("Ada Lovelace");
    expect(cards[0]).toHaveTextContent("Frontend");
    expect(cards[1]).toHaveTextContent("Bug");
    expect(cards[1]).toHaveTextContent("Bob Ross (inactive)");
    expect(within(columnRegion("In progress")).getByRole("listitem")).toHaveTextContent("Story");
  });

  it("shows a bug's severity as a named badge and its count above 1 (WS-091)", async () => {
    on(
      TASKS,
      page([
        task(1, todo.id, { type: "bug", severity: "high", occurrences: 3 }),
        task(2, todo.id, { type: "bug", severity: "low", occurrences: 1 }),
        task(3, todo.id, { type: "bug" }),
      ]),
    );
    await renderBoard();

    const [first, second, third] = within(columnRegion("To do")).getAllByRole("listitem");
    for (const hidden of within(columnRegion("To do")).getAllByText("Severity:", {
      exact: false,
    })) {
      expect(hidden).toHaveClass("sr-only");
    }
    expect(first).toHaveTextContent("Severity: High");
    expect(first).toHaveTextContent("3 reports");
    expect(second).toHaveTextContent("Severity: Low");
    expect(second).not.toHaveTextContent("reports");
    expect(third).not.toHaveTextContent("Severity");
    expect(third).not.toHaveTextContent("reports");
  });

  it("explains a failure to load, and retries", async () => {
    on(TASKS, problem(500, "internal_error"));
    on(PROJECT, json(opa));
    const user = userEvent.setup();
    render(
      <ProjectFrame projectKey="OPA" canManageProjects={false}>
        <Board canWriteTasks />
      </ProjectFrame>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the board.");
    on(TASKS, page([t1]));
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Write the board")).toBeInTheDocument();
  });

  it("has a focusable board region that scrolls on its own", async () => {
    await renderBoard();

    expect(screen.getByRole("region", { name: "Board" })).toHaveAttribute("tabindex", "0");
  });
});

describe("Board: adding a task", () => {
  it("adds a task to a column with title and type, and announces it", async () => {
    on(
      "POST /api/v1/projects/OPA/tasks",
      json(full(task(4, doing.id, { title: "New one", type: "bug" })), 201),
    );
    const user = await renderBoard();

    await user.click(within(columnRegion("In progress")).getByRole("button", { name: "Add task" }));
    const dialog = screen.getByRole("dialog", { name: "Add a task to In progress" });
    expect(within(dialog).getByLabelText("Type")).toHaveValue("task");
    await user.type(within(dialog).getByLabelText("Title"), "  New one ");
    await user.selectOptions(within(dialog).getByLabelText("Type"), "Bug");
    await user.click(within(dialog).getByRole("button", { name: "Add task" }));

    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({
      title: "New one",
      type: "bug",
      columnId: doing.id,
    });
    const cards = within(columnRegion("In progress")).getAllByRole("listitem");
    expect(cards[1]).toHaveTextContent("OPA-4");
    expect(screen.getByRole("status", { name: "Board messages" })).toHaveTextContent(
      "OPA-4 was added to In progress.",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("requires a title", async () => {
    const user = await renderBoard();

    await user.click(within(columnRegion("To do")).getByRole("button", { name: "Add task" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Add task" }));

    expect(within(dialog).getByLabelText("Title")).toHaveAccessibleDescription("Enter a title.");
    expect(calls("POST")).toEqual([]);
  });

  it("shows the API's field errors at the field", async () => {
    on(
      "POST /api/v1/projects/OPA/tasks",
      problem(400, "invalid_request", [{ path: "title", message: "Too long." }]),
    );
    const user = await renderBoard();

    await user.click(within(columnRegion("To do")).getByRole("button", { name: "Add task" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Title"), "Something");
    await user.click(within(dialog).getByRole("button", { name: "Add task" }));

    expect(within(dialog).getByLabelText("Title")).toHaveAccessibleDescription("Too long.");
  });

  it("turns the board read-only when the project turns out to be archived", async () => {
    on("POST /api/v1/projects/OPA/tasks", problem(409, "project_archived"));
    const user = await renderBoard();
    on(PROJECT, json({ ...opa, archivedAt: "2026-11-16T10:00:00.000Z", version: 4 }));

    await user.click(within(columnRegion("To do")).getByRole("button", { name: "Add task" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Title"), "Something");
    await user.click(within(dialog).getByRole("button", { name: "Add task" }));

    expect(
      await screen.findByText("This project is archived. The board is read-only."),
    ).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Board messages" })).toHaveTextContent(
      "The project is archived.",
    );
    expect(screen.queryByRole("button", { name: "Add task" })).not.toBeInTheDocument();
  });

  it("returns focus to the column's button when the dialog is closed with Escape", async () => {
    const user = await renderBoard();
    const button = within(columnRegion("Done")).getByRole("button", { name: "Add task" });

    await user.click(button);
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(button).toHaveFocus();
    });
  });
});

describe("Board: who may change it", () => {
  it("gives each card a drag handle for the keyboard, with instructions (WS-038)", async () => {
    await renderBoard();

    const handle = within(columnRegion("To do")).getByRole("button", {
      name: "Move OPA-1 Write the board",
    });
    expect(handle).toHaveAttribute("aria-roledescription", "sortable");
    expect(handle).toHaveAttribute("tabindex", "0");
    // `@dnd-kit` mounts the instructions after its first render.
    await waitFor(() => {
      expect(handle).toHaveAccessibleDescription(/Space or Enter/);
    });
  });

  it("links each card's title to its task, for writers and readers", async () => {
    await renderBoard();
    expect(
      within(columnRegion("To do")).getByRole("link", { name: "Write the board" }),
    ).toHaveAttribute("href", "/projects/OPA/tasks/OPA-1");
  });

  it("links the title of a read-only card too", async () => {
    await renderBoard({ canWriteTasks: false });
    expect(
      within(columnRegion("To do")).getByRole("link", { name: "Write the board" }),
    ).toHaveAttribute("href", "/projects/OPA/tasks/OPA-1");
  });

  it("is read-only for someone without tasks:write: no Add task, no draggable cards", async () => {
    await renderBoard({ canWriteTasks: false });

    expect(screen.queryByRole("button", { name: "Add task" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Move OPA-1/ })).not.toBeInTheDocument();
    expect(screen.getByText("Write the board")).toBeInTheDocument();
    expect(
      screen.queryByText("This project is archived. The board is read-only."),
    ).not.toBeInTheDocument();
  });

  it("is read-only for everyone on an archived project, and says why", async () => {
    await renderBoard({ project: { ...opa, archivedAt: "2026-11-16T10:00:00.000Z" } });

    expect(
      screen.getByText("This project is archived. The board is read-only."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add task" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Move OPA-1/ })).not.toBeInTheDocument();
  });
});

describe("Board: live (WS-048 section 6)", () => {
  function projectChanged(version: number) {
    act(() => {
      FakeSource.latest().send("project.changed", {
        id: crypto.randomUUID(),
        type: "project.changed",
        projectId: opa.id,
        entity: "project",
        entityId: opa.id,
        version,
        actorAccountId: "55555555-5555-4555-8555-555555555555",
        at: "2026-11-18T10:00:00.000Z",
      });
    });
  }

  function projectReads(): number {
    return calls("GET").filter(([url]) => url === "/api/v1/projects/OPA").length;
  }

  it("shows a bug's new count when it is reported again (WS-091)", async () => {
    const bug = task(2, todo.id, { type: "bug", severity: "high", occurrences: 2 });
    on(TASKS, page([t1, bug]));
    await renderBoard();
    expect(within(columnRegion("To do")).getAllByRole("listitem")[1]).toHaveTextContent(
      "2 reports",
    );
    on(`GET /api/v1/tasks/${bug.id}`, json(full({ ...bug, occurrences: 3, version: 2 })));

    act(() => {
      FakeSource.latest().send("task.updated", {
        id: crypto.randomUUID(),
        type: "task.updated",
        projectId: opa.id,
        entity: "task",
        entityId: bug.id,
        version: 2,
        actorAccountId: "55555555-5555-4555-8555-555555555555",
        at: "2026-11-20T10:00:00.000Z",
      });
    });

    await waitFor(() => {
      expect(within(columnRegion("To do")).getAllByRole("listitem")[1]).toHaveTextContent(
        "3 reports",
      );
    });
  });

  it("turns read-only and says so when someone archives the project", async () => {
    await renderBoard();
    on(PROJECT, json({ ...opa, archivedAt: "2026-11-18T10:00:00.000Z", version: 4 }));

    projectChanged(4);

    expect(await screen.findByRole("status", { name: "Board messages" })).toHaveTextContent(
      "This project was archived. The board is read-only.",
    );
    expect(screen.getByText("This project is archived. The board is read-only.")).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Add task/ })).not.toBeInTheDocument();
  });

  it("turns writable again and says so when someone unarchives it", async () => {
    await renderBoard({ project: { ...opa, archivedAt: "2026-11-16T10:00:00.000Z", version: 4 } });
    on(PROJECT, json({ ...opa, version: 5 }));

    projectChanged(5);

    await waitFor(() => {
      expect(screen.getByRole("status", { name: "Board messages" })).toHaveTextContent(
        "This project was unarchived.",
      );
    });
    expect(
      screen.queryByText("This project is archived. The board is read-only."),
    ).not.toBeInTheDocument();
  });

  it("does not read the project again for a version it already holds", async () => {
    await renderBoard();
    const before = projectReads();

    projectChanged(opa.version);

    expect(projectReads()).toBe(before);
  });

  it("says when live updates are paused", async () => {
    await renderBoard();
    expect(screen.queryByText("Live updates are paused. Reconnecting…")).not.toBeInTheDocument();

    act(() => {
      FakeSource.latest().refuse();
    });

    expect(screen.getByRole("status", { name: "Live updates" })).toHaveTextContent(
      "Live updates are paused. Reconnecting…",
    );
  });
});

// Overdue on the board (WS-110 test 6): only outside a done column, and live.

describe("Board: overdue (WS-110)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 23, 12, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks a past-due card outside a done column, not in one, and follows a live move", async () => {
    const late = task(4, todo.id, { title: "Late", dueDate: "2026-11-20" });
    const finished = task(5, done.id, { title: "Finished", dueDate: "2026-11-20" });
    on(TASKS, page([late, finished]));
    await renderBoard();

    expect(within(columnRegion("To do")).getByRole("listitem")).toHaveTextContent(
      "Overdue, due Nov 20, 2026",
    );
    expect(within(columnRegion("Done")).getByRole("listitem")).toHaveTextContent(
      "Due Nov 20, 2026",
    );
    expect(within(columnRegion("Done")).getByRole("listitem")).not.toHaveTextContent("Overdue");

    const moved = { ...late, columnId: done.id, version: 2 };
    on(`GET /api/v1/tasks/${late.id}`, json(full(moved)));
    on(`${TASKS}&columnId=${done.id}`, page([finished, moved]));
    act(() => {
      FakeSource.latest().send("task.moved", {
        id: crypto.randomUUID(),
        type: "task.moved",
        projectId: PROJECT_ID,
        entity: "task",
        entityId: late.id,
        version: 2,
        actorAccountId: "55555555-5555-4555-8555-555555555555",
        at: "2026-11-23T10:00:00.000Z",
      });
    });

    await waitFor(() => {
      expect(within(columnRegion("Done")).getAllByRole("listitem")).toHaveLength(2);
    });
    expect(columnRegion("Done")).not.toHaveTextContent("Overdue");
  });
});

describe("Board: moving without dragging (WS-111 section 1)", () => {
  const MOVE_T1 = `POST /api/v1/tasks/${t1.id}/move`;

  function boardMessage() {
    return screen.getByRole("status", { name: "Board messages" });
  }

  async function openMenu(user: ReturnType<typeof userEvent.setup>, key: string) {
    await user.click(screen.getByRole("button", { name: `Actions for ${key}` }));
    return screen.findByRole("menu");
  }

  it("gives a writable card a menu with the four moves and every other column (test 4)", async () => {
    const user = await renderBoard();

    const menu = await openMenu(user, "OPA-1");

    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Move to top", "Move up", "Move down", "Move to bottom", "In progress", "Done"]);
    expect(within(menu).getByText("Move to")).toBeInTheDocument();
    // The first card of its column: it cannot go up.
    expect(within(menu).getByRole("menuitem", { name: "Move to top" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(within(menu).getByRole("menuitem", { name: "Move up" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(within(menu).getByRole("menuitem", { name: "Move down" })).not.toHaveAttribute(
      "aria-disabled",
    );
  });

  it("gives no menu to a Viewer, nor on an archived project (test 5)", async () => {
    await renderBoard({ canWriteTasks: false });
    expect(screen.queryByRole("button", { name: /^Actions for/ })).not.toBeInTheDocument();
  });

  it("gives no menu on an archived project (test 5)", async () => {
    await renderBoard({ project: { ...opa, archivedAt: "2026-11-16T10:00:00.000Z" } });
    expect(screen.queryByRole("button", { name: /^Actions for/ })).not.toBeInTheDocument();
  });

  it("moves a card down at once, saves it, and announces its place (test 6)", async () => {
    on(MOVE_T1, json(full({ ...t1, version: 2 })));
    const user = await renderBoard();

    const menu = await openMenu(user, "OPA-1");
    await user.click(within(menu).getByRole("menuitem", { name: "Move down" }));

    expect(
      within(columnRegion("To do"))
        .getAllByRole("button", { name: /^Actions for/ })
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Actions for OPA-2", "Actions for OPA-1"]);
    await waitFor(() => {
      expect(boardMessage()).toHaveTextContent("OPA-1 was moved to To do, position 2 of 2.");
    });
    const [[url, init]] = calls("POST") as [[string, RequestInit]];
    expect(url).toBe(`/api/v1/tasks/${t1.id}/move`);
    expect(bodyOf(init)).toEqual({ columnId: todo.id, afterTaskId: t2.id, version: 1 });
  });

  it("moves a card to the end of another column and keeps the focus on its menu (test 7)", async () => {
    on(MOVE_T1, json(full({ ...t1, columnId: doing.id, version: 2 })));
    const user = await renderBoard();

    const menu = await openMenu(user, "OPA-1");
    await user.click(within(menu).getByRole("menuitem", { name: "In progress" }));

    const moved = within(columnRegion("In progress")).getByRole("button", {
      name: "Actions for OPA-1",
    });
    await waitFor(() => {
      expect(moved).toHaveFocus();
    });
    await waitFor(() => {
      expect(boardMessage()).toHaveTextContent("OPA-1 was moved to In progress, position 2 of 2.");
    });
    const [[, init]] = calls("POST") as [[string, RequestInit]];
    expect(bodyOf(init)).toEqual({ columnId: doing.id, afterTaskId: t3.id, version: 1 });
  });

  it("opens the menu with Enter and does not pick the card up (test 8)", async () => {
    const user = await renderBoard();

    screen.getByRole("button", { name: "Actions for OPA-1" }).focus();
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(screen.queryByText(/Picked up/)).not.toBeInTheDocument();
  });

  it("reloads the board and explains a conflict, as a drag does (test 9)", async () => {
    on(MOVE_T1, problem(409, "version_conflict"));
    const user = await renderBoard();

    const menu = await openMenu(user, "OPA-1");
    await user.click(within(menu).getByRole("menuitem", { name: "Move to bottom" }));

    await waitFor(() => {
      expect(boardMessage()).toHaveTextContent(
        "Someone else changed OPA-1. The board was refreshed.",
      );
    });
    // Loaded once on opening, once after the failure.
    expect(
      calls("GET").filter(([url]) => url.startsWith("/api/v1/projects/OPA/tasks")),
    ).toHaveLength(2);
  });

  it("disables the menus while a move is saved (test 10)", async () => {
    const release = hold(MOVE_T1);
    const user = await renderBoard();

    const menu = await openMenu(user, "OPA-1");
    await user.click(within(menu).getByRole("menuitem", { name: "Move down" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Actions for OPA-2" })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    });
    // It keeps the focus, but opens nothing while the move is saved.
    await user.click(screen.getByRole("button", { name: "Actions for OPA-2" }));
    screen.getByRole("button", { name: "Actions for OPA-2" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await act(() => release(json(full({ ...t1, version: 2 }))));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Actions for OPA-2" })).toHaveAttribute(
        "aria-disabled",
        "false",
      );
    });
  });
});

describe("Board: filtered (WS-120 test 6)", () => {
  const BUGS = "GET /api/v1/projects/OPA/tasks?limit=100&type=bug";

  it("shows only matching cards, every column, and says when one has none", async () => {
    navigation.search = new URLSearchParams("type=bug");
    on(BUGS, page([t2]));
    await renderBoard();

    await waitFor(() => {
      expect(within(columnRegion("To do")).queryByText("Write the board")).not.toBeInTheDocument();
    });
    expect(within(columnRegion("To do")).getByText("Fix the login")).toBeVisible();
    expect(within(columnRegion("In progress")).getByText("No matching tasks")).toBeVisible();
    expect(screen.getByRole("status", { name: "Filter results" })).toHaveTextContent(
      "1 of 3 tasks match.",
    );
  });

  it("writes a change of filter to the URL", async () => {
    const user = await renderBoard();

    await user.click(await screen.findByRole("button", { name: "Type" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Bug" }));

    expect(navigation.replace).toHaveBeenLastCalledWith("/projects/OPA?type=bug", {
      scroll: false,
    });
  });

  it("moves a card among the cards shown, with a shown card as its anchor", async () => {
    const t4 = task(4, todo.id, { title: "Another bug", type: "bug" });
    on(TASKS, page([t1, t2, t4, t3]));
    navigation.search = new URLSearchParams("type=bug");
    on(BUGS, page([t2, t4]));
    on(`POST /api/v1/tasks/${t4.id}/move`, json(full({ ...t4, version: 2 })));
    const user = await renderBoard();
    await waitFor(() => {
      expect(within(columnRegion("To do")).queryByText("Write the board")).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: `Actions for ${t4.key}` }));
    await user.click(screen.getByRole("menuitem", { name: "Move up" }));

    // t4 goes above t2, the card shown above it, and stays below the hidden t1.
    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({
      columnId: todo.id,
      afterTaskId: t1.id,
      version: t4.version,
    });
  });
});
