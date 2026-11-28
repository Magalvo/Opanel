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
  todo,
} from "@/components/board/test-data";
import { bodyOf, calls, installFetch, on, problem } from "@/components/fake-api";
import { FakeSource } from "@/hooks/fake-event-source";
import type { Project } from "@/lib/schemas/projects";
import type { Sprint } from "@/lib/schemas/sprints";

import {
  ALL_SPRINTS,
  BACKLOG,
  COMPLETED_SPRINTS,
  inBacklog,
  OPEN_SPRINTS,
  refOf,
  sprint,
  sprintChanged,
} from "./test-data";

const navigation = vi.hoisted(() => ({ search: new URLSearchParams() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/projects/OPA/backlog",
  useSearchParams: () => navigation.search,
}));

const { ProjectFrame } = await import("@/components/projects/project-frame");
const { Backlog } = await import("@/components/backlog/backlog");

// The backlog of a project with sprints (WS-144 sections 4 to 6 and 9): tests 2, 4, 6, 7,
// and the backlog's parts of tests 11, 12 and 13.

const sprints: Project = { ...opa, sprintsEnabled: true };

const s4 = sprint(4, "active", "2026-12-01", "2026-12-14", {
  goal: "Ship the release",
  progress: { doneTasks: 3, totalTasks: 8, donePoints: 12, totalPoints: 30, unestimated: 2 },
});
const s5 = sprint(5, "planned", "2026-12-15", "2026-12-28", { goal: "Polish", version: 2 });
const s6 = sprint(6, "planned", "2026-12-29", "2027-01-11");
const s3 = sprint(3, "completed", "2026-11-17", "2026-11-30", {
  progress: { doneTasks: 5, totalTasks: 6, donePoints: 13, totalPoints: 15, unestimated: 0 },
});

const b1 = inBacklog(1, s5, { title: "Plan the release", storyPoints: 3 });
const b2 = inBacklog(2, null, { title: "Fix the login" });
const b3 = inBacklog(3, s5, { title: "Write the notes", storyPoints: 2 });
const b5 = inBacklog(5, null, { title: "Tidy the docs" });
// A sub-task of b1, in its sprint.
const sub = inBacklog(7, s5, {
  title: "Draft the notes",
  parent: { id: b1.id, key: b1.key, title: b1.title },
});

async function renderBacklog({
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
      <Backlog canWriteTasks={canWriteTasks} canManageSprints={canManageSprints} />
    </ProjectFrame>,
  );
  await screen.findByRole("region", { name: "Backlog" });
  return user;
}

function region(name: string) {
  return screen.getByRole("region", { name });
}

function rowsOf(name: string) {
  return within(region(name)).queryAllByRole("listitem");
}

function keysOf(name: string) {
  return rowsOf(name).map((row) => /OPA-\d+/.exec(row.textContent)?.[0]);
}

function messages() {
  return screen.getByRole("status", { name: "Backlog messages" });
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
  on(BACKLOG, page([b1, b2, b3, b5]));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Backlog with sprints: the sections (WS-144 section 4, test 2)", () => {
  it("shows the active sprint, the planned sprints by start date, the backlog, then the completed sprints", async () => {
    await renderBacklog({ open: [s4, s6, s5] });

    const names = screen
      .getAllByRole("region")
      .map((item) => item.getAttribute("aria-label") ?? item.querySelector("h2")?.textContent)
      .filter((name) => name !== null && /Sprint|Backlog/.test(name));
    expect(names).toEqual([
      "Active sprint: Sprint 4",
      "Sprint 5",
      "Sprint 6",
      "Backlog",
      "Completed sprints",
    ]);
  });

  it("sums up the active sprint without listing its tasks, with a link to the board", async () => {
    await renderBacklog();

    const active = region("Active sprint: Sprint 4");
    expect(active).toHaveTextContent("Dec 1, 2026 – Dec 14, 2026");
    expect(active).toHaveTextContent("9 days left");
    expect(active).toHaveTextContent("Ship the release");
    const bar = within(active).getByRole("progressbar", { name: "3 of 8 tasks done" });
    expect(bar).toHaveAttribute("aria-valuenow", "3");
    expect(bar).toHaveAttribute("aria-valuemax", "8");
    expect(active).toHaveTextContent("12 / 30 points");
    expect(active).toHaveTextContent("2 not estimated");
    expect(within(active).getByRole("link", { name: "Open the board" })).toHaveAttribute(
      "href",
      "/projects/OPA",
    );
    expect(within(active).queryAllByRole("listitem")).toHaveLength(0);
  });

  it("shows each planned sprint's dates, goal, tasks and points, then its tasks in backlog order", async () => {
    await renderBacklog();

    const planned = region("Sprint 5");
    expect(planned).toHaveTextContent("Dec 15, 2026 – Dec 28, 2026");
    expect(planned).toHaveTextContent("Polish");
    expect(planned).toHaveTextContent("2 tasks");
    expect(planned).toHaveTextContent("5 points");
    expect(keysOf("Sprint 5")).toEqual(["OPA-1", "OPA-3"]);
  });

  it("keeps a planned sprint with no tasks, and says how to fill it", async () => {
    await renderBacklog();

    expect(region("Sprint 6")).toHaveTextContent("No tasks yet. Drag tasks here or use Move to.");
    expect(region("Sprint 6")).toHaveTextContent("0 tasks");
  });

  it("lists the unscheduled tasks in the backlog's section, with Add task", async () => {
    await renderBacklog();

    expect(keysOf("Backlog")).toEqual(["OPA-2", "OPA-5"]);
    expect(within(region("Backlog")).getByRole("button", { name: "Add task" })).toBeVisible();
  });

  it("opens the completed sprints on demand, each with its frozen progress and a link to its tasks", async () => {
    on(COMPLETED_SPRINTS, page([s3]));
    const user = await renderBacklog();

    const completed = region("Completed sprints");
    const disclosure = within(completed).getByRole("button", { name: "Completed sprints" });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(calls("GET").some(([url]) => url.includes("state=completed"))).toBe(false);

    await user.click(disclosure);

    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    const link = await within(completed).findByRole("link", { name: "Sprint 3" });
    expect(link).toHaveAttribute("href", `/tasks?projectId=OPA&sprintId=${s3.id}`);
    expect(completed).toHaveTextContent("Nov 17, 2026 – Nov 30, 2026");
    expect(within(completed).getByRole("progressbar", { name: "5 of 6 tasks done" })).toBeVisible();
  });

  it("says when no sprint is active, and offers no link to the board", async () => {
    await renderBacklog({ open: [s5, s6] });

    expect(screen.queryByRole("region", { name: /^Active sprint/ })).not.toBeInTheDocument();
    expect(screen.getByText("No sprint is active.")).toBeVisible();
  });

  it("filters within each section", async () => {
    navigation.search = new URLSearchParams("q=notes");
    on(`${BACKLOG}&q=notes`, page([b3]));
    await renderBacklog();

    await waitFor(() => {
      expect(keysOf("Sprint 5")).toEqual(["OPA-3"]);
    });
    expect(region("Backlog")).toHaveTextContent("No matching tasks");
  });
});

describe("Backlog with sprints: moving tasks (WS-144 section 5, test 4)", () => {
  it("replaces Move to board with a Move to menu of sections", async () => {
    const user = await renderBacklog();

    expect(screen.queryByRole("button", { name: /^Move to board/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Actions for OPA-1" }));

    const menu = screen.getByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Move to top", "Move to bottom", "Sprint 6", "Backlog", "Active sprint"]);
    expect(within(menu).getByRole("menuitem", { name: "Move to top" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("moves a task to another sprint in one request, with its sprint and anchor", async () => {
    on(`POST /api/v1/tasks/${b2.id}/move`, json(full({ ...b2, sprint: refOf(s6), version: 2 })));
    const user = await renderBacklog();

    await user.click(screen.getByRole("button", { name: "Actions for OPA-2" }));
    await user.click(screen.getByRole("menuitem", { name: "Sprint 6" }));

    expect(calls("POST")).toHaveLength(1);
    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({ columnId: null, sprintId: s6.id, version: 1 });
    expect(keysOf("Sprint 6")).toEqual(["OPA-2"]);
    expect(keysOf("Backlog")).toEqual(["OPA-5"]);
    expect(messages()).toHaveTextContent("OPA-2 was moved to Sprint 6, position 1 of 1.");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Actions for OPA-2" })).toHaveFocus();
    });
  });

  it("unschedules a task moved to Backlog, after the last unscheduled task", async () => {
    on(`POST /api/v1/tasks/${b1.id}/move`, json(full({ ...b1, sprint: null, version: 2 })));
    const user = await renderBacklog();

    await user.click(screen.getByRole("button", { name: "Actions for OPA-1" }));
    await user.click(screen.getByRole("menuitem", { name: "Backlog" }));

    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({
      columnId: null,
      sprintId: null,
      afterTaskId: b5.id,
      version: 1,
    });
    expect(keysOf("Backlog")).toEqual(["OPA-2", "OPA-5", "OPA-1"]);
  });

  it("moves a task to the bottom of its own sprint", async () => {
    on(`POST /api/v1/tasks/${b1.id}/move`, json(full({ ...b1, version: 2 })));
    const user = await renderBacklog();

    await user.click(screen.getByRole("button", { name: "Actions for OPA-1" }));
    await user.click(screen.getByRole("menuitem", { name: "Move to bottom" }));

    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({
      columnId: null,
      sprintId: s5.id,
      afterTaskId: b3.id,
      version: 1,
    });
    expect(keysOf("Sprint 5")).toEqual(["OPA-3", "OPA-1"]);
  });

  it("sends a task to the active sprint on the board", async () => {
    on(`POST /api/v1/tasks/${b2.id}/move`, json(full({ ...b2, columnId: todo.id, version: 2 })));
    const user = await renderBacklog();

    await user.click(screen.getByRole("button", { name: "Actions for OPA-2" }));
    await user.click(screen.getByRole("menuitem", { name: "Active sprint" }));

    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({ columnId: todo.id, version: 1 });
    await waitFor(() => {
      expect(keysOf("Backlog")).toEqual(["OPA-5"]);
    });
    expect(messages()).toHaveTextContent("OPA-2 was moved to To do.");
  });

  it("offers a sub-task only moves within its section", async () => {
    on(BACKLOG, page([b1, sub, b2, b3]));
    const user = await renderBacklog();

    await user.click(screen.getByRole("button", { name: "Actions for OPA-7" }));

    expect(
      within(screen.getByRole("menu"))
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Move to top", "Move to bottom"]);
  });

  it("rolls a failed move back and explains it", async () => {
    on(`POST /api/v1/tasks/${b2.id}/move`, problem(409, "version_conflict"));
    const user = await renderBacklog();

    await user.click(screen.getByRole("button", { name: "Actions for OPA-2" }));
    await user.click(screen.getByRole("menuitem", { name: "Sprint 6" }));

    await waitFor(() => {
      expect(messages()).toHaveTextContent(
        "Someone else changed OPA-2. The backlog was refreshed.",
      );
    });
    expect(keysOf("Backlog")).toEqual(["OPA-2", "OPA-5"]);
  });

  it("gives every row a drag handle that names it", async () => {
    await renderBacklog();

    const handle = screen.getByRole("button", { name: "Move OPA-1 Plan the release" });
    expect(handle).toHaveAttribute("aria-roledescription", "sortable");
    await waitFor(() => {
      expect(handle).toHaveAccessibleDescription(/arrow keys/);
    });
  });
});

describe("Backlog with sprints: creating and editing (WS-144 section 6, test 6)", () => {
  it("offers Create sprint with Sprint N and dates after the latest sprint, for 14 days", async () => {
    on(ALL_SPRINTS, page([s3, s4, s5, s6]));
    const created = sprint(8, "planned", "2027-01-12", "2027-01-26", { name: "Hardening" });
    on("POST /api/v1/projects/OPA/sprints", json(created, 201));
    const user = await renderBacklog();

    await user.click(screen.getByRole("button", { name: "Create sprint" }));
    const dialog = await screen.findByRole("dialog", { name: "Create a sprint" });
    await waitFor(() => {
      expect(within(dialog).getByLabelText("Name")).toHaveValue("Sprint 5");
    });
    expect(within(dialog).getByLabelText("Start date")).toHaveValue("2027-01-12");
    expect(within(dialog).getByLabelText("End date")).toHaveValue("2027-01-26");

    await user.clear(within(dialog).getByLabelText("Name"));
    await user.type(within(dialog).getByLabelText("Name"), "Hardening");
    await user.type(within(dialog).getByLabelText("Goal"), "Fix what hurts");
    await user.click(within(dialog).getByRole("button", { name: "Create sprint" }));

    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({
      name: "Hardening",
      goal: "Fix what hurts",
      startDate: "2027-01-12",
      endDate: "2027-01-26",
    });
    expect(await screen.findByRole("region", { name: "Hardening" })).toBeVisible();
    expect(messages()).toHaveTextContent("Hardening was created.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows each field's 400 under it", async () => {
    on(ALL_SPRINTS, page([s4, s5, s6]));
    on(
      "POST /api/v1/projects/OPA/sprints",
      problem(400, "invalid_request", [
        { path: "endDate", message: "The end date may not be before the start date." },
        { path: "name", message: "Use at most 100 characters." },
      ]),
    );
    const user = await renderBacklog();

    await user.click(screen.getByRole("button", { name: "Create sprint" }));
    const dialog = await screen.findByRole("dialog", { name: "Create a sprint" });
    await waitFor(() => {
      expect(within(dialog).getByLabelText("Name")).toHaveValue("Sprint 4");
    });
    await user.click(within(dialog).getByRole("button", { name: "Create sprint" }));

    await waitFor(() => {
      expect(within(dialog).getByLabelText("End date")).toHaveAccessibleDescription(
        "The end date may not be before the start date.",
      );
    });
    expect(within(dialog).getByLabelText("Name")).toHaveAccessibleDescription(
      "Use at most 100 characters.",
    );
    expect(within(dialog).getByLabelText("End date")).toHaveAttribute("aria-invalid", "true");
  });

  it("edits a planned sprint with its version, sending what changed", async () => {
    on(`PATCH /api/v1/sprints/${s5.id}`, json({ ...s5, name: "Sprint 5b", version: 3 }));
    const user = await renderBacklog();

    await user.click(screen.getByRole("button", { name: "Actions for Sprint 5" }));
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Sprint 5" });
    expect(within(dialog).getByLabelText("Goal")).toHaveValue("Polish");
    await user.clear(within(dialog).getByLabelText("Name"));
    await user.type(within(dialog).getByLabelText("Name"), "Sprint 5b");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ name: "Sprint 5b", version: 2 });
    expect(await screen.findByRole("region", { name: "Sprint 5b" })).toBeVisible();
    expect(messages()).toHaveTextContent("Sprint 5b was saved.");
  });

  it("shows their version on a conflict, and says so", async () => {
    const theirs = { ...s5, name: "Their name", goal: "Theirs", version: 4 };
    on(`PATCH /api/v1/sprints/${s5.id}`, () =>
      Response.json(
        {
          type: "about:blank",
          title: "Conflict",
          status: 409,
          code: "version_conflict",
          detail: "A problem.",
          requestId: "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f",
          current: theirs,
        },
        { status: 409, headers: { "Content-Type": "application/problem+json" } },
      ),
    );
    const user = await renderBacklog();

    await user.click(screen.getByRole("button", { name: "Actions for Sprint 5" }));
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Sprint 5" });
    await user.type(within(dialog).getByLabelText("Goal"), " more");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Someone else changed this sprint. Their version is shown; make your change again.",
    );
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Their name");
    expect(within(dialog).getByLabelText("Goal")).toHaveValue("Theirs");
  });

  it("edits the active sprint from its summary", async () => {
    const user = await renderBacklog();

    await user.click(
      within(region("Active sprint: Sprint 4")).getByRole("button", { name: "Edit Sprint 4" }),
    );

    expect(screen.getByRole("dialog", { name: "Edit Sprint 4" })).toBeVisible();
  });
});

describe("Backlog with sprints: deleting and starting (WS-144 section 6, test 7)", () => {
  it("deletes a planned sprint after saying its tasks go back to the backlog", async () => {
    on(`DELETE /api/v1/sprints/${s5.id}`, () => new Response(null, { status: 204 }));
    const user = await renderBacklog();

    await user.click(screen.getByRole("button", { name: "Actions for Sprint 5" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete Sprint 5?" });
    expect(dialog).toHaveTextContent("Its 2 tasks go back to the backlog, unscheduled.");
    on(BACKLOG, page([b1, b2, b3, b5].map((item) => ({ ...item, sprint: null }))));
    on(OPEN_SPRINTS, page([s4, s6]));
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(calls("DELETE")).toHaveLength(1);
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "Sprint 5" })).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(keysOf("Backlog")).toEqual(["OPA-1", "OPA-2", "OPA-3", "OPA-5"]);
    });
    expect(messages()).toHaveTextContent("Sprint 5 was deleted.");
  });

  it("offers no Delete for the active sprint", async () => {
    await renderBacklog();

    expect(
      within(region("Active sprint: Sprint 4")).queryByRole("button", { name: /Delete/ }),
    ).not.toBeInTheDocument();
    expect(
      within(region("Active sprint: Sprint 4")).queryByRole("button", { name: /Actions for/ }),
    ).not.toBeInTheDocument();
  });

  it("starts a planned sprint after saying how many tasks go to the first column", async () => {
    on(`POST /api/v1/sprints/${s5.id}/start`, json({ ...s5, state: "active", version: 3 }));
    const user = await renderBacklog({ open: [s5, s6] });

    await user.click(within(region("Sprint 5")).getByRole("button", { name: /^Start sprint/ }));
    const dialog = screen.getByRole("alertdialog", { name: "Start Sprint 5?" });
    expect(dialog).toHaveTextContent("Its 2 tasks go to the first column, To do.");
    on(BACKLOG, page([b2, b5]));
    on(OPEN_SPRINTS, page([{ ...s5, state: "active", version: 3 }, s6]));
    await user.click(within(dialog).getByRole("button", { name: "Start sprint" }));

    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({ version: 2 });
    await waitFor(() => {
      expect(messages()).toHaveTextContent("Sprint 5 started.");
    });
    expect(screen.getByRole("link", { name: "Go to the board" })).toHaveAttribute(
      "href",
      "/projects/OPA",
    );
    expect(await screen.findByRole("region", { name: "Active sprint: Sprint 5" })).toBeVisible();
    await waitFor(() => {
      expect(keysOf("Backlog")).toEqual(["OPA-2", "OPA-5"]);
    });
  });

  it("explains that another sprint is active", async () => {
    on(`POST /api/v1/sprints/${s5.id}/start`, problem(409, "sprint_active"));
    const user = await renderBacklog();

    await user.click(within(region("Sprint 5")).getByRole("button", { name: /^Start sprint/ }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Start sprint" }),
    );

    await waitFor(() => {
      expect(messages()).toHaveTextContent("Complete the active sprint first.");
    });
  });

  it("explains that the sprint has already started", async () => {
    on(`POST /api/v1/sprints/${s5.id}/start`, problem(409, "sprint_not_planned"));
    const user = await renderBacklog({ open: [s5, s6] });

    await user.click(within(region("Sprint 5")).getByRole("button", { name: /^Start sprint/ }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Start sprint" }),
    );

    await waitFor(() => {
      expect(messages()).toHaveTextContent("This sprint has already started.");
    });
  });
});

describe("Backlog with sprints: the sprint rules in words (WS-144 section 9, test 11)", () => {
  it("explains a refusal of the rules with the task page's sentence", async () => {
    on(`POST /api/v1/tasks/${b2.id}/move`, problem(409, "no_active_sprint"));
    const user = await renderBacklog();

    await user.click(screen.getByRole("button", { name: "Actions for OPA-2" }));
    await user.click(screen.getByRole("menuitem", { name: "Active sprint" }));

    await waitFor(() => {
      expect(messages()).toHaveTextContent(
        "No sprint is active. Start one from the backlog to put tasks on the board.",
      );
    });
  });

  it("explains subtask_follows_parent on a move between sprints", async () => {
    on(`POST /api/v1/tasks/${b2.id}/move`, problem(409, "subtask_follows_parent"));
    const user = await renderBacklog();

    await user.click(screen.getByRole("button", { name: "Actions for OPA-2" }));
    await user.click(screen.getByRole("menuitem", { name: "Sprint 6" }));

    await waitFor(() => {
      expect(messages()).toHaveTextContent(
        "A sub-task stays where its parent is. Move the parent instead.",
      );
    });
  });
});

describe("Backlog with sprints: live (WS-144 section 9, test 12)", () => {
  it("reads the sprints again on sprint.changed", async () => {
    await renderBacklog();
    on(OPEN_SPRINTS, page([s4, { ...s5, name: "Renamed", version: 3 }, s6]));

    act(() => {
      FakeSource.latest().send("sprint.changed", sprintChanged(s5.id, 3));
    });

    expect(await screen.findByRole("region", { name: "Renamed" })).toBeVisible();
  });

  it("reads the whole backlog again when the active sprint changed", async () => {
    await renderBacklog({ open: [s5, s6] });
    on(OPEN_SPRINTS, page([{ ...s5, state: "active", version: 3 }, s6]));
    on(BACKLOG, page([b2, b5]));

    act(() => {
      FakeSource.latest().send("sprint.changed", sprintChanged(s5.id, 3));
    });

    expect(await screen.findByRole("region", { name: "Active sprint: Sprint 5" })).toBeVisible();
    await waitFor(() => {
      expect(screen.queryByText("Plan the release")).not.toBeInTheDocument();
    });
  });
});

describe("Backlog with sprints: read-only (WS-144 section 2, test 13)", () => {
  it("shows a Viewer every section and no control that writes", async () => {
    on(COMPLETED_SPRINTS, page([s3]));
    const user = await renderBacklog({ canWriteTasks: false, canManageSprints: false });

    expect(region("Active sprint: Sprint 4")).toBeVisible();
    expect(keysOf("Sprint 5")).toEqual(["OPA-1", "OPA-3"]);
    expect(keysOf("Backlog")).toEqual(["OPA-2", "OPA-5"]);
    expect(screen.queryByRole("button", { name: "Create sprint" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Start sprint/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Actions for/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Move OPA/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add task" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Completed sprints" }));
    expect(await screen.findByRole("link", { name: "Sprint 3" })).toBeVisible();
  });

  it("lets a Member move tasks but not manage sprints", async () => {
    await renderBacklog({ canManageSprints: false });

    expect(screen.getByRole("button", { name: "Actions for OPA-1" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Create sprint" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Start sprint/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Actions for Sprint 5" })).not.toBeInTheDocument();
  });

  it("offers nothing that writes on an archived project", async () => {
    await renderBacklog({ project: { ...sprints, archivedAt: "2026-12-01T10:00:00.000Z" } });

    expect(screen.queryByRole("button", { name: "Create sprint" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Actions for/ })).not.toBeInTheDocument();
  });
});
