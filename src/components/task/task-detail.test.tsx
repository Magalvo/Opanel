import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  column,
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
import { bodyOf, calls, fetchMock, hold, installFetch, on, problem } from "@/components/fake-api";
import { FakeSource } from "@/hooks/fake-event-source";
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

const TASK = "GET /api/v1/tasks/OPA-1";
const COLUMNS = "GET /api/v1/projects/OPA/columns";
const COMMENTS = "GET /api/v1/tasks/OPA-1/comments?limit=50";
const TEAMS = "GET /api/v1/teams?limit=50";
const EPICS = "GET /api/v1/projects/OPA/epics?limit=100";

interface Options {
  project?: Project;
  current?: Task;
  canWriteTasks?: boolean;
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
        canComment={canComment}
        canDeleteAny={canDeleteAny}
        canDeleteOwn={canDeleteOwn}
        accountId={accountId}
      />
    </ProjectFrame>,
  );
  await screen.findByRole("heading", { level: 2, name: current.title });
  await screen.findByRole("region", { name: "Comments" });
  return user;
}

function status() {
  return screen.getByRole("status", { name: "Task messages" });
}

function details() {
  return screen.getByRole("region", { name: "Details" });
}

function comments() {
  return screen.getByRole("region", { name: "Comments" });
}

beforeEach(() => {
  installFetch();
  router.back.mockReset();
  router.push.mockReset();
  on(COLUMNS, page([todo, doing, done]));
  on(COMMENTS, page([comment(1, "First *comment*"), comment(2, "Second")]));
  on(TEAMS, page([web, api]));
  on(EPICS, page([launch]));
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
    on(COMMENTS, page([comment(1, "First *comment*")], "c1"));
    on(`${COMMENTS}&cursor=c1`, page([comment(2, "Second")]));
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
    on(COMMENTS, page([comment(1, "First *comment*")], "c1"));
    on(`${COMMENTS}&cursor=c1`, page([comment(2, "Second"), comment(3, "Mine")]));
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
    on(COMMENTS, page([comment(1, "First *comment*")], "c1"));
    const release = hold(`${COMMENTS}&cursor=c1`);
    await renderTask();
    const more = within(comments()).getByRole("button", { name: "Load more" });

    fireEvent.click(more);
    fireEvent.click(more);

    await waitFor(() => {
      expect(more).toBeDisabled();
    });
    expect(calls("GET").filter(([url]) => url.includes("cursor=c1"))).toHaveLength(1);
    await act(() => release(page([comment(2, "Second")])));
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
      COMMENTS,
      page([
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

    expect(within(within(details()).getByLabelText("Column")).getAllByRole("option")).toHaveLength(
      4,
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
      COMMENTS,
      page([comment(1, "First *comment*"), comment(2, "Second"), comment(3, "Third, theirs")]),
    );
    const before = reads("/api/v1/tasks/OPA-1/comments?limit=50");

    send("comment.created", { entityId: comment(2, "").id, taskId: base.id });
    expect(reads("/api/v1/tasks/OPA-1/comments?limit=50")).toBe(before);

    send("comment.created", { entityId: comment(3, "").id, taskId: base.id });

    expect(await within(comments()).findByText("Third, theirs")).toBeVisible();
    expect(within(comments()).getAllByText("Second")).toHaveLength(1);
  });

  it("leaves a new comment to Load more when not every page is loaded", async () => {
    on(COMMENTS, page([comment(1, "First *comment*")], "NEXT"));
    await renderLive();
    const before = reads("/api/v1/tasks/OPA-1/comments?limit=50");

    send("comment.created", { entityId: comment(3, "").id, taskId: base.id });

    expect(reads("/api/v1/tasks/OPA-1/comments?limit=50")).toBe(before);
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
    on(COMMENTS, page([comment(1, "First *comment*"), comment(2, "Second"), comment(4, "Missed")]));

    act(() => {
      FakeSource.latest().drop();
      FakeSource.latest().open();
    });

    expect(await screen.findByRole("heading", { level: 2, name: "After the gap" })).toBeVisible();
    expect(await within(comments()).findByText("Missed")).toBeVisible();
  });
});
