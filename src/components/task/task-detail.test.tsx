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

  // An equal-version task.updated is read for the sub-tasks only (WS-135 test 8), so the
  // echo here is a move's.
  it("ignores the echo of a version it holds, and events of other tasks", async () => {
    await renderLive();
    const before = reads("/api/v1/tasks/OPA-1");

    send("task.moved", { version: 3 });
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

  it("lists no links in the bug section; regressions read in Links (WS-136 test 7)", async () => {
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
    expect(within(links).getByText("Has regression")).toBeVisible();
    expect(within(links).queryByText("Regressed by")).toBeNull();
    expect(within(links).getByRole("link", { name: "OPA-7 Old login" })).toHaveAttribute(
      "href",
      "/projects/OPA/tasks/OPA-7",
    );
    expect(within(links).getByRole("link", { name: "OPA-9 New login" })).toHaveAttribute(
      "href",
      "/projects/OPA/tasks/OPA-9",
    );
    expect(screen.getAllByRole("region", { name: "Links" })).toHaveLength(1);
    expect(within(reports()).queryByRole("link", { name: /OPA-7/ })).toBeNull();
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

describe("TaskDetail: story points (WS-139 test 10)", () => {
  function value(term: string) {
    return within(details()).getByText(term).nextElementSibling;
  }

  it("reads None without points and the number with some, after the due date", async () => {
    await renderTask({ canWriteTasks: false });
    expect(value("Story points")).toHaveTextContent("None");
    const terms = within(details())
      .getAllByRole("term")
      .map((term) => term.textContent);
    expect(terms.indexOf("Story points")).toBe(terms.indexOf("Due date") + 1);
  });

  it("reads a task's points", async () => {
    await renderTask({ current: { ...base, storyPoints: 2.5 }, canWriteTasks: false });

    expect(value("Story points")).toHaveTextContent("2.5");
  });

  it("gives a Viewer no editor", async () => {
    await renderTask({ current: { ...base, storyPoints: 3 }, canWriteTasks: false });

    expect(within(details()).queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("edits them with a number input of 0 to 999.5 in steps of 0.5, sending a number", async () => {
    on("PATCH /api/v1/tasks/OPA-1", json({ ...base, storyPoints: 5, version: 4 }));
    const user = await renderTask();
    const input = within(details()).getByRole("spinbutton", { name: "Story points" });
    expect(input).toHaveValue(null);
    expect(input).toHaveAttribute("min", "0");
    expect(input).toHaveAttribute("max", "999.5");
    expect(input).toHaveAttribute("step", "0.5");

    await user.type(input, "5");
    await user.click(within(details()).getByRole("button", { name: "Save changes" }));

    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ storyPoints: 5, version: 3 });
  });

  it("sends null when emptied, and nothing when only the title changed", async () => {
    on("PATCH /api/v1/tasks/OPA-1", json({ ...base, storyPoints: null, version: 4 }));
    const user = await renderTask({ current: { ...base, storyPoints: 3 } });
    const input = within(details()).getByRole("spinbutton", { name: "Story points" });
    expect(input).toHaveValue(3);

    await user.clear(input);
    await user.click(within(details()).getByRole("button", { name: "Save changes" }));

    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ storyPoints: null, version: 3 });
  });

  it("leaves them out of a save of another field", async () => {
    on("PATCH /api/v1/tasks/OPA-1", json({ ...base, title: "Renamed", version: 4 }));
    const user = await renderTask({ current: { ...base, storyPoints: 3 } });

    await user.clear(within(details()).getByLabelText("Title"));
    await user.type(within(details()).getByLabelText("Title"), "Renamed");
    await user.click(within(details()).getByRole("button", { name: "Save changes" }));

    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ title: "Renamed", version: 3 });
  });

  it("shows a story points error from the API at the field", async () => {
    on(
      "PATCH /api/v1/tasks/OPA-1",
      problem(400, "invalid_request", [
        { path: "storyPoints", message: "Too big: expected number to be <=999.5" },
      ]),
    );
    const user = await renderTask();

    fireEvent.change(within(details()).getByLabelText("Story points"), {
      target: { value: "1000" },
    });
    await user.click(within(details()).getByRole("button", { name: "Save changes" }));

    expect(within(details()).getByLabelText("Story points")).toHaveAccessibleDescription(
      "Too big: expected number to be <=999.5",
    );
  });
});

// Sub-tasks on the task page (WS-135 tests 1 to 5, 8 and 9).

describe("TaskDetail: sub-tasks (WS-135)", () => {
  const parentRef = { id: base.id, key: "OPA-1", title: "Write the board" };
  const s2 = task(2, doing.id, { title: "Draw the columns", assignee: ada, parent: parentRef });
  const s3 = task(3, "", { columnId: null, title: "Pick the colours", parent: parentRef });
  const withSubtasks: Task = {
    ...base,
    subtasks: { done: 0, total: 2 },
    subtaskList: [s2, s3],
  };
  const release = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000009",
    key: "OPA-9",
    title: "Release 2.0",
  };
  const asSubtask: Task = { ...base, parent: release, epic: { id: launch.id, title: "Launch" } };
  const SEARCH = "GET /api/v1/tasks?limit=20&sort=-updated&projectId=OPA&parentId=none&q=rel";
  const releaseItem = {
    ...task(9, todo.id, { title: "Release 2.0" }),
    id: release.id,
    project: { id: opa.id, key: "OPA", name: opa.name },
    column: { id: todo.id, name: "To do", category: "todo" },
  };

  function subtasks() {
    return screen.getByRole("region", { name: "Sub-tasks" });
  }

  function rowOf(key: string): HTMLElement {
    const link = within(subtasks()).getByRole("link", { name: key });
    const row = link.closest("li");
    if (row === null) throw new Error(`no row for ${key}`);
    return row;
  }

  function sendUpdated(entityId: string, version: number) {
    act(() => {
      FakeSource.latest().send("task.updated", {
        id: crypto.randomUUID(),
        type: "task.updated",
        projectId: opa.id,
        entity: "task",
        entityId,
        version,
        actorAccountId: ada.id,
        at: "2026-11-26T10:00:00.000Z",
      });
    });
  }

  it("lists the sub-tasks with status and assignee, and how many are done (test 1)", async () => {
    await renderTask({ current: withSubtasks });

    expect(within(subtasks()).getByText("0 of 2 done")).toBeInTheDocument();
    expect(rowOf("OPA-2")).toHaveTextContent("Draw the columns");
    expect(rowOf("OPA-2")).toHaveTextContent("In progress");
    expect(rowOf("OPA-2")).toHaveTextContent("Ada Lovelace");
    expect(rowOf("OPA-3")).toHaveTextContent("Backlog");
    expect(within(subtasks()).getByRole("link", { name: "OPA-2" })).toHaveAttribute(
      "href",
      "/projects/OPA/tasks/OPA-2",
    );
    expect(within(subtasks()).getByRole("button", { name: "Add sub-task" })).toBeEnabled();
  });

  it("leaves the section out of a sub-task (test 1)", async () => {
    await renderTask({ current: asSubtask });

    expect(screen.queryByRole("region", { name: "Sub-tasks" })).not.toBeInTheDocument();
  });

  it("shows a Viewer the sub-tasks without Add sub-task (test 1)", async () => {
    await renderTask({ current: withSubtasks, canWriteTasks: false });

    expect(within(subtasks()).getByText("0 of 2 done")).toBeInTheDocument();
    expect(within(subtasks()).queryByRole("button", { name: "Add sub-task" })).toBeNull();
  });

  it("leaves the section out for a Viewer on a task with none (test 1)", async () => {
    await renderTask({ canWriteTasks: false });

    expect(screen.queryByRole("region", { name: "Sub-tasks" })).not.toBeInTheDocument();
  });

  it("adds a sub-task in the first column with the parent set, and lists it (test 2)", async () => {
    const summary = task(4, todo.id, { title: "Write the tests", parent: parentRef });
    on("POST /api/v1/projects/OPA/tasks", json(full(summary), 201));
    const user = await renderTask();

    await user.click(within(subtasks()).getByRole("button", { name: "Add sub-task" }));
    const dialog = screen.getByRole("dialog", { name: "Add a sub-task to OPA-1" });
    await user.type(within(dialog).getByLabelText("Title"), "Write the tests");
    on(TASK, json({ ...base, subtasks: { done: 0, total: 1 }, subtaskList: [summary] }));
    await user.click(within(dialog).getByRole("button", { name: "Add task" }));

    await waitFor(() => {
      expect(within(subtasks()).getByRole("link", { name: "OPA-4" })).toBeInTheDocument();
    });
    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({
      title: "Write the tests",
      type: "task",
      columnId: todo.id,
      parentId: base.id,
    });
  });

  it("links a sub-task's parent, and removes it with the version (test 3)", async () => {
    on("PATCH /api/v1/tasks/OPA-1", json({ ...asSubtask, parent: null, version: 4 }));
    const user = await renderTask({ current: asSubtask });

    const parent = within(details()).getByRole("link", { name: /OPA-9/ });
    expect(parent).toHaveAttribute("href", "/projects/OPA/tasks/OPA-9");
    await user.click(within(details()).getByRole("button", { name: "Remove parent" }));

    await waitFor(() => {
      expect(status()).toHaveTextContent("Parent removed.");
    });
    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ parentId: null, version: 3 });
    expect(within(details()).getByRole("button", { name: "Set parent" })).toBeInTheDocument();
  });

  it("says a parent cannot be a sub-task (test 3)", async () => {
    await renderTask({ current: withSubtasks });

    expect(
      within(details()).getByText("Has sub-tasks; it cannot be a sub-task."),
    ).toBeInTheDocument();
    expect(within(details()).queryByRole("button", { name: "Set parent" })).toBeNull();
  });

  it("finds a parent among the project's tasks that are not sub-tasks, and sets it (test 4)", async () => {
    on(
      SEARCH,
      json({
        items: [
          { ...task(1, todo.id), project: releaseItem.project, column: releaseItem.column },
          releaseItem,
        ],
        nextCursor: null,
      }),
    );
    on("PATCH /api/v1/tasks/OPA-1", json({ ...base, parent: release, version: 4 }));
    const user = await renderTask();

    await user.click(within(details()).getByRole("button", { name: "Set parent" }));
    const dialog = screen.getByRole("dialog", { name: "Set a parent for OPA-1" });
    await user.type(within(dialog).getByLabelText("Find a task"), "rel");

    const choice = await within(dialog).findByRole("button", { name: "OPA-9 Release 2.0" });
    expect(within(dialog).queryByRole("button", { name: /^OPA-1 / })).toBeNull();
    await user.click(choice);

    await waitFor(() => {
      expect(status()).toHaveTextContent("Now a sub-task of OPA-9.");
    });
    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ parentId: release.id, version: 3 });
  });

  it("shows the API's refusal in the dialog (test 4)", async () => {
    on(SEARCH, json({ items: [releaseItem], nextCursor: null }));
    on(
      "PATCH /api/v1/tasks/OPA-1",
      problem(400, "invalid_request", [
        { path: "parentId", message: "A task with sub-tasks cannot become a sub-task." },
      ]),
    );
    const user = await renderTask();

    await user.click(within(details()).getByRole("button", { name: "Set parent" }));
    const dialog = screen.getByRole("dialog", { name: "Set a parent for OPA-1" });
    await user.type(within(dialog).getByLabelText("Find a task"), "rel");
    await user.click(await within(dialog).findByRole("button", { name: "OPA-9 Release 2.0" }));

    expect(
      await within(dialog).findByText("A task with sub-tasks cannot become a sub-task."),
    ).toBeVisible();
  });

  it("shows a sub-task's epic as its parent's, and never sends it (test 5)", async () => {
    on("PATCH /api/v1/tasks/OPA-1", json({ ...asSubtask, title: "Renamed", version: 4 }));
    const user = await renderTask({ current: asSubtask });

    expect(within(details()).getByLabelText("Epic")).toBeDisabled();
    expect(within(details()).getByText("Follows its parent.")).toBeInTheDocument();
    const title = within(details()).getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Renamed");
    await user.click(within(details()).getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(calls("PATCH")).toHaveLength(1);
    });
    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ title: "Renamed", version: 3 });
  });

  it("takes the sub-tasks from an equal-version event without touching the form (test 8)", async () => {
    const user = await renderTask({ current: withSubtasks });
    act(() => {
      FakeSource.latest().open();
    });
    const title = within(details()).getByLabelText("Title");
    await user.type(title, "!");
    const doneNow = { ...s2, columnId: done.id, version: 5 };
    on(
      TASK,
      json({ ...withSubtasks, subtasks: { done: 1, total: 2 }, subtaskList: [doneNow, s3] }),
    );

    sendUpdated(base.id, base.version);

    await waitFor(() => {
      expect(within(subtasks()).getByText("1 of 2 done")).toBeInTheDocument();
    });
    expect(rowOf("OPA-2")).toHaveTextContent("Done");
    expect(title).toHaveValue("Write the board!");
  });

  it("reads the task again when one of its sub-tasks changes (test 8)", async () => {
    await renderTask({ current: withSubtasks });
    act(() => {
      FakeSource.latest().open();
    });
    on(
      TASK,
      json({ ...withSubtasks, subtaskList: [{ ...s2, title: "Draw them all", version: 2 }, s3] }),
    );

    sendUpdated(s2.id, 2);

    await waitFor(() => {
      expect(rowOf("OPA-2")).toHaveTextContent("Draw them all");
    });
  });

  it("says to delete or detach the sub-tasks first (test 9)", async () => {
    on("DELETE /api/v1/tasks/OPA-1", problem(409, "has_subtasks"));
    const user = await renderTask({ current: withSubtasks });

    await user.click(screen.getByRole("button", { name: "Delete task" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }),
    );

    expect(await screen.findByText("Delete or detach its sub-tasks first.")).toBeInTheDocument();
  });
});

describe("TaskDetail: links (WS-136)", () => {
  const LINKS = "POST /api/v1/tasks/OPA-1/links";
  const SEARCH = "GET /api/v1/tasks?limit=20&sort=-updated&q=log";
  const api3 = { id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000003", key: "API-3", title: "Log in" };
  const opa7 = { id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000007", key: "OPA-7", title: "Old login" };
  const opa8 = { id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000008", key: "OPA-8", title: "Payments" };
  const blocksApi3 = { type: "blocks", direction: "outgoing", task: api3 } as const;
  const UNLINK = `DELETE /api/v1/tasks/OPA-1/links?type=blocks&direction=outgoing&taskId=${api3.id}`;
  const linked: Task = { ...base, links: [blocksApi3] };
  const apiProject = {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-00000000000a",
    key: "API",
    name: "Public API",
  };
  const api3Item = {
    ...task(3, todo.id, { title: "Log in" }),
    id: api3.id,
    key: "API-3",
    project: apiProject,
    column: { id: todo.id, name: "To do", category: "todo" },
  };
  const selfItem = {
    ...task(1, todo.id, { title: "Login board" }),
    project: { id: opa.id, key: "OPA", name: opa.name },
    column: { id: todo.id, name: "To do", category: "todo" },
  };

  function links() {
    return screen.getByRole("region", { name: "Links" });
  }

  async function addLink(
    user: ReturnType<typeof userEvent.setup>,
    reading: string,
  ): Promise<HTMLElement> {
    on(SEARCH, json({ items: [selfItem, api3Item], nextCursor: null }));
    await user.click(within(links()).getByRole("button", { name: "Add link" }));
    const dialog = screen.getByRole("dialog", { name: "Link OPA-1 to another task" });
    await user.selectOptions(within(dialog).getByLabelText("Link type"), reading);
    await user.type(within(dialog).getByLabelText("Find a task"), "log");
    const choice = await within(dialog).findByRole("button", { name: "API-3 Log in" });
    expect(within(dialog).queryByRole("button", { name: /^OPA-1 / })).toBeNull();
    await user.click(choice);
    return dialog;
  }

  function sendUpdated(version: number) {
    act(() => {
      FakeSource.latest().send("task.updated", {
        id: crypto.randomUUID(),
        type: "task.updated",
        projectId: opa.id,
        entity: "task",
        entityId: base.id,
        version,
        actorAccountId: ada.id,
        at: "2026-11-27T10:00:00.000Z",
      });
    });
  }

  it("groups the links under the seven readings, in order, each a link (test 1)", async () => {
    const task9 = { id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000009", key: "OPA-9", title: "Login" };
    const task10 = { id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000010", key: "OPA-10", title: "Docs" };
    const task11 = { id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000011", key: "OPA-11", title: "Crash" };
    await renderTask({
      current: {
        ...base,
        links: [
          { type: "relates_to", direction: "outgoing", task: task10 },
          { type: "regression_of", direction: "incoming", task: task11 },
          { type: "duplicates", direction: "incoming", task: task9 },
          { type: "blocks", direction: "incoming", task: opa8 },
          blocksApi3,
          { type: "duplicates", direction: "outgoing", task: opa7 },
          { type: "regression_of", direction: "outgoing", task: opa7 },
        ],
      },
    });

    const headings = within(links())
      .getAllByRole("term")
      .map((term) => term.textContent);
    expect(headings).toEqual([
      "Blocks",
      "Is blocked by",
      "Duplicates",
      "Is duplicated by",
      "Regression of",
      "Has regression",
      "Relates to",
    ]);
    expect(within(links()).getByRole("link", { name: "API-3 Log in" })).toHaveAttribute(
      "href",
      "/projects/API/tasks/API-3",
    );
    expect(within(links()).getByRole("button", { name: "Add link" })).toBeEnabled();
  });

  it("leaves out empty groups (test 1)", async () => {
    await renderTask({ current: linked });
    expect(
      within(links())
        .getAllByRole("term")
        .map((term) => term.textContent),
    ).toEqual(["Blocks"]);
  });

  it("says there are no links yet to someone who edits (test 1)", async () => {
    await renderTask();
    expect(within(links()).getByText("No links yet.")).toBeVisible();
  });

  it("shows a Viewer the links without Add link or Remove (test 1)", async () => {
    await renderTask({ current: linked, canWriteTasks: false });
    expect(within(links()).getByRole("link", { name: "API-3 Log in" })).toBeVisible();
    expect(within(links()).queryByRole("button")).toBeNull();
  });

  it("leaves the section out for a Viewer on a task with no links (test 1)", async () => {
    await renderTask({ canWriteTasks: false });
    expect(screen.queryByRole("region", { name: "Links" })).toBeNull();
  });

  it("searches every project, leaves the task out, and adds the chosen reading (test 2)", async () => {
    on(
      LINKS,
      json({
        ...base,
        links: [{ type: "blocks", direction: "incoming", task: api3 }],
        version: 4,
      }),
    );
    const user = await renderTask();

    const dialog = await addLink(user, "Is blocked by");

    await waitFor(() => {
      expect(status()).toHaveTextContent("Link added.");
    });
    expect(bodyOf(calls("POST").find(([url]) => url.endsWith("/links"))?.[1])).toEqual({
      type: "blocks",
      direction: "incoming",
      taskId: api3.id,
    });
    expect(dialog).not.toBeInTheDocument();
    expect(within(links()).getByText("Is blocked by")).toBeVisible();
    expect(within(links()).getByRole("link", { name: "API-3 Log in" })).toBeVisible();
  });

  it("sends relates_to as outgoing (test 2)", async () => {
    on(
      LINKS,
      json({
        ...base,
        links: [{ type: "relates_to", direction: "outgoing", task: api3 }],
        version: 4,
      }),
    );
    const user = await renderTask();

    await addLink(user, "Relates to");

    await waitFor(() => {
      expect(status()).toHaveTextContent("Link added.");
    });
    expect(bodyOf(calls("POST").find(([url]) => url.endsWith("/links"))?.[1])).toEqual({
      type: "relates_to",
      direction: "outgoing",
      taskId: api3.id,
    });
  });

  it.each([
    [problem(409, "link_exists"), "That link exists already."],
    [problem(409, "too_many_links"), "One of the tasks already has 100 links."],
    [problem(403, "forbidden"), "You cannot link to that task."],
    [
      problem(400, "invalid_request", [{ path: "taskId", message: "That task is deleted." }]),
      "That task is deleted.",
    ],
  ])("shows a refusal in the dialog and keeps it open (test 3)", async (answer, text) => {
    on(LINKS, answer);
    const user = await renderTask();

    const dialog = await addLink(user, "Blocks");

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(text);
    expect(dialog).toBeInTheDocument();
  });

  it("says the project is archived and closes the dialog (test 3)", async () => {
    on(LINKS, problem(409, "project_archived"));
    const user = await renderTask();

    const dialog = await addLink(user, "Blocks");

    await waitFor(() => {
      expect(status()).toHaveTextContent("The project is archived.");
    });
    expect(dialog).not.toBeInTheDocument();
  });

  it("removes a link, names it, reads the task, and moves the focus to Add link (test 4)", async () => {
    on(UNLINK, () => new Response(null, { status: 204 }));
    const user = await renderTask({ current: linked });
    on(TASK, json({ ...base, links: [], version: 4 }));

    await user.click(within(links()).getByRole("button", { name: "Remove link: blocks API-3" }));

    await waitFor(() => {
      expect(status()).toHaveTextContent("Link removed.");
    });
    expect(calls("DELETE").map(([url]) => url)).toEqual([UNLINK.slice("DELETE ".length)]);
    expect(within(links()).queryByRole("link", { name: "API-3 Log in" })).toBeNull();
    expect(within(links()).getByRole("button", { name: "Add link" })).toHaveFocus();
  });

  it("says someone else changed the task when the read is two versions on (test 5)", async () => {
    on(UNLINK, () => new Response(null, { status: 204 }));
    const user = await renderTask({ current: linked });
    on(TASK, json({ ...base, title: "Renamed elsewhere", links: [], version: 5 }));

    await user.click(within(links()).getByRole("button", { name: "Remove link: blocks API-3" }));

    await waitFor(() => {
      expect(status()).toHaveTextContent("Someone else changed this task.");
    });
    expect(screen.getByRole("heading", { level: 2, name: "Renamed elsewhere" })).toBeVisible();
  });

  it("says a link was already removed on a 404, and shows the task read (test 5)", async () => {
    on(UNLINK, problem(404, "not_found"));
    const user = await renderTask({ current: linked });
    on(TASK, json({ ...base, links: [], version: 4 }));

    await user.click(within(links()).getByRole("button", { name: "Remove link: blocks API-3" }));

    await waitFor(() => {
      expect(status()).toHaveTextContent("That link was already removed.");
    });
    expect(within(links()).queryByRole("link", { name: "API-3 Log in" })).toBeNull();
  });

  it("keeps unsaved edits when a link is added, and saves on the new version (test 6)", async () => {
    on(LINKS, json({ ...base, links: [blocksApi3], version: 4 }));
    on(
      "PATCH /api/v1/tasks/OPA-1",
      json({ ...base, title: "Write the board!", links: [blocksApi3], version: 5 }),
    );
    const user = await renderTask();
    const title = within(details()).getByLabelText("Title");
    await user.type(title, "!");

    await addLink(user, "Blocks");
    await waitFor(() => {
      expect(status()).toHaveTextContent("Link added.");
    });
    expect(title).toHaveValue("Write the board!");
    await user.click(within(details()).getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(calls("PATCH")).toHaveLength(1);
    });
    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ title: "Write the board!", version: 4 });
  });

  it("still saves on the old version after a change elsewhere, when a link is added (test 6)", async () => {
    const user = await renderTask();
    act(() => {
      FakeSource.latest().open();
    });
    const title = within(details()).getByLabelText("Title");
    await user.type(title, "!");
    on(TASK, json({ ...base, priority: "high", version: 4 }));
    sendUpdated(4);
    await waitFor(() => {
      expect(status()).toHaveTextContent("Saving will show their version first.");
    });
    on(LINKS, json({ ...base, priority: "high", links: [blocksApi3], version: 5 }));
    on("PATCH /api/v1/tasks/OPA-1", problem(409, "version_conflict"));

    await addLink(user, "Blocks");
    await waitFor(() => {
      expect(status()).toHaveTextContent("Link added.");
    });
    await user.click(within(details()).getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(calls("PATCH")).toHaveLength(1);
    });
    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ title: "Write the board!", version: 3 });
  });
});
