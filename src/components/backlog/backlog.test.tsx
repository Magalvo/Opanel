import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  todo,
} from "@/components/board/test-data";
import { bodyOf, calls, installFetch, on, problem } from "@/components/fake-api";
import { FakeSource } from "@/hooks/fake-event-source";
import type { Project } from "@/lib/schemas/projects";
import type { TaskSummary } from "@/lib/schemas/tasks";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/projects/OPA/backlog",
}));

const { ProjectFrame } = await import("@/components/projects/project-frame");
const { Backlog } = await import("./backlog");

const BACKLOG = "GET /api/v1/projects/OPA/backlog?limit=100";

const ada = { id: "66666666-6666-4666-8666-666666666666", name: "Ada Lovelace", active: true };
const web = { id: "88888888-8888-4888-8888-888888888888", name: "Frontend" };

function inBacklog(number: number, extra: Partial<TaskSummary> = {}): TaskSummary {
  return task(number, "", { columnId: null, ...extra });
}

const t1 = inBacklog(1, { title: "Plan the release", assignee: ada, assigneeTeam: web });
const t2 = inBacklog(2, { title: "Fix the login", type: "bug", severity: "high" });
const t3 = inBacklog(3, { title: "A story", type: "story" });

async function renderBacklog({
  project = opa,
  canWriteTasks = true,
}: { project?: Project; canWriteTasks?: boolean } = {}) {
  on(PROJECT, json(project));
  const user = userEvent.setup();
  render(
    <ProjectFrame projectKey="OPA" canManageProjects={false}>
      <Backlog canWriteTasks={canWriteTasks} />
    </ProjectFrame>,
  );
  await screen.findByRole("region", { name: "Backlog" });
  return user;
}

function rows() {
  return within(screen.getByRole("region", { name: "Backlog" })).queryAllByRole("listitem");
}

function messages() {
  return screen.getByRole("status", { name: "Backlog messages" });
}

beforeEach(() => {
  installFetch();
  FakeSource.all = [];
  FakeSource.autoOpen = true;
  vi.stubGlobal("EventSource", FakeSource);
  on(COLUMNS, page([todo, doing, done]));
  on(BACKLOG, page([t1, t2, t3]));
});

describe("Backlog: showing (WS-109 section 2)", () => {
  it("says it is loading first", async () => {
    on(PROJECT, json(opa));
    render(
      <ProjectFrame projectKey="OPA" canManageProjects={false}>
        <Backlog canWriteTasks />
      </ProjectFrame>,
    );

    expect(await screen.findByText("Loading the backlog…")).toBeInTheDocument();
    await screen.findByRole("region", { name: "Backlog" });
  });

  it("shows the tasks in backlog order, as cards show them, with the count", async () => {
    await renderBacklog();

    expect(rows().map((row) => row.textContent)).toEqual([
      expect.stringContaining("OPA-1"),
      expect.stringContaining("OPA-2"),
      expect.stringContaining("OPA-3"),
    ]);
    expect(rows()[0]).toHaveTextContent("Plan the release");
    expect(rows()[0]).toHaveTextContent("Ada Lovelace");
    expect(rows()[0]).toHaveTextContent("Frontend");
    expect(rows()[1]).toHaveTextContent("Severity: High");
    expect(rows()[2]).toHaveTextContent("Story");
    expect(screen.getByText("3 tasks")).toBeInTheDocument();
  });

  it("links each title to its task, for writers and readers", async () => {
    await renderBacklog({ canWriteTasks: false });

    expect(screen.getByRole("link", { name: "Plan the release" })).toHaveAttribute(
      "href",
      "/projects/OPA/tasks/OPA-1",
    );
  });

  it("says when the backlog is empty", async () => {
    on(BACKLOG, page([]));
    await renderBacklog();

    expect(screen.getByText("The backlog is empty.")).toBeInTheDocument();
    expect(screen.getByText("0 tasks")).toBeInTheDocument();
  });

  it("explains a failure to load, and retries", async () => {
    on(BACKLOG, problem(500, "internal_error"));
    on(PROJECT, json(opa));
    const user = userEvent.setup();
    render(
      <ProjectFrame projectKey="OPA" canManageProjects={false}>
        <Backlog canWriteTasks />
      </ProjectFrame>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the backlog.");
    on(BACKLOG, page([t1]));
    await user.click(screen.getByRole("button", { name: "Retry" }));

    await screen.findByRole("region", { name: "Backlog" });
    expect(rows()).toHaveLength(1);
  });

  it("says when live updates are paused", async () => {
    await renderBacklog();

    act(() => {
      FakeSource.latest().refuse();
    });

    expect(screen.getByRole("status", { name: "Live updates" })).toHaveTextContent(
      "Live updates are paused. Reconnecting…",
    );
  });
});

describe("Backlog: for someone who may change it (WS-109 sections 3 and 4)", () => {
  it("gives each row a drag handle for the keyboard, with instructions", async () => {
    await renderBacklog();

    const handle = screen.getByRole("button", { name: "Move OPA-1 Plan the release" });
    expect(handle).toHaveAttribute("aria-roledescription", "sortable");
    expect(handle).toHaveAttribute("tabindex", "0");
    await waitFor(() => {
      expect(handle).toHaveAccessibleDescription(/up and down arrow keys/);
    });
  });

  it("adds a task to the end of the backlog, and announces it", async () => {
    on(
      "POST /api/v1/projects/OPA/tasks",
      json(full(inBacklog(4, { title: "New one", type: "bug" })), 201),
    );
    const user = await renderBacklog();

    await user.click(screen.getByRole("button", { name: "Add task" }));
    const dialog = screen.getByRole("dialog", { name: "Add a task to the backlog" });
    expect(dialog).toHaveTextContent("It goes to the end of the backlog.");
    await user.type(within(dialog).getByLabelText("Title"), "New one");
    await user.selectOptions(within(dialog).getByLabelText("Type"), "Bug");
    await user.click(within(dialog).getByRole("button", { name: "Add task" }));

    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({
      title: "New one",
      type: "bug",
      columnId: null,
    });
    expect(rows()[3]).toHaveTextContent("OPA-4");
    expect(messages()).toHaveTextContent("OPA-4 was added to the backlog.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("moves a task to the end of the first column, and announces it", async () => {
    on(`POST /api/v1/tasks/${t1.id}/move`, json(full({ ...t1, columnId: todo.id, version: 2 })));
    const user = await renderBacklog();

    await user.click(screen.getByRole("button", { name: "Move to board OPA-1" }));

    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({ columnId: todo.id, version: 1 });
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    expect(messages()).toHaveTextContent("OPA-1 was moved to To do.");
  });

  it("gives the focus to the next row, the previous one, or Add task, after a move to the board", async () => {
    for (const item of [t1, t2, t3]) {
      on(
        `POST /api/v1/tasks/${item.id}/move`,
        json(full({ ...item, columnId: todo.id, version: 2 })),
      );
    }
    const user = await renderBacklog();

    await user.click(screen.getByRole("button", { name: "Move to board OPA-2" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Move to board OPA-3" })).toHaveFocus();
    });

    await user.click(screen.getByRole("button", { name: "Move to board OPA-3" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Move to board OPA-1" })).toHaveFocus();
    });

    await user.click(screen.getByRole("button", { name: "Move to board OPA-1" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add task" })).toHaveFocus();
    });
    expect(screen.getByText("The backlog is empty.")).toBeInTheDocument();
  });

  it("keeps the row and explains a failed move to the board", async () => {
    on(`POST /api/v1/tasks/${t1.id}/move`, problem(409, "version_conflict"));
    const user = await renderBacklog();

    await user.click(screen.getByRole("button", { name: "Move to board OPA-1" }));

    await waitFor(() => {
      expect(messages()).toHaveTextContent(
        "Someone else changed OPA-1. The backlog was refreshed.",
      );
    });
    expect(rows()).toHaveLength(3);
  });
});

describe("Backlog: read-only (WS-109 section 2)", () => {
  it("is read-only for someone without tasks:write", async () => {
    await renderBacklog({ canWriteTasks: false });

    expect(screen.queryByRole("button", { name: "Add task" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Move OPA-1/ })).not.toBeInTheDocument();
    expect(rows()).toHaveLength(3);
    expect(
      screen.queryByText("This project is archived. The backlog is read-only."),
    ).not.toBeInTheDocument();
  });

  it("is read-only for everyone on an archived project, and says why", async () => {
    await renderBacklog({ project: { ...opa, archivedAt: "2026-11-16T10:00:00.000Z" } });

    expect(
      screen.getByText("This project is archived. The backlog is read-only."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add task" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Move OPA-1/ })).not.toBeInTheDocument();
  });

  it("turns read-only and says so when someone archives the project", async () => {
    await renderBacklog();
    on(PROJECT, json({ ...opa, archivedAt: "2026-11-18T10:00:00.000Z", version: 4 }));

    act(() => {
      FakeSource.latest().send("project.changed", {
        id: crypto.randomUUID(),
        type: "project.changed",
        projectId: opa.id,
        entity: "project",
        entityId: opa.id,
        version: 4,
        actorAccountId: "55555555-5555-4555-8555-555555555555",
        at: "2026-11-23T10:00:00.000Z",
      });
    });

    await waitFor(() => {
      expect(messages()).toHaveTextContent("This project was archived. The backlog is read-only.");
    });
    expect(screen.queryByRole("button", { name: "Add task" })).not.toBeInTheDocument();
  });
});

// Priority and due date on backlog rows (WS-110 test 7): a backlog task is never in a
// done column, so a past date is overdue.

describe("Backlog: priority and due date (WS-110)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 23, 12, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a row's priority icon and Overdue for a past date", async () => {
    on(BACKLOG, page([inBacklog(1, { priority: "urgent", dueDate: "2026-11-01" })]));
    await renderBacklog();

    expect(screen.getByRole("img", { name: "Priority: Urgent" })).toBeInTheDocument();
    expect(rows()[0]).toHaveTextContent("Overdue, due Nov 1, 2026");
  });
});
