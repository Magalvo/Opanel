import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bodyOf, calls, installFetch, on, problem } from "@/components/fake-api";
import { FakeSource } from "@/hooks/fake-event-source";
import type { Column } from "@/lib/schemas/columns";
import type { ProjectEvent } from "@/lib/schemas/events";
import type { Project } from "@/lib/schemas/projects";
import type { TaskSummary } from "@/lib/schemas/tasks";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/projects/OPA/settings",
}));

const { ProjectFrame } = await import("./project-frame");
const { ProjectSettings } = await import("./project-settings");

const PROJECT_ID = "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f";

const opa: Project = {
  id: PROJECT_ID,
  key: "OPA",
  name: "Opanel",
  description: "The *tracker*.",
  archivedAt: null,
  version: 3,
  createdAt: "2026-11-12T10:00:00.000Z",
  updatedAt: "2026-11-12T10:00:00.000Z",
};

function column(id: string, name: string, category: Column["category"], version = 1): Column {
  return {
    id,
    projectId: PROJECT_ID,
    name,
    category,
    version,
    createdAt: "2026-11-12T10:00:00.000Z",
    updatedAt: "2026-11-12T10:00:00.000Z",
  };
}

const todo = column("11111111-1111-4111-8111-111111111111", "To do", "todo");
const doing = column("22222222-2222-4222-8222-222222222222", "In progress", "in_progress", 2);
const done = column("33333333-3333-4333-8333-333333333333", "Done", "done", 4);

const deleted: TaskSummary = {
  id: "44444444-4444-4444-8444-444444444444",
  key: "OPA-3",
  number: 3,
  projectId: PROJECT_ID,
  type: "task",
  title: "Old idea",
  columnId: todo.id,
  assigneeTeam: null,
  assignee: null,
  epic: null,
  reporter: { id: "55555555-5555-4555-8555-555555555555", name: "Ada", kind: "human" },
  version: 2,
  createdAt: "2026-11-12T10:00:00.000Z",
  updatedAt: "2026-11-13T10:00:00.000Z",
  deletedAt: "2026-11-13T10:00:00.000Z",
};

const PROJECT = "GET /api/v1/projects/OPA";
const COLUMNS = "GET /api/v1/projects/OPA/columns";
const DELETED = "GET /api/v1/projects/OPA/tasks?limit=50&deleted=true";

function json(body: unknown, status = 200) {
  return () => Response.json(body, { status });
}

function columns(items: Column[]) {
  return json({ items, nextCursor: null });
}

async function renderSettings({
  project = opa,
  canRestoreTasks = true,
  cols = [todo, doing, done],
  tasks = [deleted],
}: {
  project?: Project;
  canRestoreTasks?: boolean;
  cols?: Column[];
  tasks?: TaskSummary[];
} = {}) {
  on(PROJECT, json(project));
  on(COLUMNS, columns(cols));
  on(DELETED, json({ items: tasks, nextCursor: null }));
  const user = userEvent.setup();
  render(
    <ProjectFrame projectKey="OPA" canManageProjects>
      <ProjectSettings canRestoreTasks={canRestoreTasks} />
    </ProjectFrame>,
  );
  await screen.findByRole("heading", { level: 2, name: "Details" });
  await screen.findByRole("row", { name: /In progress/ });
  return user;
}

function section(name: string) {
  return screen.getByRole("region", { name });
}

function status() {
  return screen.getByRole("status");
}

beforeEach(() => {
  installFetch();
});

describe("ProjectSettings: details", () => {
  it("fills the form and saves name and description with the version", async () => {
    on("PATCH /api/v1/projects/OPA", json({ ...opa, name: "Opanel 2", version: 4 }));
    const user = await renderSettings();
    const details = section("Details");
    expect(within(details).getByLabelText("Name")).toHaveValue("Opanel");
    expect(within(details).getByLabelText("Description")).toHaveValue("The *tracker*.");

    await user.clear(within(details).getByLabelText("Name"));
    await user.type(within(details).getByLabelText("Name"), "Opanel 2");
    await user.click(within(details).getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Opanel 2" })).toBeVisible();
    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({
      name: "Opanel 2",
      description: "The *tracker*.",
      version: 3,
    });
    expect(status()).toHaveTextContent("Saved.");
  });

  it("refills the form from the current project on a version conflict and says why", async () => {
    const theirs = { ...opa, name: "Their name", description: "Theirs", version: 5 };
    on(
      "PATCH /api/v1/projects/OPA",
      json(
        {
          type: "about:blank",
          title: "Conflict",
          status: 409,
          code: "version_conflict",
          detail: "Changed.",
          requestId: "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f",
          current: theirs,
        },
        409,
      ),
    );
    const user = await renderSettings();
    const details = section("Details");

    await user.type(within(details).getByLabelText("Name"), " mine");
    await user.click(within(details).getByRole("button", { name: "Save" }));

    expect(await within(details).findByDisplayValue("Their name")).toBeVisible();
    expect(within(details).getByLabelText("Description")).toHaveValue("Theirs");
    expect(status()).toHaveTextContent(
      "Someone else changed this project. Their version is shown; make your change again.",
    );
  });

  it("checks the name in the browser before sending", async () => {
    const user = await renderSettings();
    const details = section("Details");

    await user.clear(within(details).getByLabelText("Name"));
    await user.click(within(details).getByRole("button", { name: "Save" }));

    expect(within(details).getByText("Enter a name.")).toBeInTheDocument();
    expect(calls("PATCH")).toHaveLength(0);
  });

  it("archives after confirming, then shows everything read-only but Unarchive", async () => {
    const archived = { ...opa, archivedAt: "2026-11-16T10:00:00.000Z", version: 4 };
    on("POST /api/v1/projects/OPA/archive", json(archived));
    const user = await renderSettings();

    await user.click(screen.getByRole("button", { name: "Archive project" }));
    const confirm = screen.getByRole("alertdialog", { name: "Archive OPA?" });
    expect(confirm).toHaveTextContent("Everything in it becomes read-only until it is unarchived.");
    await user.click(within(confirm).getByRole("button", { name: "Archive" }));

    expect(await screen.findByText("Archived")).toBeVisible();
    expect(status()).toHaveTextContent("OPA was archived.");
    expect(screen.getByText("This project is archived, so it is read-only.")).toBeVisible();
    expect(within(section("Details")).getByLabelText("Name")).toBeDisabled();
    expect(within(section("Details")).getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add column" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete Done" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Restore OPA-3" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Unarchive project" })).toBeEnabled();
  });

  it("unarchives without asking", async () => {
    const archived = { ...opa, archivedAt: "2026-11-16T10:00:00.000Z" };
    on("POST /api/v1/projects/OPA/unarchive", json({ ...opa, version: 5 }));
    const user = await renderSettings({ project: archived });

    await user.click(screen.getByRole("button", { name: "Unarchive project" }));

    await vi.waitFor(() => {
      expect(status()).toHaveTextContent("OPA was unarchived.");
    });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(within(section("Details")).getByLabelText("Name")).toBeEnabled();
  });
});

describe("ProjectSettings: columns", () => {
  it("lists the columns in board order with their category", async () => {
    await renderSettings();

    const rows = within(section("Columns")).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[0]?.textContent)).toEqual([
      "To do",
      "In progress",
      "Done",
    ]);
    expect(rows[1]?.querySelectorAll("td")[1]).toHaveTextContent("In progress");
    expect(screen.queryByRole("button", { name: "Move To do up" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move Done down" })).not.toBeInTheDocument();
  });

  it("adds a column at the end and reads the list again", async () => {
    const review = column("66666666-6666-4666-8666-666666666666", "Review", "in_progress");
    on("POST /api/v1/projects/OPA/columns", json(review, 201));
    const user = await renderSettings();

    await user.click(screen.getByRole("button", { name: "Add column" }));
    const dialog = screen.getByRole("dialog", { name: "Add a column" });
    await user.type(within(dialog).getByLabelText("Name"), "Review");
    await user.selectOptions(within(dialog).getByLabelText("Category"), "In progress");
    on(COLUMNS, columns([todo, doing, done, review]));
    await user.click(within(dialog).getByRole("button", { name: "Add column" }));

    expect(await screen.findByRole("row", { name: /Review/ })).toBeVisible();
    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({ name: "Review", category: "in_progress" });
    expect(status()).toHaveTextContent("Added Review.");
  });

  it("edits a column's name and category with its version", async () => {
    const renamed = { ...doing, name: "Doing", version: 3 };
    on(`PATCH /api/v1/columns/${doing.id}`, json(renamed));
    const user = await renderSettings();

    await user.click(screen.getByRole("button", { name: "Edit In progress" }));
    const dialog = screen.getByRole("dialog", { name: "Edit column" });
    expect(within(dialog).getByLabelText("Category")).toHaveValue("in_progress");
    await user.clear(within(dialog).getByLabelText("Name"));
    await user.type(within(dialog).getByLabelText("Name"), "Doing");
    on(COLUMNS, columns([todo, renamed, done]));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("row", { name: /Doing/ })).toBeVisible();
    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({
      name: "Doing",
      category: "in_progress",
      version: 2,
    });
  });

  it("moves a column up and down with the right anchor and version", async () => {
    on(`POST /api/v1/columns/${done.id}/move`, json({ ...done, version: 5 }));
    on(`POST /api/v1/columns/${todo.id}/move`, json({ ...todo, version: 2 }));
    on(`POST /api/v1/columns/${doing.id}/move`, json({ ...doing, version: 3 }));
    const user = await renderSettings();

    await user.click(screen.getByRole("button", { name: "Move Done up" }));
    await vi.waitFor(() => {
      expect(calls("POST")).toHaveLength(1);
    });
    await user.click(screen.getByRole("button", { name: "Move To do down" }));
    await vi.waitFor(() => {
      expect(calls("POST")).toHaveLength(2);
    });
    await user.click(screen.getByRole("button", { name: "Move In progress up" }));
    await vi.waitFor(() => {
      expect(calls("POST")).toHaveLength(3);
    });

    expect(calls("POST").map(([url, init]) => [url, bodyOf(init)])).toEqual([
      [`/api/v1/columns/${done.id}/move`, { afterColumnId: todo.id, version: 4 }],
      [`/api/v1/columns/${todo.id}/move`, { afterColumnId: doing.id, version: 1 }],
      [`/api/v1/columns/${doing.id}/move`, { afterColumnId: null, version: 2 }],
    ]);
  });

  it("deletes a column after confirming", async () => {
    on(`DELETE /api/v1/columns/${doing.id}`, () => new Response(null, { status: 204 }));
    const user = await renderSettings();

    await user.click(screen.getByRole("button", { name: "Delete In progress" }));
    const confirm = screen.getByRole("alertdialog", { name: "Delete In progress?" });
    on(COLUMNS, columns([todo, done]));
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    await vi.waitFor(() => {
      expect(screen.queryByRole("row", { name: /In progress/ })).not.toBeInTheDocument();
    });
    expect(status()).toHaveTextContent("Deleted In progress.");
  });

  it.each([
    ["last_done_column", "A project needs at least one Done column."],
    ["column_not_empty", "Move or delete its tasks first."],
    ["project_archived", "The project is archived."],
  ])("explains a refused delete (%s) and reads the list again", async (code, message) => {
    on(`DELETE /api/v1/columns/${done.id}`, problem(409, code));
    const user = await renderSettings();
    const before = calls("GET").filter(([url]) => url.endsWith("/columns")).length;

    await user.click(screen.getByRole("button", { name: "Delete Done" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }),
    );

    await vi.waitFor(() => {
      expect(status()).toHaveTextContent(message);
    });
    expect(calls("GET").filter(([url]) => url.endsWith("/columns")).length).toBe(before + 1);
    expect(screen.getByRole("row", { name: /Done/ })).toBeVisible();
  });

  it("explains a version conflict on a move and refreshes the list", async () => {
    on(`POST /api/v1/columns/${done.id}/move`, problem(409, "version_conflict"));
    const user = await renderSettings();

    await user.click(screen.getByRole("button", { name: "Move Done up" }));

    await vi.waitFor(() => {
      expect(status()).toHaveTextContent(
        "Someone else changed the columns. The list was refreshed.",
      );
    });
  });
});

describe("ProjectSettings: deleted tasks", () => {
  it("lists deleted tasks with key, title and time, and restores one", async () => {
    on(
      `POST /api/v1/tasks/${deleted.id}/restore`,
      json({ ...deleted, description: "", deletedAt: null }),
    );
    const user = await renderSettings();
    const tasks = section("Deleted tasks");
    const row = within(tasks).getByRole("row", { name: /OPA-3/ });
    expect(within(row).getByText("Old idea")).toBeVisible();
    expect(within(row).getByText(new Date(deleted.deletedAt ?? "").toLocaleString())).toBeVisible();

    await user.click(within(row).getByRole("button", { name: "Restore OPA-3" }));

    await vi.waitFor(() => {
      expect(within(tasks).queryByRole("row", { name: /OPA-3/ })).not.toBeInTheDocument();
    });
    expect(status()).toHaveTextContent("OPA-3 was restored to its column.");
  });

  it("says when nothing is deleted", async () => {
    await renderSettings({ tasks: [] });

    expect(await within(section("Deleted tasks")).findByText("No deleted tasks.")).toBeVisible();
  });

  it("is not shown without permission to restore", async () => {
    await renderSettings({ canRestoreTasks: false });

    expect(screen.queryByRole("region", { name: "Deleted tasks" })).not.toBeInTheDocument();
    expect(calls("GET").some(([url]) => url.includes("deleted=true"))).toBe(false);
  });
});

describe("ProjectSettings: live (WS-049 section 5)", () => {
  function send(type: ProjectEvent["type"], entity: string, entityId: string, version: number) {
    act(() => {
      FakeSource.latest().send(type, {
        id: crypto.randomUUID(),
        type,
        projectId: PROJECT_ID,
        entity,
        entityId,
        version,
        actorAccountId: "55555555-5555-4555-8555-555555555555",
        at: "2026-11-18T10:00:00.000Z",
      });
    });
  }

  async function renderLive() {
    const user = await renderSettings();
    act(() => {
      FakeSource.latest().open();
    });
    return user;
  }

  it("takes someone else's change to the details when nothing is unsaved", async () => {
    await renderLive();
    on(PROJECT, json({ ...opa, name: "Opanel, renamed", version: 4 }));

    send("project.changed", "project", PROJECT_ID, 4);

    await waitFor(() => {
      expect(within(section("Details")).getByLabelText("Name")).toHaveValue("Opanel, renamed");
    });
  });

  it("keeps unsaved details, says so, and saves on the old version", async () => {
    on("PATCH /api/v1/projects/OPA", problem(409, "version_conflict"));
    const user = await renderLive();
    await user.type(within(section("Details")).getByLabelText("Description"), " Mine.");
    on(PROJECT, json({ ...opa, name: "Opanel, renamed", version: 4 }));

    send("project.changed", "project", PROJECT_ID, 4);

    await waitFor(() => {
      expect(status()).toHaveTextContent(
        "Someone else changed this project. Saving will show their version first.",
      );
    });
    expect(within(section("Details")).getByLabelText("Description")).toHaveValue(
      "The *tracker*. Mine.",
    );
    await user.click(within(section("Details")).getByRole("button", { name: "Save" }));
    expect(bodyOf(calls("PATCH")[0]?.[1])).toMatchObject({ version: 3 });
  });

  it("reads the columns again when one changes", async () => {
    await renderLive();
    on(COLUMNS, columns([todo, { ...doing, name: "Doing", version: 3 }, done]));

    send("column.changed", "column", doing.id, 3);

    expect(await screen.findByRole("row", { name: /Doing/ })).toBeInTheDocument();
  });

  it("reads the deleted tasks again when a task is deleted or restored", async () => {
    await renderLive();
    on(DELETED, json({ items: [], nextCursor: null }));

    send("task.restored", "task", deleted.id, 3);

    await waitFor(() => {
      expect(screen.queryByText("Old idea")).not.toBeInTheDocument();
    });
  });

  it("reads everything again after a reconnect", async () => {
    await renderLive();
    on(
      COLUMNS,
      columns([
        todo,
        doing,
        done,
        column("66666666-6666-4666-8666-666666666666", "Review", "in_progress"),
      ]),
    );

    act(() => {
      FakeSource.latest().drop();
      FakeSource.latest().open();
    });

    expect(await screen.findByRole("row", { name: /Review/ })).toBeInTheDocument();
  });
});
