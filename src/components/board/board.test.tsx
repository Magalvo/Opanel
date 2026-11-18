import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bodyOf, calls, installFetch, on, problem } from "@/components/fake-api";
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
  task,
  TASKS,
  todo,
} from "./test-data";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/projects/OPA",
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
