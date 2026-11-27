import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bodyOf, calls, installFetch, on, problem } from "@/components/fake-api";
import { FakeSource } from "@/hooks/fake-event-source";
import type { Column } from "@/lib/schemas/columns";
import type { ProjectEvent } from "@/lib/schemas/events";
import type { Label } from "@/lib/schemas/labels";
import type { Project } from "@/lib/schemas/projects";
import type { TaskSummary } from "@/lib/schemas/tasks";
import type { TeamSummary } from "@/lib/schemas/teams";
import type { TriageSettings } from "@/lib/schemas/triage";

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
  sprintsEnabled: false,
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
  parent: null,
  reporter: { id: "55555555-5555-4555-8555-555555555555", name: "Ada", kind: "human" },
  severity: null,
  fingerprint: null,
  occurrences: 0,
  lastReportedAt: null,
  priority: "none",
  dueDate: null,
  storyPoints: null,
  sprint: null,
  labels: [],
  subtasks: null,
  version: 2,
  createdAt: "2026-11-12T10:00:00.000Z",
  updatedAt: "2026-11-13T10:00:00.000Z",
  deletedAt: "2026-11-13T10:00:00.000Z",
};

function team(id: string, name: string): TeamSummary {
  return { id, name, memberCount: 1, createdAt: "2026-11-12T10:00:00.000Z" };
}

const web = team("77777777-7777-4777-8777-777777777777", "Web");
const platform = team("88888888-8888-4888-8888-888888888888", "Platform");
const qa = team("99999999-9999-4999-8999-999999999999", "QA");

const noTriage: TriageSettings = {
  triageTeamId: null,
  rules: { frontend: null, api: null, backend: null },
  version: 3,
};

const PROJECT = "GET /api/v1/projects/OPA";
const TRIAGE = "GET /api/v1/projects/OPA/triage";
const PATCH_TRIAGE = "PATCH /api/v1/projects/OPA/triage";
const TEAMS = "GET /api/v1/teams?limit=50";
const COLUMNS = "GET /api/v1/projects/OPA/columns";
const DELETED = "GET /api/v1/projects/OPA/tasks?limit=50&deleted=true";
const LABELS = "GET /api/v1/projects/OPA/labels";

function label(id: string, name: string, colour: Label["colour"], version = 1): Label {
  return {
    id,
    projectId: PROJECT_ID,
    name,
    colour,
    version,
    createdAt: "2026-11-12T10:00:00.000Z",
    updatedAt: "2026-11-12T10:00:00.000Z",
  };
}

const bug = label("bbbb0000-0000-4000-8000-000000000001", "Bug", "red", 2);
const ui = label("bbbb0000-0000-4000-8000-000000000002", "UI", "blue");

function json(body: unknown, status = 200) {
  return () => Response.json(body, { status });
}

function columns(items: Column[]) {
  return json({ items, nextCursor: null });
}

async function renderSettings({
  project = opa,
  canRestoreTasks = true,
  canManageTriage = true,
  cols = [todo, doing, done],
  tasks = [deleted],
  triage = noTriage,
  teams = [web, platform, qa],
  labels = [bug, ui],
}: {
  project?: Project;
  canRestoreTasks?: boolean;
  canManageTriage?: boolean;
  cols?: Column[];
  tasks?: TaskSummary[];
  triage?: TriageSettings;
  teams?: TeamSummary[];
  labels?: Label[];
} = {}) {
  on(PROJECT, json(project));
  on(COLUMNS, columns(cols));
  on(DELETED, json({ items: tasks, nextCursor: null }));
  on(TRIAGE, json(triage));
  on(TEAMS, json({ items: teams, nextCursor: null }));
  on(LABELS, json({ items: labels, nextCursor: null }));
  const user = userEvent.setup();
  render(
    <ProjectFrame projectKey="OPA" canManageProjects>
      <ProjectSettings canRestoreTasks={canRestoreTasks} canManageTriage={canManageTriage} />
    </ProjectFrame>,
  );
  await screen.findByRole("heading", { level: 2, name: "Details" });
  await screen.findByRole("row", { name: /In progress/ });
  await screen.findByLabelText("Triage team");
  await screen.findByRole("region", { name: "Labels" });
  return user;
}

function triageSelect(name: string): HTMLSelectElement {
  return within(section("Triage")).getByLabelText(name);
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
      json({ ...deleted, description: "", links: [], subtaskList: [], deletedAt: null }),
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

  it("says a restored backlog task went back to the backlog (WS-101)", async () => {
    const later = { ...deleted, columnId: null };
    on(
      `POST /api/v1/tasks/${deleted.id}/restore`,
      json({ ...later, description: "", links: [], subtaskList: [], deletedAt: null }),
    );
    const user = await renderSettings({ tasks: [later] });

    await user.click(
      within(section("Deleted tasks")).getByRole("button", { name: "Restore OPA-3" }),
    );

    await vi.waitFor(() => {
      expect(status()).toHaveTextContent("OPA-3 was restored to the backlog.");
    });
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

describe("ProjectSettings: triage (WS-092)", () => {
  const chosen: TriageSettings = {
    triageTeamId: qa.id,
    rules: { frontend: web.id, api: platform.id, backend: null },
    version: 3,
  };

  function conflict(current: TriageSettings) {
    return json(
      {
        type: "about:blank",
        title: "Conflict",
        status: 409,
        code: "version_conflict",
        detail: "Changed.",
        requestId: "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f",
        current,
      },
      409,
    );
  }

  function sendProjectChanged(version: number) {
    act(() => {
      FakeSource.latest().send("project.changed", {
        id: crypto.randomUUID(),
        type: "project.changed",
        projectId: PROJECT_ID,
        entity: "project",
        entityId: PROJECT_ID,
        version,
        actorAccountId: "55555555-5555-4555-8555-555555555555",
        at: "2026-11-20T10:00:00.000Z",
      });
    });
  }

  function save() {
    return within(section("Triage")).getByRole("button", { name: "Save" });
  }

  it("shows the hint and a select per layer, each set from the settings", async () => {
    await renderSettings({ triage: chosen });
    const triage = section("Triage");

    expect(triage).toHaveTextContent(
      "Bugs of an unknown layer, or of a layer with no team, go to the triage team.",
    );
    for (const name of ["Triage team", "Frontend", "API", "Backend"]) {
      const options = within(triageSelect(name)).getAllByRole("option");
      expect(options.map((option) => option.textContent)).toEqual([
        "No team",
        "Web",
        "Platform",
        "QA",
      ]);
    }
    expect(triageSelect("Triage team")).toHaveValue(qa.id);
    expect(triageSelect("Frontend")).toHaveValue(web.id);
    expect(triageSelect("API")).toHaveValue(platform.id);
    expect(triageSelect("Backend")).toHaveValue("");
  });

  it("shows a team it does not know as Unknown team", async () => {
    const other = "abababab-abab-4bab-8bab-abababababab";
    await renderSettings({ triage: { ...noTriage, triageTeamId: other } });

    expect(triageSelect("Triage team")).toHaveValue(other);
    expect(
      within(triageSelect("Triage team")).getByRole("option", { selected: true }),
    ).toHaveTextContent("Unknown team");
  });

  it("saves every value with the version it holds and shows the answer", async () => {
    on(PROJECT, json({ ...opa, version: 4 }));
    const user = await renderSettings({ triage: chosen });
    on(
      PATCH_TRIAGE,
      json({
        triageTeamId: null,
        rules: { ...chosen.rules, backend: platform.id },
        version: 4,
      }),
    );

    await user.selectOptions(triageSelect("Triage team"), "No team");
    await user.selectOptions(triageSelect("Backend"), "Platform");
    await user.click(save());

    await waitFor(() => {
      expect(status()).toHaveTextContent("Saved.");
    });
    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({
      triageTeamId: null,
      rules: { frontend: web.id, api: platform.id, backend: platform.id },
      version: 3,
    });
    expect(triageSelect("Triage team")).toHaveValue("");
    expect(triageSelect("Backend")).toHaveValue(platform.id);
  });

  it("brings the frame's project to the new version, so Details saves without a conflict", async () => {
    const user = await renderSettings();
    on(PATCH_TRIAGE, json({ ...chosen, version: 4 }));
    on(PROJECT, json({ ...opa, version: 4 }));
    on("PATCH /api/v1/projects/OPA", json({ ...opa, description: "New.", version: 5 }));

    await user.selectOptions(triageSelect("Triage team"), "QA");
    await user.click(save());
    await waitFor(() => {
      expect(status()).toHaveTextContent("Saved.");
    });
    await waitFor(() => {
      expect(calls("GET").filter(([url]) => url === "/api/v1/projects/OPA")).toHaveLength(2);
    });
    const details = section("Details");
    await user.clear(within(details).getByLabelText("Description"));
    await user.type(within(details).getByLabelText("Description"), "New.");
    await user.click(within(details).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(calls("PATCH")).toHaveLength(2);
    });
    expect(bodyOf(calls("PATCH")[1]?.[1])).toMatchObject({ version: 4 });
  });

  it("shows the current settings on a version conflict and says why", async () => {
    const user = await renderSettings();
    on(PATCH_TRIAGE, conflict({ ...chosen, version: 6 }));

    await user.selectOptions(triageSelect("Backend"), "QA");
    await user.click(save());

    await waitFor(() => {
      expect(triageSelect("Triage team")).toHaveValue(qa.id);
    });
    expect(triageSelect("Backend")).toHaveValue("");
    expect(status()).toHaveTextContent(
      "The project changed since these settings were loaded. The current settings are shown; make your change again.",
    );

    on(PATCH_TRIAGE, json({ ...chosen, version: 7 }));
    await user.click(save());
    await waitFor(() => {
      expect(calls("PATCH")).toHaveLength(2);
    });
    expect(bodyOf(calls("PATCH")[1]?.[1])).toMatchObject({ version: 6 });
  });

  it("says when the project is archived", async () => {
    const user = await renderSettings();
    on(PATCH_TRIAGE, problem(409, "project_archived"));

    await user.selectOptions(triageSelect("API"), "Platform");
    await user.click(save());

    await waitFor(() => {
      expect(status()).toHaveTextContent("The project is archived.");
    });
  });

  it("reads the teams again when a chosen team no longer exists, keeping the choices", async () => {
    const user = await renderSettings();
    on(
      PATCH_TRIAGE,
      problem(400, "invalid_request", [{ path: "rules.api", message: "There is no such team." }]),
    );

    await user.selectOptions(triageSelect("API"), "Platform");
    on(TEAMS, json({ items: [web, qa], nextCursor: null }));
    await user.click(save());

    await waitFor(() => {
      expect(status()).toHaveTextContent(
        "A team you chose no longer exists. The list of teams was refreshed.",
      );
    });
    await waitFor(() => {
      expect(
        within(triageSelect("Frontend")).queryByRole("option", { name: "Platform" }),
      ).toBeNull();
    });
    expect(triageSelect("API")).toHaveValue(platform.id);
  });

  it("keeps the choices when saving fails otherwise", async () => {
    const user = await renderSettings();
    on(PATCH_TRIAGE, problem(500, "internal_error"));

    await user.selectOptions(triageSelect("Frontend"), "Web");
    await user.click(save());

    await waitFor(() => {
      expect(status()).toHaveTextContent("Could not save. Try again.");
    });
    expect(triageSelect("Frontend")).toHaveValue(web.id);
  });

  it.each([
    ["an archived project", { project: { ...opa, archivedAt: "2026-11-19T10:00:00.000Z" } }],
    ["someone without teams:manage", { canManageTriage: false }],
  ])("is read-only for %s", async (_name, options) => {
    await renderSettings(options);

    for (const name of ["Triage team", "Frontend", "API", "Backend"]) {
      expect(triageSelect(name)).toBeDisabled();
    }
    expect(save()).toBeDisabled();
  });

  it.each([TRIAGE, TEAMS])("says when %s fails to load, and retries", async (failing) => {
    on(PROJECT, json(opa));
    on(COLUMNS, columns([todo, doing, done]));
    on(DELETED, json({ items: [], nextCursor: null }));
    on(TRIAGE, json(chosen));
    on(TEAMS, json({ items: [web, platform, qa], nextCursor: null }));
    on(failing, problem(500, "internal_error"));
    const user = userEvent.setup();
    render(
      <ProjectFrame projectKey="OPA" canManageProjects>
        <ProjectSettings canRestoreTasks canManageTriage />
      </ProjectFrame>,
    );

    expect(await screen.findByText("Could not load the triage settings.")).toBeVisible();

    on(TRIAGE, json(chosen));
    on(TEAMS, json({ items: [web, platform, qa], nextCursor: null }));
    await user.click(within(section("Triage")).getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(triageSelect("Triage team")).toHaveValue(qa.id);
    });
  });

  describe("live", () => {
    async function renderLive() {
      const user = await renderSettings();
      act(() => {
        FakeSource.latest().open();
      });
      return user;
    }

    it("reads the settings again on a newer project version when nothing is unsaved", async () => {
      await renderLive();
      on(PROJECT, json({ ...opa, version: 4 }));
      on(TRIAGE, json({ ...chosen, version: 4 }));

      sendProjectChanged(4);

      await waitFor(() => {
        expect(triageSelect("Triage team")).toHaveValue(qa.id);
      });
    });

    it("keeps unsaved choices, says so, and saves on the old version", async () => {
      const user = await renderLive();
      on(PATCH_TRIAGE, conflict({ ...chosen, version: 4 }));
      await user.selectOptions(triageSelect("Backend"), "Web");
      on(PROJECT, json({ ...opa, version: 4 }));
      on(TRIAGE, json({ ...chosen, version: 4 }));

      sendProjectChanged(4);

      await waitFor(() => {
        expect(status()).toHaveTextContent(
          "The project changed since these settings were loaded. Saving will show the current settings first.",
        );
      });
      expect(triageSelect("Backend")).toHaveValue(web.id);
      expect(triageSelect("Triage team")).toHaveValue("");
      await user.click(save());
      await waitFor(() => {
        expect(calls("PATCH")).toHaveLength(1);
      });
      expect(bodyOf(calls("PATCH")[0]?.[1])).toMatchObject({ version: 3 });
    });

    it("reads the settings and the teams again after a reconnect", async () => {
      const ops = team("cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd", "Ops");
      await renderLive();
      on(TRIAGE, json({ ...noTriage, triageTeamId: ops.id }));
      on(TEAMS, json({ items: [web, platform, qa, ops], nextCursor: null }));

      act(() => {
        FakeSource.latest().drop();
        FakeSource.latest().open();
      });

      await waitFor(() => {
        expect(
          within(triageSelect("Triage team")).getByRole("option", { selected: true }),
        ).toHaveTextContent("Ops");
      });
    });
  });
});

describe("ProjectSettings: labels (WS-108)", () => {
  function labels() {
    return section("Labels");
  }

  it("lists the labels by name with their colour", async () => {
    await renderSettings();

    const rows = (await within(labels()).findAllByRole("row")).slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Bug");
    expect(rows[0]).toHaveTextContent("Red");
    expect(rows[1]).toHaveTextContent("UI");
    expect(rows[1]).toHaveTextContent("Blue");
  });

  it("says when the project has no labels", async () => {
    await renderSettings({ labels: [] });

    expect(await within(labels()).findByText("No labels yet.")).toBeVisible();
  });

  it("adds a label with a name and a colour", async () => {
    const docs = label("bbbb0000-0000-4000-8000-000000000003", "Docs", "green");
    on("POST /api/v1/projects/OPA/labels", json(docs, 201));
    const user = await renderSettings();

    await user.click(within(labels()).getByRole("button", { name: "Add label" }));
    const dialog = screen.getByRole("dialog", { name: "Add a label" });
    await user.type(within(dialog).getByLabelText("Name"), "Docs");
    await user.click(within(dialog).getByRole("radio", { name: "Green" }));
    on(LABELS, json({ items: [bug, docs, ui], nextCursor: null }));
    await user.click(within(dialog).getByRole("button", { name: "Add label" }));

    expect(await within(labels()).findByRole("row", { name: /Docs/ })).toBeVisible();
    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({ name: "Docs", colour: "green" });
    expect(status()).toHaveTextContent("Added label Docs.");
  });

  it("edits a label, sending only what changed with its version", async () => {
    on(`PATCH /api/v1/labels/${bug.id}`, json({ ...bug, colour: "pink", version: 3 }));
    const user = await renderSettings();

    await user.click(await within(labels()).findByRole("button", { name: "Edit Bug" }));
    const dialog = screen.getByRole("dialog", { name: "Edit label" });
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Bug");
    expect(within(dialog).getByRole("radio", { name: "Red" })).toBeChecked();
    await user.click(within(dialog).getByRole("radio", { name: "Pink" }));
    on(LABELS, json({ items: [{ ...bug, colour: "pink", version: 3 }, ui], nextCursor: null }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ colour: "pink", version: 2 });
    expect(await within(labels()).findByRole("row", { name: /Pink/ })).toBeVisible();
  });

  it("deletes a label after a confirmation that says it leaves every task", async () => {
    on(`DELETE /api/v1/labels/${ui.id}`, () => new Response(null, { status: 204 }));
    const user = await renderSettings();

    await user.click(await within(labels()).findByRole("button", { name: "Delete UI" }));
    const confirm = screen.getByRole("alertdialog", { name: "Delete label UI?" });
    expect(confirm).toHaveTextContent("It is removed from every task that has it.");
    on(LABELS, json({ items: [bug], nextCursor: null }));
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    await vi.waitFor(() => {
      expect(within(labels()).queryByRole("row", { name: /UI/ })).not.toBeInTheDocument();
    });
    expect(status()).toHaveTextContent("Deleted label UI.");
  });

  it.each([
    ["label_name_taken", "Another label has this name."],
    ["too_many_labels", "This project already has 200 labels."],
    ["project_archived", "The project is archived."],
  ])("explains a refused addition (%s)", async (code, message) => {
    on("POST /api/v1/projects/OPA/labels", problem(409, code));
    const user = await renderSettings();

    await user.click(within(labels()).getByRole("button", { name: "Add label" }));
    const dialog = screen.getByRole("dialog", { name: "Add a label" });
    await user.type(within(dialog).getByLabelText("Name"), "Bug");
    await user.click(within(dialog).getByRole("button", { name: "Add label" }));

    expect(await within(dialog).findByText(message)).toBeVisible();
  });

  it("explains a version conflict and reads the labels again", async () => {
    on(`PATCH /api/v1/labels/${bug.id}`, problem(409, "version_conflict"));
    const user = await renderSettings();
    await within(labels()).findByRole("button", { name: "Edit Bug" });
    const before = calls("GET").filter(([url]) => url.endsWith("/labels")).length;

    await user.click(within(labels()).getByRole("button", { name: "Edit Bug" }));
    const dialog = screen.getByRole("dialog", { name: "Edit label" });
    await user.click(within(dialog).getByRole("radio", { name: "Pink" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await vi.waitFor(() => {
      expect(status()).toHaveTextContent(
        "Someone else changed this label. The list was refreshed.",
      );
    });
    expect(calls("GET").filter(([url]) => url.endsWith("/labels")).length).toBe(before + 1);
  });

  it("is read-only on an archived project", async () => {
    await renderSettings({ project: { ...opa, archivedAt: "2026-11-20T10:00:00.000Z" } });

    await within(labels()).findByText("Bug");
    expect(within(labels()).queryByRole("button", { name: "Add label" })).not.toBeInTheDocument();
    expect(within(labels()).queryByRole("button", { name: "Edit Bug" })).not.toBeInTheDocument();
  });

  it("reads the labels again on label.changed", async () => {
    await renderSettings();
    act(() => {
      FakeSource.latest().open();
    });
    on(LABELS, json({ items: [{ ...bug, name: "Defect", version: 3 }, ui], nextCursor: null }));

    act(() => {
      FakeSource.latest().send("label.changed", {
        id: crypto.randomUUID(),
        type: "label.changed",
        projectId: PROJECT_ID,
        entity: "label",
        entityId: bug.id,
        version: 3,
        actorAccountId: "55555555-5555-4555-8555-555555555555",
        at: "2026-11-18T10:00:00.000Z",
      });
    });

    expect(await within(labels()).findByRole("row", { name: /Defect/ })).toBeVisible();
  });
});

describe("ProjectSettings: the focus returns to the opener (WS-129)", () => {
  function labels() {
    return section("Labels");
  }

  function addColumn() {
    return within(section("Columns")).getByRole("button", { name: "Add column" });
  }

  it("returns from Add column to Add column, on Escape and after a save (test 2)", async () => {
    const review = column("66666666-6666-4666-8666-666666666666", "Review", "todo");
    on("POST /api/v1/projects/OPA/columns", json(review, 201));
    const user = await renderSettings();

    await user.click(addColumn());
    expect(screen.getByRole("dialog", { name: "Add a column" })).toBeVisible();
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(addColumn()).toHaveFocus();
    });

    await user.click(addColumn());
    const dialog = screen.getByRole("dialog", { name: "Add a column" });
    await user.type(within(dialog).getByLabelText("Name"), "Review");
    on(COLUMNS, columns([todo, doing, done, review]));
    await user.click(within(dialog).getByRole("button", { name: "Add column" }));
    await screen.findByRole("row", { name: /Review/ });
    await waitFor(() => {
      expect(addColumn()).toHaveFocus();
    });
  });

  it("returns from Edit column to the row's Edit button, on Escape and after a save (test 2)", async () => {
    const renamed = { ...doing, name: "Doing", version: 3 };
    on(`PATCH /api/v1/columns/${doing.id}`, json(renamed));
    const user = await renderSettings();

    await user.click(screen.getByRole("button", { name: "Edit In progress" }));
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Edit In progress" })).toHaveFocus();
    });

    await user.click(screen.getByRole("button", { name: "Edit In progress" }));
    const dialog = screen.getByRole("dialog", { name: "Edit column" });
    await user.clear(within(dialog).getByLabelText("Name"));
    await user.type(within(dialog).getByLabelText("Name"), "Doing");
    on(COLUMNS, columns([todo, renamed, done]));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await screen.findByRole("row", { name: /Doing/ });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Edit Doing" })).toHaveFocus();
    });
  });

  it("returns from a cancelled column delete to Delete, and from a confirmed one to Add column (test 3)", async () => {
    on(`DELETE /api/v1/columns/${doing.id}`, () => new Response(null, { status: 204 }));
    const user = await renderSettings();

    await user.click(screen.getByRole("button", { name: "Delete In progress" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }),
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Delete In progress" })).toHaveFocus();
    });

    await user.click(screen.getByRole("button", { name: "Delete In progress" }));
    on(COLUMNS, columns([todo, done]));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }),
    );
    await vi.waitFor(() => {
      expect(screen.queryByRole("row", { name: /In progress/ })).not.toBeInTheDocument();
    });
    expect(addColumn()).toHaveFocus();
  });

  it("returns from Add label, Edit label and Delete label to their openers (test 4)", async () => {
    on(`DELETE /api/v1/labels/${ui.id}`, () => new Response(null, { status: 204 }));
    const user = await renderSettings();
    const add = within(labels()).getByRole("button", { name: "Add label" });

    await user.click(add);
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(add).toHaveFocus();
    });

    await user.click(within(labels()).getByRole("button", { name: "Edit Bug" }));
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(within(labels()).getByRole("button", { name: "Edit Bug" })).toHaveFocus();
    });

    await user.click(within(labels()).getByRole("button", { name: "Delete UI" }));
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(within(labels()).getByRole("button", { name: "Delete UI" })).toHaveFocus();
    });

    await user.click(within(labels()).getByRole("button", { name: "Delete UI" }));
    on(LABELS, json({ items: [bug], nextCursor: null }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }),
    );
    await vi.waitFor(() => {
      expect(within(labels()).queryByRole("row", { name: /UI/ })).not.toBeInTheDocument();
    });
    expect(within(labels()).getByRole("button", { name: "Add label" })).toHaveFocus();
  });

  it("returns from Edit label to the row's Edit button after a save (test 4)", async () => {
    on(`PATCH /api/v1/labels/${bug.id}`, json({ ...bug, colour: "pink", version: 3 }));
    const user = await renderSettings();

    await user.click(within(labels()).getByRole("button", { name: "Edit Bug" }));
    const dialog = screen.getByRole("dialog", { name: "Edit label" });
    await user.click(within(dialog).getByRole("radio", { name: "Pink" }));
    on(LABELS, json({ items: [{ ...bug, colour: "pink", version: 3 }, ui], nextCursor: null }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await within(labels()).findByRole("row", { name: /Pink/ });
    await waitFor(() => {
      expect(within(labels()).getByRole("button", { name: "Edit Bug" })).toHaveFocus();
    });
  });

  it("returns to Add column when the edited column was deleted meanwhile (test 5)", async () => {
    const user = await renderSettings();
    act(() => {
      FakeSource.latest().open();
    });

    await user.click(screen.getByRole("button", { name: "Edit In progress" }));
    on(COLUMNS, columns([todo, done]));
    act(() => {
      FakeSource.latest().send("column.changed", {
        id: crypto.randomUUID(),
        type: "column.changed",
        projectId: PROJECT_ID,
        entity: "column",
        entityId: doing.id,
        version: 3,
        actorAccountId: "55555555-5555-4555-8555-555555555555",
        at: "2026-11-18T10:00:00.000Z",
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Delete In progress" })).not.toBeInTheDocument();
    });
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(addColumn()).toHaveFocus();
    });
  });

  it("returns from Archive to its button, then to Unarchive and back (test 6)", async () => {
    const archived = { ...opa, archivedAt: "2026-11-16T10:00:00.000Z", version: 4 };
    on("POST /api/v1/projects/OPA/archive", json(archived));
    on("POST /api/v1/projects/OPA/unarchive", json({ ...opa, version: 5 }));
    const user = await renderSettings();

    await user.click(screen.getByRole("button", { name: "Archive project" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }),
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Archive project" })).toHaveFocus();
    });

    await user.click(screen.getByRole("button", { name: "Archive project" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Archive" }),
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Unarchive project" })).toHaveFocus();
    });

    await user.click(screen.getByRole("button", { name: "Unarchive project" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Archive project" })).toHaveFocus();
    });
  });

  it("keeps the focus on Archive project when archiving fails (test 6)", async () => {
    on("POST /api/v1/projects/OPA/archive", problem(500, "internal_error"));
    const user = await renderSettings();

    await user.click(screen.getByRole("button", { name: "Archive project" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Archive" }),
    );

    await waitFor(() => {
      expect(status().textContent).not.toBe("");
    });
    expect(screen.getByRole("button", { name: "Archive project" })).toHaveFocus();
  });
});
