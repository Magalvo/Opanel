import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  bugLabel,
  bugReport,
  column,
  docsLabel,
  doing,
  done,
  full,
  json,
  label,
  LABELS,
  opa,
  page,
  PROJECT,
  ref,
  task,
  todo,
  uiLabel,
} from "@/components/board/test-data";
import { bodyOf, calls, fetchMock, hold, installFetch, on, problem } from "@/components/fake-api";
import { FakeSource } from "@/hooks/fake-event-source";
import type { ActivityEvent } from "@/lib/schemas/activity";
import type { Comment } from "@/lib/schemas/comments";
import type { Epic } from "@/lib/schemas/epics";
import type { ProjectEvent } from "@/lib/schemas/events";
import type { Project } from "@/lib/schemas/projects";
import type { Task } from "@/lib/schemas/tasks";
import type { TeamSummary } from "@/lib/schemas/teams";

const router = { back: vi.fn(), push: vi.fn(), replace: vi.fn(), refresh: vi.fn() };

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/projects/OPA/tasks/OPA-1",
}));

const { ProjectFrame } = await import("@/components/projects/project-frame");
const { TaskDetail } = await import("./task-detail");

const ME = "99999999-9999-4999-8999-999999999999";
const ada = { id: "66666666-6666-4666-8666-666666666666", name: "Ada Lovelace", active: true };
const bob = { id: "77777777-7777-4777-8777-777777777777", name: "Bob Ross", active: false };
const grace = { id: "12121212-1212-4212-8212-121212121212", name: "Grace Hopper", active: true };
const gone = { id: "13131313-1313-4313-8313-131313131313", name: "Gregor Gone", active: false };

function team(id: string, name: string): TeamSummary {
  return { id, name, memberCount: 0, createdAt: "2026-11-12T10:00:00.000Z" };
}

const web = team("88888888-8888-4888-8888-888888888888", "Frontend");
const api = team("89898989-8989-4989-8989-898989898989", "API");

function epic(id: string, title: string, status: "open" | "closed"): Epic {
  return {
    id,
    projectId: opa.id,
    title,
    description: "",
    status,
    startDate: null,
    targetDate: null,
    progress: { doneTasks: 0, totalTasks: 0 },
    version: 1,
    createdAt: "2026-11-12T10:00:00.000Z",
    updatedAt: "2026-11-12T10:00:00.000Z",
  };
}

const launch = epic("aaaa0000-0000-4000-8000-000000000001", "Launch", "open");
const oldEpic = epic("aaaa0000-0000-4000-8000-000000000002", "Old work", "closed");

const base: Task = full(
  task(1, todo.id, {
    title: "Write the board",
    assignee: ada,
    assigneeTeam: { id: web.id, name: web.name },
    reporter: { id: ME, name: "Me Myself", kind: "human" },
    version: 3,
  }),
  { description: "Some **bold** text." },
);

function comment(n: number, body: string): Comment {
  return {
    id: `cccccccc-cccc-4ccc-8ccc-${String(n).padStart(12, "0")}`,
    taskId: base.id,
    kind: "user",
    author: { id: ada.id, name: "Ada Lovelace", kind: "human" },
    body,
    createdAt: "2026-11-14T10:00:00.000Z",
  };
}

/** A history entry by Ada, at minute `n`, after the comments' 10:00. */
function change(
  n: number,
  fields: Partial<Pick<ActivityEvent, "type" | "field" | "oldValue" | "newValue">>,
): ActivityEvent {
  return {
    kind: "event",
    id: String(n),
    type: "field_changed",
    field: null,
    oldValue: null,
    newValue: null,
    actor: { id: ada.id, name: "Ada Lovelace", kind: "human" },
    createdAt: `2026-11-14T10:${String(n).padStart(2, "0")}:00.000Z`,
    ...fields,
  };
}

/** A page of activity: comments as comment items, events as they are. */
function activity(items: (Comment | ActivityEvent)[], nextCursor: string | null = null) {
  return json({
    items: items.map((item) =>
      "kind" in item && item.kind === "event" ? item : { kind: "comment", comment: item },
    ),
    nextCursor,
  });
}

const TASK = "GET /api/v1/tasks/OPA-1";
const COLUMNS = "GET /api/v1/projects/OPA/columns";
const ACTIVITY = "GET /api/v1/tasks/OPA-1/activity?limit=50";
const TEAMS = "GET /api/v1/teams?limit=50";
const EPICS = "GET /api/v1/projects/OPA/epics?limit=100";

interface Options {
  project?: Project;
  current?: Task;
  canWriteTasks?: boolean;
  canWriteLabels?: boolean;
  canComment?: boolean;
  canDeleteAny?: boolean;
  canDeleteOwn?: boolean;
  accountId?: string;
  mode?: "page" | "dialog";
}

async function renderTask(options: Options = {}) {
  const {
    project = opa,
    current = base,
    canWriteTasks = true,
    canWriteLabels = true,
    canComment = true,
    canDeleteAny = false,
    canDeleteOwn = true,
    accountId = ME,
    mode = "page",
  } = options;
  on(PROJECT, json(project));
  on(TASK, json(current));
  const user = userEvent.setup();
  render(
    <ProjectFrame projectKey="OPA" canManageProjects={false}>
      <TaskDetail
        taskKey="OPA-1"
        mode={mode}
        canWriteTasks={canWriteTasks}
        canWriteLabels={canWriteLabels}
        canComment={canComment}
        canDeleteAny={canDeleteAny}
        canDeleteOwn={canDeleteOwn}
        accountId={accountId}
      />
    </ProjectFrame>,
  );
  await screen.findByRole("heading", { level: 2, name: current.title });
  await screen.findByRole("region", { name: "Activity" });
  return user;
}

function status() {
  return screen.getByRole("status", { name: "Task messages" });
}

function details() {
  return screen.getByRole("region", { name: "Details" });
}

function comments() {
  return screen.getByRole("region", { name: "Activity" });
}

beforeEach(() => {
  installFetch();
  router.back.mockReset();
  router.push.mockReset();
  on(COLUMNS, page([todo, doing, done]));
  on(ACTIVITY, activity([comment(1, "First *comment*"), comment(2, "Second")]));
  on(TEAMS, page([web, api]));
  on(EPICS, page([launch]));
  on(LABELS, page([bugLabel, docsLabel, uiLabel]));
});

describe("TaskDetail: what it shows", () => {
  it("shows key, title, type, column, team, person, epic, reporter, times and the description", async () => {
    await renderTask({
      current: { ...base, epic: { id: launch.id, title: "Launch" } },
      canWriteTasks: false,
    });

    expect(screen.getByText("OPA-1")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Write the board");
    const info = details();
    expect(within(info).getByText("Task", { selector: "span" })).toBeInTheDocument();
    for (const [term, value] of [
      ["Column", "To do"],
      ["Team", "Frontend"],
      ["Person", "Ada Lovelace"],
      ["Epic", "Launch"],
      ["Reporter", "Me Myself"],
    ] as const) {
      expect(within(info).getByText(term).nextElementSibling).toHaveTextContent(value);
    }
    expect(within(info).getByText("Created")).toBeInTheDocument();
    expect(within(info).getByText("Updated")).toBeInTheDocument();
    expect(within(info).getByText("bold", { selector: "strong" })).toBeInTheDocument();
  });

  it("marks a deactivated person", async () => {
    await renderTask({ current: { ...base, assignee: bob }, canWriteTasks: false });

    expect(within(details()).getByText("Person").nextElementSibling).toHaveTextContent(
      "Bob Ross (inactive)",
    );
  });

  it("says the task does not exist for a 404", async () => {
    on(PROJECT, json(opa));
    on(TASK, problem(404, "not_found"));
    render(
      <ProjectFrame projectKey="OPA" canManageProjects={false}>
        <TaskDetail
          taskKey="OPA-1"
          mode="page"
          canWriteTasks
          canWriteLabels
          canComment
          canDeleteAny={false}
          canDeleteOwn
          accountId={ME}
        />
      </ProjectFrame>,
    );

    expect(await screen.findByText("This task does not exist.")).toBeInTheDocument();
  });

  it("says the task does not exist when it belongs to another project", async () => {
    on(PROJECT, json(opa));
    on(TASK, json({ ...base, projectId: "abababab-abab-4bab-8bab-abababababab" }));
    render(
      <ProjectFrame projectKey="OPA" canManageProjects={false}>
        <TaskDetail
          taskKey="OPA-1"
          mode="page"
          canWriteTasks
          canWriteLabels
          canComment
          canDeleteAny={false}
          canDeleteOwn
          accountId={ME}
        />
      </ProjectFrame>,
    );

    expect(await screen.findByText("This task does not exist.")).toBeInTheDocument();
  });
});

describe("TaskDetail: editing", () => {
  it("enables Save only after a change and sends only changed fields with the version", async () => {
    on("PATCH /api/v1/tasks/OPA-1", json({ ...base, title: "Write the board well", version: 4 }));
    const user = await renderTask();
    const form = details();
    const save = within(form).getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();

    await user.clear(within(form).getByLabelText("Title"));
    await user.type(within(form).getByLabelText("Title"), "Write the board well");
    await user.selectOptions(within(form).getByLabelText("Type"), "Bug");
    await user.click(save);

    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({
      title: "Write the board well",
      type: "bug",
      version: 3,
    });
    expect(status()).toHaveTextContent("Saved.");
  });

  it("takes the answer as the task, so the next save sends the new version", async () => {
    on("PATCH /api/v1/tasks/OPA-1", json({ ...base, title: "Second", version: 4 }));
    const user = await renderTask();
    const title = within(details()).getByLabelText("Title");

    await user.clear(title);
    await user.type(title, "Second");
    await user.click(within(details()).getByRole("button", { name: "Save changes" }));
    await screen.findByRole("heading", { level: 2, name: "Second" });
    on("PATCH /api/v1/tasks/OPA-1", json({ ...base, title: "Third", version: 5 }));
    await user.clear(title);
    await user.type(title, "Third");
    await user.click(within(details()).getByRole("button", { name: "Save changes" }));

    expect(bodyOf(calls("PATCH")[1]?.[1])).toEqual({ title: "Third", version: 4 });
  });

  it("sends a new description written with Write, and Preview renders it", async () => {
    on("PATCH /api/v1/tasks/OPA-1", json({ ...base, description: "# Plan", version: 4 }));
    const user = await renderTask();
    const form = details();

    await user.clear(within(form).getByLabelText("Description"));
    await user.type(within(form).getByLabelText("Description"), "# Plan");
    await user.click(within(form).getByRole("button", { name: "Preview" }));
    expect(within(form).getByRole("heading", { name: "Plan" })).toBeInTheDocument();
    await user.click(within(form).getByRole("button", { name: "Write" }));
    await user.click(within(form).getByRole("button", { name: "Save changes" }));

    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ description: "# Plan", version: 3 });
  });

  it("refills the form from current after a version conflict, and explains", async () => {
    const theirs = { ...base, title: "Their title", version: 7 };
    on("PATCH /api/v1/tasks/OPA-1", () =>
      Response.json(
        {
          type: "about:blank",
          title: "Conflict",
          status: 409,
          code: "version_conflict",
          detail: "Changed.",
          requestId: "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f",
          current: theirs,
        },
        { status: 409 },
      ),
    );
    const user = await renderTask();

    await user.type(within(details()).getByLabelText("Title"), " mine");
    await user.click(within(details()).getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("heading", { level: 2, name: "Their title" })).toBeVisible();
    expect(within(details()).getByLabelText("Title")).toHaveValue("Their title");
    expect(status()).toHaveTextContent(
      "Someone else changed this task. Their version is shown; make your change again.",
    );
  });

  it("explains a deactivated person and shows field errors at their field", async () => {
    on("PATCH /api/v1/tasks/OPA-1", problem(409, "account_inactive"));
    const user = await renderTask();
    await user.type(within(details()).getByLabelText("Title"), "!");
    await user.click(within(details()).getByRole("button", { name: "Save changes" }));
    expect(status()).toHaveTextContent("This person is deactivated and cannot be assigned.");

    on(
      "PATCH /api/v1/tasks/OPA-1",
      problem(400, "invalid_request", [{ path: "title", message: "Too long." }]),
    );
    await user.click(within(details()).getByRole("button", { name: "Save changes" }));
    expect(within(details()).getByLabelText("Title")).toHaveAccessibleDescription("Too long.");
  });

  it("turns read-only when the project turns out to be archived", async () => {
    on("PATCH /api/v1/tasks/OPA-1", problem(409, "project_archived"));
    const user = await renderTask();
    on(PROJECT, json({ ...opa, archivedAt: "2026-11-16T10:00:00.000Z", version: 4 }));

    await user.type(within(details()).getByLabelText("Title"), "!");
    await user.click(within(details()).getByRole("button", { name: "Save changes" }));

    expect(
      await screen.findByText("This project is archived. The task is read-only."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(status()).toHaveTextContent("The project is archived.");
  });
});

describe("TaskDetail: assignment", () => {
  it("finds active people only, sets a person and clears it", async () => {
    on("GET /api/v1/people?q=Gr&limit=20", page([grace, gone]));
    on("PATCH /api/v1/tasks/OPA-1", json({ ...base, assignee: grace, version: 4 }));
    const user = await renderTask();
    const form = details();

    await user.type(within(form).getByLabelText("Find a person"), "Gr");
    await user.click(await within(form).findByRole("button", { name: "Choose Grace Hopper" }));
    expect(within(form).queryByRole("button", { name: "Choose Gregor Gone" })).toBeNull();
    await user.click(within(form).getByRole("button", { name: "Save changes" }));
    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ assigneeAccountId: grace.id, version: 3 });

    on("PATCH /api/v1/tasks/OPA-1", json({ ...base, assignee: null, version: 5 }));
    await user.click(within(form).getByRole("button", { name: "No one" }));
    await user.click(within(form).getByRole("button", { name: "Save changes" }));
    expect(bodyOf(calls("PATCH")[1]?.[1])).toEqual({ assigneeAccountId: null, version: 4 });
  });

  it("offers every team and No team", async () => {
    on("PATCH /api/v1/tasks/OPA-1", json({ ...base, assigneeTeam: null, version: 4 }));
    const user = await renderTask();
    const select = within(details()).getByLabelText("Team");

    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["No team", "Frontend", "API"]);
    await user.selectOptions(select, "No team");
    await user.click(within(details()).getByRole("button", { name: "Save changes" }));
    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ assigneeTeamId: null, version: 3 });
  });

  it("offers the open epics, the task's own closed epic and No epic", async () => {
    on("PATCH /api/v1/tasks/OPA-1", json({ ...base, version: 4 }));
    const user = await renderTask({
      current: { ...base, epic: { id: oldEpic.id, title: "Old work" } },
    });
    const select = within(details()).getByLabelText("Epic");

    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["No epic", "Launch", "Old work (closed)"]);
    await user.selectOptions(select, "Launch");
    await user.click(within(details()).getByRole("button", { name: "Save changes" }));
    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ epicId: launch.id, version: 3 });
  });
});

describe("TaskDetail: column, delete and the board", () => {
  it("moves the task to the end of the chosen column and tells the board", async () => {
    const moved = { ...base, columnId: done.id, version: 4 };
    on("POST /api/v1/tasks/OPA-1/move", json(moved));
    const changed = vi.fn<(event: Event) => void>();
    window.addEventListener("opanel:task-changed", changed);
    const user = await renderTask();

    await user.selectOptions(within(details()).getByLabelText("Column"), "Done");

    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({ columnId: done.id, version: 3 });
    expect(status()).toHaveTextContent("Moved to Done.");
    expect(within(details()).getByLabelText("Column")).toHaveValue(done.id);
    expect((changed.mock.calls[0]?.[0] as CustomEvent).detail).toEqual(moved);
    window.removeEventListener("opanel:task-changed", changed);
  });

  it("selects Backlog for a backlog task, and moves it to a chosen column (WS-101, WS-109)", async () => {
    const moved = { ...base, columnId: doing.id, version: 4 };
    on("POST /api/v1/tasks/OPA-1/move", json(moved));
    const user = await renderTask({ current: { ...base, columnId: null } });

    const select = within(details()).getByLabelText("Column");
    expect(select).toHaveValue("");
    expect(within(select).getByRole("option", { name: "Backlog" })).toBeEnabled();
    expect(within(select).queryByRole("option", { name: "In backlog" })).toBeNull();

    await user.selectOptions(select, "In progress");

    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({ columnId: doing.id, version: 3 });
    expect(select).toHaveValue(doing.id);
  });

  it("offers Backlog first, and moves a task to the end of the backlog (WS-109)", async () => {
    const moved = { ...base, columnId: null, version: 4 };
    on("POST /api/v1/tasks/OPA-1/move", json(moved));
    const changed = vi.fn<(event: Event) => void>();
    window.addEventListener("opanel:task-changed", changed);
    const user = await renderTask();

    const select = within(details()).getByLabelText("Column");
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Backlog", "To do", "In progress", "Done"]);
    await user.selectOptions(select, "Backlog");

    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({ columnId: null, version: 3 });
    expect(status()).toHaveTextContent("Moved to the backlog.");
    expect(select).toHaveValue("");
    expect((changed.mock.calls[0]?.[0] as CustomEvent).detail).toEqual(moved);
    window.removeEventListener("opanel:task-changed", changed);
  });

  it("shows In backlog as the column of a backlog task when read-only (WS-101)", async () => {
    await renderTask({ current: { ...base, columnId: null }, canWriteTasks: false });

    expect(within(details()).getByText("Column").nextElementSibling).toHaveTextContent(
      "In backlog",
    );
  });

  it("keeps unsaved edits when the task is moved, and saves them with the new version", async () => {
    on("POST /api/v1/tasks/OPA-1/move", json({ ...base, columnId: done.id, version: 4 }));
    on(
      "PATCH /api/v1/tasks/OPA-1",
      json({ ...base, columnId: done.id, title: "Edited", version: 5 }),
    );
    const user = await renderTask();

    await user.clear(within(details()).getByLabelText("Title"));
    await user.type(within(details()).getByLabelText("Title"), "Edited");
    await user.selectOptions(within(details()).getByLabelText("Column"), "Done");
    await screen.findByText("Moved to Done.");

    expect(within(details()).getByLabelText("Title")).toHaveValue("Edited");
    await user.click(within(details()).getByRole("button", { name: "Save changes" }));
    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ title: "Edited", version: 4 });
  });

  it("tells the board about a saved task", async () => {
    const saved = { ...base, title: "Renamed", version: 4 };
    on("PATCH /api/v1/tasks/OPA-1", json(saved));
    const changed = vi.fn<(event: Event) => void>();
    window.addEventListener("opanel:task-changed", changed);
    const user = await renderTask();

    await user.type(within(details()).getByLabelText("Title"), "!");
    await user.click(within(details()).getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect((changed.mock.calls[0]?.[0] as CustomEvent | undefined)?.detail).toEqual(saved);
    });
    window.removeEventListener("opanel:task-changed", changed);
  });

  it.each([
    ["a Manager or Admin", { canDeleteAny: true, canDeleteOwn: true, accountId: ada.id }, true],
    ["the reporter", { canDeleteAny: false, canDeleteOwn: true, accountId: ME }, true],
    ["another Member", { canDeleteAny: false, canDeleteOwn: true, accountId: ada.id }, false],
    ["a Viewer", { canDeleteAny: false, canDeleteOwn: false, accountId: ME }, false],
  ] as const)("offers Delete to %s: %s", async (_who, rights, offered) => {
    await renderTask(rights);

    expect(screen.queryByRole("button", { name: "Delete task" }) !== null).toBe(offered);
  });

  it("asks first, deletes, tells the board, and closes the dialog", async () => {
    on("DELETE /api/v1/tasks/OPA-1", () => new Response(null, { status: 204 }));
    const deleted = vi.fn<(event: Event) => void>();
    window.addEventListener("opanel:task-deleted", deleted);
    const user = await renderTask({ mode: "dialog" });

    await user.click(screen.getByRole("button", { name: "Delete task" }));
    const confirm = screen.getByRole("alertdialog", { name: "Delete OPA-1?" });
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(router.back).toHaveBeenCalledOnce();
    });
    expect(calls("DELETE")).toHaveLength(1);
    expect((deleted.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ id: base.id });
    window.removeEventListener("opanel:task-deleted", deleted);
  });

  it("goes to the board after deleting from the full page; a failure keeps the task", async () => {
    on("DELETE /api/v1/tasks/OPA-1", problem(500, "internal_error"));
    const user = await renderTask();

    await user.click(screen.getByRole("button", { name: "Delete task" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }),
    );
    expect(await screen.findByText("Could not delete OPA-1. Try again.")).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();

    on("DELETE /api/v1/tasks/OPA-1", () => new Response(null, { status: 204 }));
    await user.click(screen.getByRole("button", { name: "Delete task" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }),
    );
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith("/projects/OPA");
    });
  });
});

describe("TaskDetail: comments", () => {
  it("lists comments oldest first as Markdown, and loads more", async () => {
    on(ACTIVITY, activity([comment(1, "First *comment*")], "c1"));
    on(`${ACTIVITY}&cursor=c1`, activity([comment(2, "Second")]));
    const user = await renderTask();
    const section = comments();

    expect(within(section).getByText("comment", { selector: "em" })).toBeInTheDocument();
    await user.click(within(section).getByRole("button", { name: "Load more" }));

    const items = within(section).getAllByRole("article");
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining("First"),
      expect.stringContaining("Second"),
    ]);
    expect(items[0]).toHaveTextContent("Ada Lovelace");
  });

  it("adds a comment with a preview and appends the answer", async () => {
    on("POST /api/v1/tasks/OPA-1/comments", json(comment(3, "Done **now**"), 201));
    const user = await renderTask();
    const section = comments();

    await user.click(within(section).getByRole("button", { name: "Add comment" }));
    expect(within(section).getByLabelText("New comment")).toHaveAccessibleDescription(
      "Write something.",
    );
    expect(calls("POST")).toEqual([]);

    await user.type(within(section).getByLabelText("New comment"), "Done **now**");
    await user.click(within(section).getByRole("button", { name: "Preview" }));
    expect(within(section).getAllByText("now", { selector: "strong" })).toHaveLength(1);
    await user.click(within(section).getByRole("button", { name: "Write" }));
    await user.click(within(section).getByRole("button", { name: "Add comment" }));

    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({ body: "Done **now**" });
    expect(within(section).getAllByRole("article")).toHaveLength(3);
    expect(status()).toHaveTextContent("Comment added.");
    expect(within(section).getByLabelText("New comment")).toHaveValue("");
  });

  it("shows one's own comment once, at the end, when Load more returns it (WS-080)", async () => {
    on(ACTIVITY, activity([comment(1, "First *comment*")], "c1"));
    on(`${ACTIVITY}&cursor=c1`, activity([comment(2, "Second"), comment(3, "Mine")]));
    on("POST /api/v1/tasks/OPA-1/comments", json(comment(3, "Mine"), 201));
    const user = await renderTask();
    const section = comments();

    await user.type(within(section).getByLabelText("New comment"), "Mine");
    await user.click(within(section).getByRole("button", { name: "Add comment" }));
    await within(section).findByText("Mine");
    await user.click(within(section).getByRole("button", { name: "Load more" }));
    await within(section).findByText("Second");

    expect(
      within(section)
        .getAllByRole("article")
        .map((item) => item.textContent),
    ).toEqual([
      expect.stringContaining("First"),
      expect.stringContaining("Second"),
      expect.stringContaining("Mine"),
    ]);
  });

  it("disables Load more while it loads, and asks once (WS-080)", async () => {
    on(ACTIVITY, activity([comment(1, "First *comment*")], "c1"));
    const release = hold(`${ACTIVITY}&cursor=c1`);
    await renderTask();
    const more = within(comments()).getByRole("button", { name: "Load more" });

    fireEvent.click(more);
    fireEvent.click(more);

    await waitFor(() => {
      expect(more).toBeDisabled();
    });
    expect(calls("GET").filter(([url]) => url.includes("cursor=c1"))).toHaveLength(1);
    await act(() => release(activity([comment(2, "Second")])));
    expect(within(comments()).getAllByRole("article")).toHaveLength(2);
  });

  it("has no comment form without comments:write", async () => {
    await renderTask({ canComment: false });

    expect(within(comments()).queryByLabelText("New comment")).toBeNull();
  });
});

describe("TaskDetail: agents (WS-074)", () => {
  const bot = {
    id: "14141414-1414-4414-8414-141414141414",
    name: "QA Bot",
    kind: "agent",
  } as const;

  function reporterCell() {
    return within(details()).getByText("Reporter").nextElementSibling;
  }

  it("follows an agent reporter with the Agent badge, read-only and in the edit form", async () => {
    await renderTask({ current: { ...base, reporter: bot }, canWriteTasks: false });
    expect(reporterCell()).toHaveTextContent(/^QA Bot\s*Agent$/);
  });

  it("shows the badge in the edit form too", async () => {
    await renderTask({ current: { ...base, reporter: bot } });
    expect(reporterCell()).toHaveTextContent(/^QA Bot\s*Agent$/);
  });

  it("shows no badge for a human reporter", async () => {
    await renderTask({ canWriteTasks: false });
    expect(reporterCell()).toHaveTextContent(/^Me Myself$/);
    expect(within(details()).queryByText("Agent")).not.toBeInTheDocument();
  });

  it("badges an agent's comment only; a system comment is Opanel with no badge", async () => {
    on(
      ACTIVITY,
      activity([
        { ...comment(1, "From the bot"), author: bot },
        comment(2, "From Ada"),
        { ...comment(3, "From Opanel"), kind: "system", author: null },
      ]),
    );
    await renderTask();

    const articles = within(comments()).getAllByRole("article");
    expect(articles.map((article) => article.textContent)).toEqual([
      expect.stringMatching(/^QA Bot\s*Agent ·/),
      expect.stringMatching(/^Ada Lovelace ·/),
      expect.stringMatching(/^Opanel ·/),
    ]);
    expect(within(comments()).getAllByText("Agent")).toHaveLength(1);
  });
});

describe("TaskDetail: read-only", () => {
  it("shows a Viewer no form, column select, comment form or Delete", async () => {
    await renderTask({
      canWriteTasks: false,
      canComment: false,
      canDeleteAny: false,
      canDeleteOwn: false,
    });

    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(screen.queryByLabelText("Column")).toBeNull();
    expect(screen.queryByLabelText("New comment")).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete task" })).toBeNull();
  });

  it("is read-only for everyone on an archived project, and says why", async () => {
    await renderTask({
      project: { ...opa, archivedAt: "2026-11-16T10:00:00.000Z" },
      canDeleteAny: true,
    });

    expect(screen.getByText("This project is archived. The task is read-only.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(screen.queryByLabelText("Column")).toBeNull();
    expect(screen.queryByLabelText("New comment")).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete task" })).toBeNull();
  });
});

describe("TaskDetail: accessibility", () => {
  it("names every field and control", async () => {
    await renderTask({ canDeleteAny: true });

    for (const label of ["Title", "Type", "Description", "Team", "Find a person", "Epic"]) {
      expect(within(details()).getByLabelText(label)).toBeInTheDocument();
    }
    expect(within(details()).getByLabelText("Column")).toBeInTheDocument();
    expect(within(comments()).getByLabelText("New comment")).toBeInTheDocument();
  });

  it("closes the delete confirmation with Escape and returns focus", async () => {
    const user = await renderTask();
    const button = screen.getByRole("button", { name: "Delete task" });

    await user.click(button);
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => {
      expect(button).toHaveFocus();
    });
  });

  it("keeps an extra column visible in the column select", async () => {
    on(
      COLUMNS,
      page([
        todo,
        doing,
        done,
        column("44444444-4444-4444-8444-444444444441", "QA", "in_progress"),
      ]),
    );
    await renderTask();

    // The four columns, after "Backlog" (WS-109).
    expect(within(within(details()).getByLabelText("Column")).getAllByRole("option")).toHaveLength(
      5,
    );
  });
});

describe("TaskDetail: live (WS-049 section 3)", () => {
  function send(type: ProjectEvent["type"], extra: Record<string, unknown>) {
    act(() => {
      FakeSource.latest().send(type, {
        id: crypto.randomUUID(),
        type,
        projectId: opa.id,
        entity: type.split(".")[0],
        entityId: base.id,
        version: null,
        actorAccountId: ada.id,
        at: "2026-11-18T10:00:00.000Z",
        ...extra,
      });
    });
  }

  async function renderLive(options: Options = {}) {
    const user = await renderTask(options);
    act(() => {
      FakeSource.latest().open();
    });
    return user;
  }

  function reads(url: string): number {
    return calls("GET").filter(([called]) => called === url).length;
  }

  it("shows a newer version at once when nothing is unsaved, and says so", async () => {
    await renderLive();
    on(TASK, json({ ...base, title: "Their title", version: 4 }));

    send("task.updated", { version: 4 });

    expect(await screen.findByRole("heading", { level: 2, name: "Their title" })).toBeVisible();
    expect(within(details()).getByLabelText("Title")).toHaveValue("Their title");
    expect(status()).toHaveTextContent("Someone else changed this task.");
  });

  it("keeps unsaved edits, updates the other fields, and saves on the old version", async () => {
    const user = await renderLive();
    await user.type(within(details()).getByLabelText("Title"), " mine");
    on(TASK, json({ ...base, description: "Their description", version: 4 }));

    send("task.updated", { version: 4 });

    await waitFor(() => {
      expect(within(details()).getByLabelText("Description")).toHaveValue("Their description");
    });
    expect(within(details()).getByLabelText("Title")).toHaveValue("Write the board mine");
    expect(status()).toHaveTextContent(
      "Someone else changed this task. Saving will show their version first.",
    );

    await user.click(within(details()).getByRole("button", { name: "Save changes" }));
    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ title: "Write the board mine", version: 3 });
  });

  it("takes its own save's event as its own, whatever answers first", async () => {
    const saved = { ...base, title: "Write the board mine", version: 4 };
    on("PATCH /api/v1/tasks/OPA-1", json(saved));
    let readAgain: (response: Response) => void = () => undefined;
    on(TASK, () => Response.json(saved));
    const user = await renderLive();
    await user.type(within(details()).getByLabelText("Title"), " mine");
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          readAgain = resolve;
        }),
    );

    // The event of the save arrives first and starts a read, which answers last.
    send("task.updated", { version: 4 });
    await user.click(within(details()).getByRole("button", { name: "Save changes" }));
    await screen.findByRole("heading", { level: 2, name: "Write the board mine" });
    await act(async () => {
      readAgain(Response.json(saved));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(status()).toHaveTextContent("Saved.");
    await user.type(within(details()).getByLabelText("Title"), "!");
    await user.click(within(details()).getByRole("button", { name: "Save changes" }));
    expect(bodyOf(calls("PATCH")[1]?.[1])).toMatchObject({ version: 4 });
  });

  it("ignores the echo of a version it holds, and events of other tasks", async () => {
    await renderLive();
    const before = reads("/api/v1/tasks/OPA-1");

    send("task.updated", { version: 3 });
    send("task.moved", { entityId: task(2, todo.id).id, version: 9 });

    expect(reads("/api/v1/tasks/OPA-1")).toBe(before);
  });

  it("turns read-only and says so when the task is deleted, and comes back when restored", async () => {
    await renderLive();

    send("task.deleted", { version: 4 });

    expect(status()).toHaveTextContent("This task was deleted.");
    expect(within(details()).queryByLabelText("Title")).not.toBeInTheDocument();
    expect(within(comments()).queryByLabelText("New comment")).not.toBeInTheDocument();

    on(TASK, json({ ...base, version: 5 }));
    send("task.restored", { version: 5 });

    expect(await within(details()).findByLabelText("Title")).toBeVisible();
  });

  it("shows a new comment once every page is loaded, and never twice", async () => {
    await renderLive();
    on(
      ACTIVITY,
      activity([comment(1, "First *comment*"), comment(2, "Second"), comment(3, "Third, theirs")]),
    );
    const before = reads("/api/v1/tasks/OPA-1/activity?limit=50");

    send("comment.created", { entityId: comment(2, "").id, taskId: base.id });
    expect(reads("/api/v1/tasks/OPA-1/activity?limit=50")).toBe(before);

    send("comment.created", { entityId: comment(3, "").id, taskId: base.id });

    expect(await within(comments()).findByText("Third, theirs")).toBeVisible();
    expect(within(comments()).getAllByText("Second")).toHaveLength(1);
  });

  it("leaves a new comment to Load more when not every page is loaded", async () => {
    on(ACTIVITY, activity([comment(1, "First *comment*")], "NEXT"));
    await renderLive();
    const before = reads("/api/v1/tasks/OPA-1/activity?limit=50");

    send("comment.created", { entityId: comment(3, "").id, taskId: base.id });

    expect(reads("/api/v1/tasks/OPA-1/activity?limit=50")).toBe(before);
  });

  it("reads the columns and the open epics again when they change", async () => {
    await renderLive();
    on(
      COLUMNS,
      page([
        todo,
        doing,
        done,
        column("44444444-4444-4444-8444-444444444444", "Review", "in_progress"),
      ]),
    );
    on(EPICS, page([launch, epic("aaaa0000-0000-4000-8000-000000000003", "Beta", "open")]));

    send("column.changed", { entity: "column", entityId: todo.id, version: 2 });
    send("epic.changed", { entity: "epic", entityId: launch.id, version: 2 });

    expect(await within(details()).findByRole("option", { name: "Review" })).toBeInTheDocument();
    expect(await within(details()).findByRole("option", { name: "Beta" })).toBeInTheDocument();
  });

  it("loads the task and its comments again after a reconnect", async () => {
    await renderLive();
    on(TASK, json({ ...base, title: "After the gap", version: 6 }));
    on(
      ACTIVITY,
      activity([comment(1, "First *comment*"), comment(2, "Second"), comment(4, "Missed")]),
    );

    act(() => {
      FakeSource.latest().drop();
      FakeSource.latest().open();
    });

    expect(await screen.findByRole("heading", { level: 2, name: "After the gap" })).toBeVisible();
    expect(await within(comments()).findByText("Missed")).toBeVisible();
  });

  it("reads the activity again on a change to this task once every page is shown (WS-119)", async () => {
    await renderLive();
    on(
      ACTIVITY,
      activity([
        comment(1, "First *comment*"),
        comment(2, "Second"),
        change(30, { field: "priority", oldValue: "none", newValue: "high" }),
      ]),
    );
    on(TASK, json({ ...base, version: 3 }));

    send("task.updated", { version: 3 });

    expect(
      await within(comments()).findByText(/changed the priority from None to High/),
    ).toBeVisible();
  });

  it("leaves a change to Load more when not every page is shown (WS-119)", async () => {
    on(ACTIVITY, activity([comment(1, "First *comment*")], "NEXT"));
    await renderLive();
    const before = reads("/api/v1/tasks/OPA-1/activity?limit=50");
    on(TASK, json({ ...base, version: 3 }));

    send("task.moved", { version: 3 });

    expect(reads("/api/v1/tasks/OPA-1/activity?limit=50")).toBe(before);
  });
});

describe("TaskDetail: the timeline (WS-119)", () => {
  it("shows comments and changes in order, each change as a sentence with its time", async () => {
    on(
      ACTIVITY,
      activity([
        change(0, {
          type: "created",
          newValue: { key: "OPA-1", column: { id: todo.id, name: "To do" } },
        }),
        comment(1, "First *comment*"),
        change(30, { field: "priority", oldValue: "low", newValue: "high" }),
      ]),
    );
    await renderTask();
    const section = comments();

    const lines = within(section).getAllByRole("listitem");
    expect(lines.map((line) => line.textContent)).toEqual([
      expect.stringMatching(/^Ada Lovelace created the task in To do/),
      expect.stringContaining("First comment"),
      expect.stringMatching(/^Ada Lovelace changed the priority from Low to High/),
    ]);
    const time = lines[2]?.querySelector("time");
    expect(time).toHaveAttribute("datetime", "2026-11-14T10:30:00.000Z");
    expect(time).toHaveAttribute("title", new Date("2026-11-14T10:30:00.000Z").toLocaleString());
  });

  it("hides the changes with Comments only, and shows them again", async () => {
    on(
      ACTIVITY,
      activity([
        comment(1, "First *comment*"),
        change(30, { field: "title", oldValue: "A", newValue: "B" }),
      ]),
    );
    const user = await renderTask();
    const section = comments();
    const only = within(section).getByRole("switch", { name: "Comments only" });

    expect(only).not.toBeChecked();
    await user.click(only);
    expect(only).toBeChecked();
    expect(within(section).queryByText(/changed the title/)).not.toBeInTheDocument();
    expect(within(section).getByText("comment", { selector: "em" })).toBeInTheDocument();
    await user.click(only);
    expect(within(section).getByText(/changed the title/)).toBeVisible();
  });

  it("says there are no comments yet when Comments only hides everything", async () => {
    on(ACTIVITY, activity([change(30, { field: "title", oldValue: "A", newValue: "B" })]));
    const user = await renderTask();
    const section = comments();

    await user.click(within(section).getByRole("switch", { name: "Comments only" }));

    expect(within(section).getByText("No comments yet.")).toBeVisible();
  });
});

describe("TaskDetail: bugs (WS-091)", () => {
  const AT = "2026-11-20T10:00:00.000Z";
  const REPORTS = "GET /api/v1/tasks/OPA-1/bug-reports";
  const bug: Task = {
    ...base,
    type: "bug",
    severity: "high",
    fingerprint: "fp-login",
    occurrences: 3,
    lastReportedAt: AT,
  };

  function reports() {
    return screen.getByRole("region", { name: "Reports" });
  }

  function send(type: ProjectEvent["type"], version: number) {
    act(() => {
      FakeSource.latest().send(type, {
        id: crypto.randomUUID(),
        type,
        projectId: opa.id,
        entity: "task",
        entityId: base.id,
        version,
        actorAccountId: ada.id,
        at: AT,
      });
    });
  }

  beforeEach(() => {
    on(REPORTS, page([bugReport(3, base.id), bugReport(2, base.id), bugReport(1, base.id)]));
  });

  it("shows a bug's severity read-only", async () => {
    await renderTask({ current: bug, canWriteTasks: false });
    expect(within(details()).getByText("Severity").nextElementSibling).toHaveTextContent("High");
    expect(within(details()).queryByLabelText("Severity")).toBeNull();
  });

  it("says None for a bug without severity", async () => {
    await renderTask({ current: { ...bug, severity: null }, canWriteTasks: false });
    expect(within(details()).getByText("Severity").nextElementSibling).toHaveTextContent("None");
  });

  it("shows no severity for a task that is not a bug", async () => {
    await renderTask({ canWriteTasks: false });
    expect(within(details()).queryByText("Severity")).toBeNull();
  });

  it("edits the severity of a bug, sending only it with the version", async () => {
    on("PATCH /api/v1/tasks/OPA-1", json({ ...bug, severity: "critical", version: 4 }));
    const user = await renderTask({ current: bug });
    const select = within(details()).getByLabelText("Severity");
    expect(select).toHaveValue("high");
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["No severity", "Low", "Medium", "High", "Critical"]);

    await user.selectOptions(select, "Critical");
    await user.click(within(details()).getByRole("button", { name: "Save changes" }));

    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ severity: "critical", version: 3 });
    expect(status()).toHaveTextContent("Saved.");
  });

  it("clears the severity with null", async () => {
    on("PATCH /api/v1/tasks/OPA-1", json({ ...bug, severity: null, version: 4 }));
    const user = await renderTask({ current: bug });

    await user.selectOptions(within(details()).getByLabelText("Severity"), "No severity");
    await user.click(within(details()).getByRole("button", { name: "Save changes" }));

    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ severity: null, version: 3 });
  });

  it("shows the API's severity error under the select", async () => {
    on(
      "PATCH /api/v1/tasks/OPA-1",
      problem(400, "invalid_request", [
        { path: "severity", message: "Only a bug has a severity." },
      ]),
    );
    const user = await renderTask({ current: bug });

    await user.selectOptions(within(details()).getByLabelText("Severity"), "Low");
    await user.click(within(details()).getByRole("button", { name: "Save changes" }));

    expect(within(details()).getByLabelText("Severity")).toHaveAccessibleDescription(
      "Only a bug has a severity.",
    );
  });

  it("offers severity once the type becomes Bug, and saves both in one PATCH", async () => {
    on("PATCH /api/v1/tasks/OPA-1", json({ ...bug, severity: "medium", version: 4 }));
    const user = await renderTask();
    expect(within(details()).queryByLabelText("Severity")).toBeNull();

    await user.selectOptions(within(details()).getByLabelText("Type"), "Bug");
    expect(within(details()).getByLabelText("Severity")).toHaveValue("");
    await user.selectOptions(within(details()).getByLabelText("Severity"), "Medium");
    await user.click(within(details()).getByRole("button", { name: "Save changes" }));

    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({
      type: "bug",
      severity: "medium",
      version: 3,
    });
  });

  it("hides severity when a bug becomes a task, and sends no severity", async () => {
    on("PATCH /api/v1/tasks/OPA-1", json({ ...bug, type: "task", severity: null, version: 4 }));
    const user = await renderTask({ current: bug });

    await user.selectOptions(within(details()).getByLabelText("Severity"), "Low");
    await user.selectOptions(within(details()).getByLabelText("Type"), "Task");
    expect(within(details()).queryByLabelText("Severity")).toBeNull();
    await user.click(within(details()).getByRole("button", { name: "Save changes" }));

    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ type: "task", version: 3 });
  });

  it("says how often and when the task was reported", async () => {
    await renderTask({ current: bug, canWriteTasks: false });
    expect(
      screen.getByText(`Reported 3 times, last on ${new Date(AT).toLocaleString()}`),
    ).toBeVisible();
  });

  it("says once for a single report", async () => {
    await renderTask({ current: { ...bug, occurrences: 1 }, canWriteTasks: false });
    expect(screen.getByText(`Reported once, on ${new Date(AT).toLocaleString()}`)).toBeVisible();
  });

  it("shows no reports, and asks for none, for a task never reported", async () => {
    await renderTask({ current: { ...bug, occurrences: 0, lastReportedAt: null } });

    expect(screen.queryByText(/^Reported/)).toBeNull();
    expect(screen.queryByRole("region", { name: "Reports" })).toBeNull();
    expect(calls("GET").filter(([url]) => url.includes("/bug-reports"))).toEqual([]);
  });

  it("links to the task it is a regression of and the ones that regressed it", async () => {
    await renderTask({
      current: {
        ...bug,
        links: [
          {
            type: "regression_of",
            direction: "outgoing",
            task: { id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000007", key: "OPA-7", title: "Old login" },
          },
          {
            type: "regression_of",
            direction: "incoming",
            task: { id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000009", key: "OPA-9", title: "New login" },
          },
        ],
      },
      canWriteTasks: false,
    });

    const links = screen.getByRole("region", { name: "Links" });
    expect(within(links).getByText("Regression of")).toBeVisible();
    expect(within(links).getByText("Regressed by")).toBeVisible();
    expect(within(links).getByRole("link", { name: "OPA-7 Old login" })).toHaveAttribute(
      "href",
      "/projects/OPA/tasks/OPA-7",
    );
    expect(within(links).getByRole("link", { name: "OPA-9 New login" })).toHaveAttribute(
      "href",
      "/projects/OPA/tasks/OPA-9",
    );
  });

  it("shows no Links section without links", async () => {
    await renderTask({ current: bug });
    expect(screen.queryByRole("region", { name: "Links" })).toBeNull();
  });

  it("lists the reports, newest first, with the agent and every field", async () => {
    on(
      REPORTS,
      page([
        bugReport(2, base.id, {
          outcome: "deduplicated",
          originLayer: "api",
          confidence: 0.8,
          severity: "critical",
          runId: "run-42",
          createdAt: AT,
        }),
        bugReport(1, base.id, {
          outcome: "created",
          confidence: null,
          runId: null,
          title: "The first report",
        }),
      ]),
    );
    await renderTask({ current: bug, canWriteTasks: false });

    expect(
      calls("GET")
        .map(([url]) => url)
        .filter((url) => url.includes("/bug-reports")),
    ).toEqual(["/api/v1/tasks/OPA-1/bug-reports"]);
    const [newest, oldest] = within(reports()).getAllByRole("article");
    if (newest === undefined || oldest === undefined) throw new Error("two reports expected");
    const first = within(newest);
    expect(newest).toHaveTextContent(/^QA Bot\s*Agent/);
    expect(newest).toHaveTextContent(new Date(AT).toLocaleString());
    expect(newest).toHaveTextContent("Repeat");
    for (const [term, value] of [
      ["Layer", "API"],
      ["Confidence", "80%"],
      ["Severity", "Critical"],
      ["Run", "run-42"],
      ["Fingerprint", "fp-login"],
    ] as const) {
      expect(first.getByText(term).nextElementSibling).toHaveTextContent(value);
    }
    const second = within(oldest);
    expect(oldest).toHaveTextContent("New bug");
    expect(oldest).toHaveTextContent("The first report");
    expect(second.getByText("Confidence").nextElementSibling).toHaveTextContent("Not given");
    expect(second.getByText("Run").nextElementSibling).toHaveTextContent("None");
  });

  it("shows the evidence as plain text, collapsed until opened", async () => {
    on(
      REPORTS,
      page([
        bugReport(1, base.id, {
          summary: "A **bold** <b>claim</b>",
          evidence: {
            stepsToReproduce: ["Open the login", "Press [Sign in](http://evil.example)"],
            expected: "Signed in",
            actual: "A 500",
            url: "https://app.example/login",
            http: { method: "POST", path: "/api/login", status: 500, responseSnippet: "{}" },
            consoleErrors: ["TypeError: x is undefined"],
            diagnosis: "The API fails",
          },
        }),
      ]),
    );
    const user = await renderTask({ current: bug, canWriteTasks: false });

    const evidence = within(reports()).getByText("Evidence");
    expect(evidence.closest("details")).not.toHaveAttribute("open");
    await user.click(evidence);
    expect(evidence.closest("details")).toHaveAttribute("open");

    const report = within(within(reports()).getByRole("article"));
    expect(report.getByText("A **bold** <b>claim</b>")).toBeInTheDocument();
    expect(within(reports()).queryByRole("link")).toBeNull();
    expect(within(reports()).queryByText("bold", { selector: "strong" })).toBeNull();
    const steps = report.getByRole("list");
    expect(
      within(steps)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Open the login", "Press [Sign in](http://evil.example)"]);
    for (const text of [
      "Signed in",
      "A 500",
      "https://app.example/login",
      "POST /api/login → 500",
      "{}",
      "TypeError: x is undefined",
      "The API fails",
    ]) {
      expect(report.getByText(text)).toBeInTheDocument();
    }
  });

  it("loads more reports, each once", async () => {
    on(REPORTS, page([bugReport(3, base.id), bugReport(2, base.id)], "r1"));
    on(`${REPORTS}?cursor=r1`, page([bugReport(2, base.id), bugReport(1, base.id)]));
    const user = await renderTask({ current: bug, canWriteTasks: false });

    await user.click(within(reports()).getByRole("button", { name: "Load more" }));

    await waitFor(() => {
      expect(within(reports()).getAllByRole("article")).toHaveLength(3);
    });
    expect(within(reports()).queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("says when more reports cannot be loaded", async () => {
    on(REPORTS, page([bugReport(3, base.id)], "r1"));
    on(`${REPORTS}?cursor=r1`, problem(500, "internal_error"));
    const user = await renderTask({ current: bug, canWriteTasks: false });

    await user.click(within(reports()).getByRole("button", { name: "Load more" }));

    expect(await within(reports()).findByRole("alert")).toHaveTextContent(
      "Could not load more reports.",
    );
  });

  it("shows a new report and count when the task is reported again", async () => {
    await renderTask({ current: bug });
    act(() => {
      FakeSource.latest().open();
    });
    const later = "2026-11-20T11:00:00.000Z";
    on(TASK, json({ ...bug, occurrences: 4, lastReportedAt: later, version: 4 }));
    on(
      REPORTS,
      page([
        bugReport(4, base.id, { title: "The newest" }),
        bugReport(3, base.id),
        bugReport(2, base.id),
        bugReport(1, base.id),
      ]),
    );

    send("task.updated", 4);

    expect(
      await screen.findByText(`Reported 4 times, last on ${new Date(later).toLocaleString()}`),
    ).toBeVisible();
    expect(await within(reports()).findByText("The newest")).toBeVisible();
    expect(within(reports()).getAllByRole("article")).toHaveLength(4);
  });

  it("reads the reports again after a reconnect", async () => {
    await renderTask({ current: bug });
    act(() => {
      FakeSource.latest().open();
    });
    on(REPORTS, page([bugReport(4, base.id, { title: "Missed" }), bugReport(3, base.id)]));

    act(() => {
      FakeSource.latest().drop();
      FakeSource.latest().open();
    });

    expect(await within(reports()).findByText("Missed")).toBeVisible();
  });
});

describe("TaskDetail: labels (WS-108)", () => {
  const labelled: Task = { ...base, labels: [ref(bugLabel), ref(uiLabel)] };

  function picker() {
    return within(details()).getByRole("group", { name: "Labels" });
  }

  it("lists the labels in the read view, or None", async () => {
    await renderTask({ current: labelled, canWriteTasks: false });
    expect(within(details()).getByText("Labels").nextElementSibling).toHaveTextContent("BugUI");
  });

  it("says None for a task without labels", async () => {
    await renderTask({ canWriteTasks: false });
    expect(within(details()).getByText("Labels").nextElementSibling).toHaveTextContent("None");
  });

  it("applies and removes labels, sending labelIds once with the other changes", async () => {
    on("PATCH /api/v1/tasks/OPA-1", json({ ...labelled, version: 4 }));
    const user = await renderTask({ current: labelled });

    await user.click(within(picker()).getByRole("button", { name: "Remove label UI" }));
    await user.click(within(picker()).getByRole("button", { name: "Choose labels" }));
    await user.click(within(picker()).getByRole("checkbox", { name: "Docs" }));
    await user.click(within(details()).getByRole("button", { name: "Save changes" }));

    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({
      labelIds: [bugLabel.id, docsLabel.id],
      version: 3,
    });
  });

  it("sends no labelIds when only another field changed, or the same set came back", async () => {
    on("PATCH /api/v1/tasks/OPA-1", json({ ...labelled, title: "New", version: 4 }));
    const user = await renderTask({ current: labelled });

    await user.click(within(picker()).getByRole("button", { name: "Choose labels" }));
    await user.click(within(picker()).getByRole("checkbox", { name: "UI" }));
    await user.click(within(picker()).getByRole("checkbox", { name: "UI" }));
    await user.clear(within(details()).getByLabelText("Title"));
    await user.type(within(details()).getByLabelText("Title"), "New");
    await user.click(within(details()).getByRole("button", { name: "Save changes" }));

    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ title: "New", version: 3 });
  });

  it("creates a label from the picker with labels:write, and selects it", async () => {
    const ops = label("bbbb0000-0000-4000-8000-000000000004", "Ops", "gray");
    on("POST /api/v1/projects/OPA/labels", json(ops, 201));
    const user = await renderTask();

    await user.click(within(picker()).getByRole("button", { name: "Choose labels" }));
    await user.type(within(picker()).getByLabelText("Find or create a label"), "Ops");
    expect(within(picker()).queryByRole("checkbox", { name: "Bug" })).not.toBeInTheDocument();
    await user.click(within(picker()).getByRole("button", { name: 'Create label "Ops"' }));

    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({ name: "Ops", colour: "gray" });
    expect(await within(picker()).findByRole("checkbox", { name: "Ops" })).toBeChecked();
    expect(within(picker()).getByRole("button", { name: "Remove label Ops" })).toBeVisible();
  });

  it("selects the existing label when someone else made it meanwhile", async () => {
    const ops = label("bbbb0000-0000-4000-8000-000000000004", "Ops", "gray");
    on("POST /api/v1/projects/OPA/labels", problem(409, "label_name_taken"));
    const user = await renderTask();

    await user.click(within(picker()).getByRole("button", { name: "Choose labels" }));
    await user.type(within(picker()).getByLabelText("Find or create a label"), "ops");
    on(LABELS, page([bugLabel, docsLabel, ops, uiLabel]));
    await user.click(within(picker()).getByRole("button", { name: 'Create label "ops"' }));

    expect(await within(picker()).findByRole("button", { name: "Remove label Ops" })).toBeVisible();
  });

  it("offers no creation without labels:write, nor for a name that exists", async () => {
    const user = await renderTask({ canWriteLabels: false });

    await user.click(within(picker()).getByRole("button", { name: "Choose labels" }));
    await user.type(within(picker()).getByLabelText("Find a label"), "Ops");
    expect(
      within(picker()).queryByRole("button", { name: /Create label/ }),
    ).not.toBeInTheDocument();
  });

  it("offers no creation for a name that exists, ignoring case", async () => {
    const user = await renderTask();

    await user.click(within(picker()).getByRole("button", { name: "Choose labels" }));
    await user.type(within(picker()).getByLabelText("Find or create a label"), "bug");
    expect(within(picker()).getByRole("checkbox", { name: "Bug" })).toBeVisible();
    expect(
      within(picker()).queryByRole("button", { name: /Create label/ }),
    ).not.toBeInTheDocument();
  });

  it("has no picker for a Viewer", async () => {
    await renderTask({ current: labelled, canWriteTasks: false, canWriteLabels: false });

    expect(within(details()).queryByRole("group", { name: "Labels" })).not.toBeInTheDocument();
    expect(calls("GET").filter(([url]) => url === "/api/v1/projects/OPA/labels")).toHaveLength(0);
  });

  it("reads the labels and the task again on label.changed", async () => {
    await renderTask({ current: labelled });
    act(() => {
      FakeSource.latest().open();
    });
    const renamed = { ...bugLabel, name: "Defect", version: 2 };
    on(LABELS, page([renamed, docsLabel, uiLabel]));
    on(TASK, json({ ...labelled, labels: [ref(renamed), ref(uiLabel)] }));

    act(() => {
      FakeSource.latest().send("label.changed", {
        id: crypto.randomUUID(),
        type: "label.changed",
        projectId: opa.id,
        entity: "label",
        entityId: bugLabel.id,
        version: 2,
        actorAccountId: ada.id,
        at: "2026-11-18T10:00:00.000Z",
      });
    });

    expect(
      await within(picker()).findByRole("button", { name: "Remove label Defect" }),
    ).toBeVisible();
  });
});

// Priority and due date in the task detail (WS-110 section 4, tests 8 and 9), with the
// viewer's date fixed.

describe("TaskDetail: priority and due date (WS-110)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 23, 12, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function value(term: string) {
    return within(details()).getByText(term).nextElementSibling;
  }

  it("reads None for both when the task has neither", async () => {
    await renderTask({ canWriteTasks: false });

    expect(value("Priority")).toHaveTextContent("None");
    expect(value("Due date")).toHaveTextContent("None");
  });

  it("reads the priority's word and an overdue date outside a done column", async () => {
    await renderTask({
      current: { ...base, priority: "high", dueDate: "2026-11-20" },
      canWriteTasks: false,
    });

    expect(value("Priority")).toHaveTextContent("High");
    expect(within(details()).getByRole("img", { name: "Priority: High" })).toBeInTheDocument();
    expect(value("Due date")).toHaveTextContent("Overdue, due Nov 20, 2026");
  });

  it("does not mark a past date overdue in a done column, but does in the backlog", async () => {
    await renderTask({
      current: { ...base, columnId: done.id, dueDate: "2026-11-20" },
      canWriteTasks: false,
    });
    expect(value("Due date")).toHaveTextContent("Due Nov 20, 2026");
    expect(value("Due date")).not.toHaveTextContent("Overdue");
  });

  it("marks a past date overdue on a backlog task", async () => {
    await renderTask({
      current: { ...base, columnId: null, dueDate: "2026-11-20" },
      canWriteTasks: false,
    });
    expect(value("Due date")).toHaveTextContent("Overdue, due Nov 20, 2026");
  });

  it("sends only a changed priority", async () => {
    on("PATCH /api/v1/tasks/OPA-1", json({ ...base, priority: "high", version: 4 }));
    const user = await renderTask();

    await user.selectOptions(within(details()).getByLabelText("Priority"), "High");
    await user.click(within(details()).getByRole("button", { name: "Save changes" }));

    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ priority: "high", version: 3 });
  });

  it("offers the five priorities in order", async () => {
    await renderTask();

    const options = within(within(details()).getByLabelText("Priority")).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "None",
      "Low",
      "Medium",
      "High",
      "Urgent",
    ]);
  });

  it("sends only a changed due date", async () => {
    on("PATCH /api/v1/tasks/OPA-1", json({ ...base, dueDate: "2026-12-01", version: 4 }));
    const user = await renderTask();

    fireEvent.change(within(details()).getByLabelText("Due date"), {
      target: { value: "2026-12-01" },
    });
    await user.click(within(details()).getByRole("button", { name: "Save changes" }));

    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ dueDate: "2026-12-01", version: 3 });
  });

  it("clears the due date with Clear, focuses the input, and sends null", async () => {
    on("PATCH /api/v1/tasks/OPA-1", json({ ...base, dueDate: null, version: 4 }));
    const user = await renderTask({ current: { ...base, dueDate: "2026-12-01" } });
    const input = within(details()).getByLabelText("Due date");
    expect(input).toHaveValue("2026-12-01");

    await user.click(within(details()).getByRole("button", { name: "Clear due date" }));

    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    expect(
      within(details()).queryByRole("button", { name: "Clear due date" }),
    ).not.toBeInTheDocument();
    await user.click(within(details()).getByRole("button", { name: "Save changes" }));
    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ dueDate: null, version: 3 });
  });

  it("offers no Clear without a date", async () => {
    await renderTask();

    expect(
      within(details()).queryByRole("button", { name: "Clear due date" }),
    ).not.toBeInTheDocument();
  });

  it("sends neither when only the title changed", async () => {
    on("PATCH /api/v1/tasks/OPA-1", json({ ...base, title: "Renamed", version: 4 }));
    const user = await renderTask({
      current: { ...base, priority: "low", dueDate: "2026-12-01" },
    });

    await user.clear(within(details()).getByLabelText("Title"));
    await user.type(within(details()).getByLabelText("Title"), "Renamed");
    await user.click(within(details()).getByRole("button", { name: "Save changes" }));

    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ title: "Renamed", version: 3 });
  });

  it("shows a due date error from the API at the field", async () => {
    on(
      "PATCH /api/v1/tasks/OPA-1",
      problem(400, "invalid_request", [{ path: "dueDate", message: "Not a calendar date." }]),
    );
    const user = await renderTask();

    fireEvent.change(within(details()).getByLabelText("Due date"), {
      target: { value: "2026-12-01" },
    });
    await user.click(within(details()).getByRole("button", { name: "Save changes" }));

    expect(within(details()).getByLabelText("Due date")).toHaveAccessibleDescription(
      "Not a calendar date.",
    );
  });

  it("keeps an unsaved priority when the task changes underneath", async () => {
    on("POST /api/v1/tasks/OPA-1/move", json({ ...base, columnId: done.id, version: 4 }));
    on("PATCH /api/v1/tasks/OPA-1", json({ ...base, priority: "urgent", version: 5 }));
    const user = await renderTask();

    await user.selectOptions(within(details()).getByLabelText("Priority"), "Urgent");
    await user.selectOptions(within(details()).getByLabelText("Column"), "Done");
    await screen.findByText("Moved to Done.");

    expect(within(details()).getByLabelText("Priority")).toHaveValue("urgent");
    await user.click(within(details()).getByRole("button", { name: "Save changes" }));
    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ priority: "urgent", version: 4 });
  });
});
