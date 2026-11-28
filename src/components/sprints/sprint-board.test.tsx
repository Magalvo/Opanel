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
  TASKS,
  todo,
} from "@/components/board/test-data";
import { bodyOf, calls, installFetch, on, problem } from "@/components/fake-api";
import { FakeSource } from "@/hooks/fake-event-source";
import type { Project } from "@/lib/schemas/projects";
import type { Sprint } from "@/lib/schemas/sprints";
import type { TaskSummary } from "@/lib/schemas/tasks";

import { ALL_SPRINTS, OPEN_SPRINTS, refOf, sprint, sprintChanged } from "./test-data";

const navigation = vi.hoisted(() => ({ search: new URLSearchParams() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/projects/OPA",
  useSearchParams: () => navigation.search,
}));

const { ProjectFrame } = await import("@/components/projects/project-frame");
const { Board } = await import("@/components/board/board");

// The board of a project with sprints (WS-144 sections 7 to 9): tests 8, 9 and 10, and the
// board's parts of tests 11, 12 and 13.

const sprints: Project = { ...opa, sprintsEnabled: true };

const s4 = sprint(4, "active", "2026-12-01", "2026-12-14", {
  goal: "Ship the release",
  version: 3,
  progress: { doneTasks: 3, totalTasks: 8, donePoints: 12, totalPoints: 30, unestimated: 2 },
});
const s5 = sprint(5, "planned", "2026-12-15", "2026-12-28");
const s6 = sprint(6, "planned", "2026-12-29", "2027-01-11");

function inSprint(number: number, columnId: string, extra: Partial<TaskSummary> = {}) {
  return task(number, columnId, { sprint: refOf(s4), ...extra });
}

function subOf(parent: TaskSummary) {
  return { parent: { id: parent.id, key: parent.key, title: parent.title } };
}

// Families (WS-142 section 5): t2 is done with its sub-tasks t3, t4 and t7, two of them
// unfinished; t5 is not done, so its done sub-task t6 leaves with it; t1 is alone.
const t1 = inSprint(1, todo.id, { title: "Write the board" });
const t2 = inSprint(2, done.id, { title: "Ship the login" });
const t3 = inSprint(3, doing.id, subOf(t2));
const t4 = inSprint(4, done.id, subOf(t2));
const t5 = inSprint(5, doing.id, { title: "A story" });
const t6 = inSprint(6, done.id, subOf(t5));
const t7 = inSprint(7, todo.id, subOf(t2));

async function renderBoard({
  project = sprints,
  canWriteTasks = true,
  canManageSprints = true,
  open = [s4, s5, s6],
}: {
  project?: Project;
  canWriteTasks?: boolean;
  canManageSprints?: boolean;
  open?: Sprint[];
} = {}) {
  on(PROJECT, json(project));
  on(OPEN_SPRINTS, page(open));
  const user = userEvent.setup();
  render(
    <ProjectFrame projectKey="OPA" canManageProjects={false}>
      <Board canWriteTasks={canWriteTasks} canManageSprints={canManageSprints} />
    </ProjectFrame>,
  );
  await screen.findByRole("status", { name: "Board messages" });
  return user;
}

async function renderWithHeader(options: Parameters<typeof renderBoard>[0] = {}) {
  const user = await renderBoard(options);
  await screen.findByRole("region", { name: /^Done/ });
  await screen.findByRole("region", { name: /^Active sprint/ });
  return user;
}

function header() {
  return screen.getByRole("region", { name: "Active sprint: Sprint 4" });
}

function messages() {
  return screen.getByRole("status", { name: "Board messages" });
}

function column(name: string) {
  return screen.getByRole("region", { name: new RegExp(`^${name}`) });
}

beforeEach(() => {
  installFetch();
  navigation.search = new URLSearchParams();
  FakeSource.all = [];
  FakeSource.autoOpen = true;
  vi.stubGlobal("EventSource", FakeSource);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 11, 5, 12, 0));
  on(COLUMNS, page([todo, doing, done]));
  on(TASKS, page([t1, t7, t3, t5, t2, t4, t6]));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Board with sprints: the header (WS-144 section 7, test 8)", () => {
  it("shows the active sprint's name, dates, days left, goal, progress and points above the filter", async () => {
    await renderWithHeader();

    expect(header()).toHaveTextContent("Dec 1, 2026 – Dec 14, 2026");
    expect(header()).toHaveTextContent("9 days left");
    expect(header()).toHaveTextContent("Ship the release");
    expect(
      within(header()).getByRole("progressbar", { name: "3 of 8 tasks done" }),
    ).toHaveAttribute("aria-valuenow", "3");
    expect(header()).toHaveTextContent("12 / 30 points");
    expect(header()).toHaveTextContent("2 not estimated");
    // Above the filter bar.
    const bar = screen.getByRole("search", { name: "Filter tasks" });
    expect(header().compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(bar).queryByRole("button", { name: "Sprint" })).not.toBeInTheDocument();
  });

  it("says how long ago an overrun sprint ended", async () => {
    vi.setSystemTime(new Date(2026, 11, 16, 12, 0));
    await renderWithHeader();

    expect(header()).toHaveTextContent("Ended 2 days ago");
  });

  it("offers Complete sprint to a Manager only", async () => {
    await renderWithHeader();
    expect(within(header()).getByRole("button", { name: "Complete sprint" })).toBeVisible();
  });

  it("adds a task to the active sprint, and says so", async () => {
    const added = inSprint(40, todo.id, { title: "New one" });
    on("POST /api/v1/projects/OPA/tasks", json(full(added), 201));
    const user = await renderWithHeader();

    await user.click(within(column("To do")).getByRole("button", { name: "Add task" }));
    const dialog = screen.getByRole("dialog", { name: "Add a task to To do" });
    await user.type(within(dialog).getByLabelText("Title"), "New one");
    await user.click(within(dialog).getByRole("button", { name: "Add task" }));

    await waitFor(() => {
      expect(messages()).toHaveTextContent("OPA-40 was added to Sprint 4, To do.");
    });
  });
});

describe("Board with sprints: no active sprint (WS-144 section 7, test 9)", () => {
  it("shows an empty state linking to the backlog, and no columns", async () => {
    on(TASKS, page([]));
    await renderBoard({ open: [s5, s6] });

    expect(await screen.findByText("No sprint is active.")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Plan and start a sprint in the backlog" }),
    ).toHaveAttribute("href", "/projects/OPA/backlog");
    expect(screen.queryByRole("region", { name: /^To do/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add task" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /^Active sprint/ })).not.toBeInTheDocument();
  });
});

describe("Board with sprints: completing (WS-144 section 8, test 10)", () => {
  async function openComplete(options: Parameters<typeof renderBoard>[0] = {}) {
    const user = await renderWithHeader(options);
    await user.click(within(header()).getByRole("button", { name: "Complete sprint" }));
    return { user, dialog: screen.getByRole("dialog", { name: "Complete Sprint 4?" }) };
  }

  function target(dialog: HTMLElement): HTMLSelectElement {
    return within(dialog).getByLabelText("Move the unfinished work to");
  }

  it("counts the done tasks, the unfinished ones and the sub-tasks kept with a done parent", async () => {
    const { dialog } = await openComplete();

    expect(dialog).toHaveTextContent("2 done tasks stay as the sprint's record.");
    expect(dialog).toHaveTextContent("3 unfinished tasks leave the board.");
    expect(dialog).toHaveTextContent(
      "2 unfinished sub-tasks stay with their done parent, as part of the record.",
    );
  });

  it("offers the planned sprints, the backlog and a new sprint, the next planned one first", async () => {
    const { dialog } = await openComplete();

    expect([...target(dialog).options].map((option) => option.text)).toEqual([
      "Sprint 5",
      "Sprint 6",
      "Backlog (unscheduled)",
      "New sprint…",
    ]);
    expect(target(dialog).selectedOptions[0]?.text).toBe("Sprint 5");
  });

  it("chooses the backlog by default when no sprint is planned", async () => {
    const { dialog } = await openComplete({ open: [s4] });

    expect(target(dialog).selectedOptions[0]?.text).toBe("Backlog (unscheduled)");
  });

  it("completes the sprint, says what happened, and follows at once", async () => {
    on(`POST /api/v1/sprints/${s4.id}/complete`, () =>
      Response.json({
        ...s4,
        state: "completed",
        completedAt: "2026-12-05T12:00:00.000Z",
        version: 4,
        progress: { doneTasks: 3, totalTasks: 7, donePoints: 0, totalPoints: 0, unestimated: 7 },
        unfinishedSubtasksKept: 2,
      }),
    );
    const { user, dialog } = await openComplete();
    on(OPEN_SPRINTS, page([s5, s6]));
    on(TASKS, page([]));

    await user.click(within(dialog).getByRole("button", { name: "Complete sprint" }));

    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({ moveUnfinishedTo: s5.id, version: 3 });
    await waitFor(() => {
      expect(messages()).toHaveTextContent(
        "Sprint 4 completed: 2 done, 3 moved to Sprint 5. 2 unfinished sub-tasks stay with their done parent.",
      );
    });
    expect(await screen.findByText("No sprint is active.")).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("sends the unfinished work to the backlog with null", async () => {
    on(`POST /api/v1/sprints/${s4.id}/complete`, () =>
      Response.json({
        ...s4,
        state: "completed",
        version: 4,
        unfinishedSubtasksKept: 0,
      }),
    );
    const { user, dialog } = await openComplete();

    await user.selectOptions(target(dialog), "Backlog (unscheduled)");
    await user.click(within(dialog).getByRole("button", { name: "Complete sprint" }));

    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({ moveUnfinishedTo: null, version: 3 });
    await waitFor(() => {
      expect(messages()).toHaveTextContent("Sprint 4 completed: 2 done, 3 moved to the backlog.");
    });
  });

  it("creates a new sprint first with New sprint…, then selects it", async () => {
    const s7 = sprint(7, "planned", "2027-01-12", "2027-01-26");
    on(ALL_SPRINTS, page([s4, s5, s6]));
    on("POST /api/v1/projects/OPA/sprints", json(s7, 201));
    const { user, dialog } = await openComplete();

    await user.selectOptions(target(dialog), "New sprint…");
    const create = await screen.findByRole("dialog", { name: "Create a sprint" });
    await waitFor(() => {
      expect(within(create).getByLabelText("Name")).toHaveValue("Sprint 4");
    });
    await user.click(within(create).getByRole("button", { name: "Create sprint" }));

    const again = await screen.findByRole("dialog", { name: "Complete Sprint 4?" });
    await waitFor(() => {
      expect(target(again).selectedOptions[0]?.text).toBe("Sprint 7");
    });
  });

  it("explains that the sprint is no longer active, and reads the board again", async () => {
    on(`POST /api/v1/sprints/${s4.id}/complete`, problem(409, "sprint_not_active"));
    const { user, dialog } = await openComplete();
    const reads = calls("GET").filter(([url]) => url === TASKS.slice(4)).length;
    on(OPEN_SPRINTS, page([s5, s6]));
    on(TASKS, page([]));

    await user.click(within(dialog).getByRole("button", { name: "Complete sprint" }));

    await waitFor(() => {
      expect(messages()).toHaveTextContent("This sprint is no longer active.");
    });
    await waitFor(() => {
      expect(calls("GET").filter(([url]) => url === TASKS.slice(4)).length).toBeGreaterThan(reads);
    });
    expect(await screen.findByText("No sprint is active.")).toBeVisible();
  });
});

describe("Board with sprints: the sprint rules in words (WS-144 section 9, test 11)", () => {
  it("explains a refused move with the task page's sentence", async () => {
    on(`POST /api/v1/tasks/${t1.id}/move`, problem(409, "sprint_completed"));
    const user = await renderWithHeader();

    await user.click(screen.getByRole("button", { name: `Actions for ${t1.key}` }));
    await user.click(screen.getByRole("menuitem", { name: "In progress" }));

    await waitFor(() => {
      expect(messages()).toHaveTextContent("This task belongs to a completed sprint's record.");
    });
  });
});

describe("Board with sprints: live (WS-144 section 9, test 12)", () => {
  it("reads the header again on sprint.changed", async () => {
    await renderWithHeader();
    on(OPEN_SPRINTS, page([{ ...s4, goal: "A new goal", version: 4 }, s5, s6]));
    const reads = calls("GET").filter(([url]) => url === TASKS.slice(4)).length;

    act(() => {
      FakeSource.latest().send("sprint.changed", sprintChanged(s4.id, 4));
    });

    await waitFor(() => {
      expect(header()).toHaveTextContent("A new goal");
    });
    // The same sprint is active: the board is not read again.
    expect(calls("GET").filter(([url]) => url === TASKS.slice(4))).toHaveLength(reads);
  });

  it("reads the whole board again when another sprint starts", async () => {
    on(TASKS, page([]));
    await renderBoard({ open: [s5, s6] });
    await screen.findByText("No sprint is active.");
    const started = { ...s5, state: "active" as const, version: 2 };
    on(OPEN_SPRINTS, page([started, s6]));
    on(TASKS, page([task(9, todo.id, { title: "Started work", sprint: refOf(started) })]));

    act(() => {
      FakeSource.latest().send("sprint.changed", sprintChanged(s5.id, 2));
    });

    expect(await screen.findByRole("region", { name: "Active sprint: Sprint 5" })).toBeVisible();
    expect(await within(column("To do")).findByText("Started work")).toBeVisible();
  });

  it("reads the board again when someone completes the sprint", async () => {
    await renderWithHeader();
    on(OPEN_SPRINTS, page([s5, s6]));
    on(TASKS, page([]));

    act(() => {
      FakeSource.latest().send("sprint.changed", sprintChanged(s4.id, 4));
    });

    expect(await screen.findByText("No sprint is active.")).toBeVisible();
  });
});

describe("Board with sprints: read-only (WS-144 section 2, test 13)", () => {
  it("shows a Viewer the header and no control that writes", async () => {
    await renderWithHeader({ canWriteTasks: false, canManageSprints: false });

    expect(header()).toHaveTextContent("Ship the release");
    expect(within(header()).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add task" })).not.toBeInTheDocument();
  });

  it("shows a Member no Complete sprint", async () => {
    await renderWithHeader({ canManageSprints: false });

    expect(
      within(header()).queryByRole("button", { name: "Complete sprint" }),
    ).not.toBeInTheDocument();
  });

  it("offers no Complete sprint on an archived project", async () => {
    await renderWithHeader({ project: { ...sprints, archivedAt: "2026-12-01T10:00:00.000Z" } });

    expect(
      within(header()).queryByRole("button", { name: "Complete sprint" }),
    ).not.toBeInTheDocument();
  });
});
