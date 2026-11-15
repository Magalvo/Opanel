import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import type { Project } from "@/lib/schemas/projects";

import { ProjectSettings } from "./project-settings";
import {
  bodyOf,
  calls,
  column,
  installFetch,
  on,
  problem,
  project,
  PROJECT_ID,
} from "./test-support";

const TODO = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const DOING = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const DONE = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";

const todo = column(TODO, "To do", "todo");
const doing = column(DOING, "In progress", "in_progress");
const done = column(DONE, "Done", "done");

const BASE = `/api/v1/projects/${PROJECT_ID}`;

function columnsResponse(items = [todo, doing, done]) {
  return () => Response.json({ items, nextCursor: null });
}

async function renderSettings(proj: Project = project(), items = [todo, doing, done]) {
  on(`GET ${BASE}/columns`, columnsResponse(items));
  const user = userEvent.setup();
  render(<ProjectSettings project={proj} />);
  await screen.findByRole("list", { name: "Columns" });
  return user;
}

function item(name: string) {
  return within(screen.getByRole("list", { name: "Columns" }))
    .getAllByRole("listitem")
    .find((li) => within(li).queryByRole("textbox", { name: `Name of ${name}` }) !== null);
}

beforeEach(() => {
  installFetch();
});

describe("ProjectSettings: details", () => {
  it("shows the key as text, not as a field, and saves only what changed with the held version", async () => {
    const user = await renderSettings(project({ version: 3 }));
    expect(screen.getByText("OPA")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Key" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    on(`PATCH ${BASE}`, () => Response.json(project({ name: "Opanel 2", version: 4 })));
    const name = screen.getByRole("textbox", { name: "Name" });
    await user.clear(name);
    await user.type(name, "Opanel 2");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Saved the details.");
    });
    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ name: "Opanel 2", version: 3 });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("sends the new version on the next save", async () => {
    const user = await renderSettings();
    on(`PATCH ${BASE}`, () => Response.json(project({ name: "A", version: 2 })));
    await user.clear(screen.getByRole("textbox", { name: "Name" }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "A");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(calls("PATCH")).toHaveLength(1);
    });

    on(`PATCH ${BASE}`, () => Response.json(project({ name: "B", version: 3 })));
    await user.clear(screen.getByRole("textbox", { name: "Name" }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "B");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(calls("PATCH")).toHaveLength(2);
    });
    expect(bodyOf(calls("PATCH")[1]?.[1])).toEqual({ name: "B", version: 2 });
  });

  it("replaces the form with the current values when someone else changed the project", async () => {
    const user = await renderSettings();
    const current = project({ name: "Changed elsewhere", description: "New text", version: 2 });
    on(`PATCH ${BASE}`, () => problem(409, { code: "version_conflict", current }));

    await user.clear(screen.getByRole("textbox", { name: "Name" }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "My edit");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Changed elsewhere");
    });
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("New text");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Someone else changed this project. Your edit was not saved; the current values are shown.",
    );
  });
});

describe("ProjectSettings: archive", () => {
  it("asks first, then archives, and turns the controls off", async () => {
    const user = await renderSettings();
    on(`POST ${BASE}/archive`, () =>
      Response.json(project({ archivedAt: "2026-11-15T10:00:00.000Z", version: 2 })),
    );

    await user.click(screen.getByRole("button", { name: "Archive project" }));
    const confirmation = await screen.findByRole("alertdialog", { name: "Archive this project?" });
    expect(
      within(confirmation).getByText(
        "Archived projects are read-only. You can unarchive it later.",
      ),
    ).toBeInTheDocument();
    expect(calls("POST")).toHaveLength(0);
    await user.click(within(confirmation).getByRole("button", { name: "Archive" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Archived Opanel.");
    });
    expect(screen.getByText("This project is archived, so it is read-only.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Name" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add column" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete To do" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Unarchive project" })).toBeEnabled();
  });

  it("cancelling the confirmation archives nothing", async () => {
    const user = await renderSettings();

    await user.click(screen.getByRole("button", { name: "Archive project" }));
    const confirmation = await screen.findByRole("alertdialog", { name: "Archive this project?" });
    await user.click(within(confirmation).getByRole("button", { name: "Cancel" }));

    expect(calls("POST")).toHaveLength(0);
  });

  it("unarchives at once and turns the controls back on", async () => {
    const user = await renderSettings(project({ archivedAt: "2026-11-13T10:00:00.000Z" }));
    on(`POST ${BASE}/unarchive`, () => Response.json(project({ version: 3 })));

    await user.click(screen.getByRole("button", { name: "Unarchive project" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Unarchived Opanel.");
    });
    expect(screen.getByRole("textbox", { name: "Name" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Add column" })).toBeEnabled();
  });
});

describe("ProjectSettings: columns", () => {
  it("lists the columns in board order, with no Move earlier on the first and no Move later on the last", async () => {
    await renderSettings();

    const names = within(screen.getByRole("list", { name: "Columns" }))
      .getAllByRole("textbox")
      .map((box) => (box as HTMLInputElement).value);
    expect(names).toEqual(["To do", "In progress", "Done"]);
    expect(screen.queryByRole("button", { name: "Move To do earlier" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move To do later" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move Done earlier" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move Done later" })).not.toBeInTheDocument();
  });

  it("adds a column at the end with its category", async () => {
    const user = await renderSettings();
    const review = column("c4c4c4c4-c4c4-4c4c-8c4c-c4c4c4c4c4c4", "Review", "in_progress");
    on(`POST ${BASE}/columns`, () => Response.json(review, { status: 201 }));

    await user.type(screen.getByRole("textbox", { name: "New column name" }), "Review");
    await user.click(screen.getByRole("combobox", { name: "New column category" }));
    await user.click(await screen.findByRole("option", { name: "In progress" }));
    await user.click(screen.getByRole("button", { name: "Add column" }));

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Name of Review" })).toBeInTheDocument();
    });
    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({ name: "Review", category: "in_progress" });
    expect(screen.getByRole("status")).toHaveTextContent("Added the column Review.");
  });

  it("renames a column and changes its category with the column's own version", async () => {
    const user = await renderSettings(project(), [
      todo,
      column(DOING, "In progress", "in_progress", 4),
      done,
    ]);
    on(`PATCH /api/v1/columns/${DOING}`, () =>
      Response.json(column(DOING, "Doing", "in_progress", 5)),
    );

    const box = screen.getByRole("textbox", { name: "Name of In progress" });
    await user.clear(box);
    await user.type(box, "Doing");
    await user.click(screen.getByRole("button", { name: "Rename In progress" }));

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Name of Doing" })).toBeInTheDocument();
    });
    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ name: "Doing", version: 4 });

    on(`PATCH /api/v1/columns/${DOING}`, () => Response.json(column(DOING, "Doing", "done", 6)));
    await user.click(screen.getByRole("combobox", { name: "Category of Doing" }));
    await user.click(await screen.findByRole("option", { name: "Done" }));

    await waitFor(() => {
      expect(calls("PATCH")).toHaveLength(2);
    });
    expect(bodyOf(calls("PATCH")[1]?.[1])).toEqual({ category: "done", version: 5 });
  });

  it("moves a column later and earlier with the column before the new place", async () => {
    const user = await renderSettings();
    on(`POST /api/v1/columns/${TODO}/move`, () => Response.json(column(TODO, "To do", "todo", 2)));

    await user.click(screen.getByRole("button", { name: "Move To do later" }));

    await waitFor(() => {
      expect(calls("POST")).toHaveLength(1);
    });
    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({ afterColumnId: DOING, version: 1 });
    await waitFor(() => {
      expect(
        within(screen.getByRole("list", { name: "Columns" }))
          .getAllByRole("textbox")
          .map((box) => (box as HTMLInputElement).value),
      ).toEqual(["In progress", "To do", "Done"]);
    });

    on(`POST /api/v1/columns/${DONE}/move`, () => Response.json(column(DONE, "Done", "done", 2)));
    await user.click(screen.getByRole("button", { name: "Move Done earlier" }));

    await waitFor(() => {
      expect(calls("POST")).toHaveLength(2);
    });
    expect(bodyOf(calls("POST")[1]?.[1])).toEqual({ afterColumnId: DOING, version: 1 });
  });

  it("moves the second column to the first place with a null anchor", async () => {
    const user = await renderSettings();
    on(`POST /api/v1/columns/${DOING}/move`, () =>
      Response.json(column(DOING, "In progress", "in_progress", 2)),
    );

    await user.click(screen.getByRole("button", { name: "Move In progress earlier" }));

    await waitFor(() => {
      expect(calls("POST")).toHaveLength(1);
    });
    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({ afterColumnId: null, version: 1 });
  });

  it("reloads the columns and says so when someone else changed them", async () => {
    const user = await renderSettings();
    on(`PATCH /api/v1/columns/${TODO}`, () =>
      problem(409, { code: "version_conflict", current: column(TODO, "Backlog", "todo", 2) }),
    );
    on(`GET ${BASE}/columns`, columnsResponse([column(TODO, "Backlog", "todo", 2), doing, done]));

    await user.clear(screen.getByRole("textbox", { name: "Name of To do" }));
    await user.type(screen.getByRole("textbox", { name: "Name of To do" }), "Mine");
    await user.click(screen.getByRole("button", { name: "Rename To do" }));

    expect(await screen.findByRole("textbox", { name: "Name of Backlog" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Someone else changed the columns. The list was reloaded.",
    );
  });

  it("deletes after asking, and cancelling deletes nothing", async () => {
    const user = await renderSettings();
    await user.click(screen.getByRole("button", { name: "Delete In progress" }));
    const confirmation = await screen.findByRole("alertdialog", { name: "Delete this column?" });
    await user.click(within(confirmation).getByRole("button", { name: "Cancel" }));
    expect(calls("DELETE")).toHaveLength(0);

    on(`DELETE /api/v1/columns/${DOING}`, () => new Response(null, { status: 204 }));
    await user.click(screen.getByRole("button", { name: "Delete In progress" }));
    await user.click(
      within(await screen.findByRole("alertdialog", { name: "Delete this column?" })).getByRole(
        "button",
        { name: "Delete" },
      ),
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("textbox", { name: "Name of In progress" }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByRole("status")).toHaveTextContent("Deleted the column In progress.");
  });

  it("explains a column that still has tasks and the last Done column, and keeps them", async () => {
    const user = await renderSettings();
    on(`DELETE /api/v1/columns/${TODO}`, () => problem(409, { code: "column_not_empty" }));
    await user.click(screen.getByRole("button", { name: "Delete To do" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }),
    );

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "This column still has tasks. Move or delete them first.",
      );
    });
    expect(item("To do")).toBeDefined();

    on(`DELETE /api/v1/columns/${DONE}`, () => problem(409, { code: "last_done_column" }));
    await user.click(screen.getByRole("button", { name: "Delete Done" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }),
    );

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "A project needs at least one Done column.",
      );
    });
    expect(item("Done")).toBeDefined();
  });
});

describe("ProjectSettings: deleted tasks", () => {
  const DELETED = `${BASE}/tasks?deleted=true&limit=50`;

  function deleted(key: string, title: string) {
    return {
      id: crypto.randomUUID(),
      key,
      number: Number(key.split("-")[1]),
      projectId: PROJECT_ID,
      type: "task",
      title,
      columnId: TODO,
      assigneeTeam: null,
      assignee: null,
      epic: null,
      reporter: { id: crypto.randomUUID(), name: "Mia" },
      version: 2,
      createdAt: "2026-11-12T10:00:00.000Z",
      updatedAt: "2026-11-14T10:00:00.000Z",
      deletedAt: "2026-11-14T10:00:00.000Z",
    };
  }

  it("loads only when opened, then lists key, title and time, and restores", async () => {
    const user = await renderSettings();
    expect(calls("GET").some(([url]) => url.includes("deleted=true"))).toBe(false);
    on(`GET ${DELETED}`, () =>
      Response.json({
        items: [deleted("OPA-1", "Fix login"), deleted("OPA-2", "Old")],
        nextCursor: null,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Show deleted tasks" }));

    const list = await screen.findByRole("list", { name: "Deleted tasks" });
    expect(within(list).getByText("OPA-1")).toBeInTheDocument();
    expect(within(list).getByText("Fix login")).toBeInTheDocument();
    expect(
      within(list).getAllByText(new Date("2026-11-14T10:00:00.000Z").toLocaleString()),
    ).toHaveLength(2);

    on("POST /api/v1/tasks/OPA-1/restore", () =>
      Response.json({ ...deleted("OPA-1", "Fix login"), description: "", deletedAt: null }),
    );
    await user.click(screen.getByRole("button", { name: "Restore OPA-1" }));

    await waitFor(() => {
      expect(within(list).queryByText("OPA-1")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("status")).toHaveTextContent("Restored OPA-1.");
    expect(within(list).getByText("OPA-2")).toBeInTheDocument();
  });

  it("says when there are none, and loads more with the cursor", async () => {
    const user = await renderSettings();
    on(`GET ${DELETED}`, () => Response.json({ items: [], nextCursor: null }));
    await user.click(screen.getByRole("button", { name: "Show deleted tasks" }));
    expect(await screen.findByText("No deleted tasks.")).toBeInTheDocument();
  });

  it("pages with Load more deleted tasks", async () => {
    const user = await renderSettings();
    on(`GET ${DELETED}`, () =>
      Response.json({ items: [deleted("OPA-1", "One")], nextCursor: "CUR" }),
    );
    on(`GET ${DELETED}&cursor=CUR`, () =>
      Response.json({ items: [deleted("OPA-2", "Two")], nextCursor: null }),
    );
    await user.click(screen.getByRole("button", { name: "Show deleted tasks" }));

    await user.click(await screen.findByRole("button", { name: "Load more deleted tasks" }));

    expect(await screen.findByText("OPA-2")).toBeInTheDocument();
    expect(screen.getByText("OPA-1")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Load more deleted tasks" }),
    ).not.toBeInTheDocument();
  });

  it("disables Restore in an archived project", async () => {
    const user = await renderSettings(project({ archivedAt: "2026-11-13T10:00:00.000Z" }));
    on(`GET ${DELETED}`, () =>
      Response.json({ items: [deleted("OPA-1", "One")], nextCursor: null }),
    );
    await user.click(screen.getByRole("button", { name: "Show deleted tasks" }));
    expect(await screen.findByRole("button", { name: "Restore OPA-1" })).toBeDisabled();
  });

  it("explains project_archived when the project was archived elsewhere", async () => {
    const user = await renderSettings();
    on(`GET ${DELETED}`, () =>
      Response.json({ items: [deleted("OPA-1", "One")], nextCursor: null }),
    );
    await user.click(screen.getByRole("button", { name: "Show deleted tasks" }));
    on("POST /api/v1/tasks/OPA-1/restore", () => problem(409, { code: "project_archived" }));

    await user.click(await screen.findByRole("button", { name: "Restore OPA-1" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "The project is archived, so the task cannot be restored.",
      );
    });
    expect(screen.getByText("OPA-1")).toBeInTheDocument();
  });
});

describe("ProjectSettings: accessibility", () => {
  it("has headings, one announced status region and named controls", async () => {
    await renderSettings();

    expect(screen.getByRole("heading", { level: 1, name: "Opanel settings" })).toBeInTheDocument();
    for (const name of ["Details", "Columns", "Deleted tasks"]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("status")).toHaveLength(1);
    for (const column of ["To do", "In progress", "Done"]) {
      expect(screen.getByRole("textbox", { name: `Name of ${column}` })).toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: `Category of ${column}` })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `Rename ${column}` })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `Delete ${column}` })).toBeInTheDocument();
    }
  });

  it("closes the archive dialog with Escape and returns focus to its button", async () => {
    const user = await renderSettings();
    const opener = screen.getByRole("button", { name: "Archive project" });
    await user.click(opener);
    await screen.findByRole("alertdialog");

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(opener).toHaveFocus();
    });
  });
});
