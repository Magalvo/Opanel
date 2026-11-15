import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Task } from "@/lib/schemas/tasks";

import { fullTask } from "../board/test-support";
import { bodyOf, calls, installFetch, on, problem } from "../projects/test-support";
import { TaskDetail } from "./task-detail";
import {
  AUTH,
  BILLING,
  comment,
  DESIGN,
  detailed,
  DONE,
  GRACE,
  MAX,
  PLATFORM,
  registerLists,
  TODO,
} from "./test-support";

const KEY = detailed.key;
const TASK = `/api/v1/tasks/${KEY}`;

interface Options {
  task?: Task;
  archived?: boolean;
  canWrite?: boolean;
  canDelete?: boolean;
  canComment?: boolean;
  comments?: Parameters<typeof registerLists>[0];
}

const onLeave = vi.fn();

async function renderDetail(options: Options = {}) {
  registerLists(options.comments);
  const user = userEvent.setup();
  render(
    <TaskDetail
      task={options.task ?? detailed}
      archived={options.archived ?? false}
      canWrite={options.canWrite ?? true}
      canDelete={options.canDelete ?? true}
      canComment={options.canComment ?? true}
      onLeave={onLeave}
    />,
  );
  await screen.findByRole("heading", { level: 1 });
  return user;
}

type User = Awaited<ReturnType<typeof renderDetail>>;

function messages() {
  return screen.getByRole("status", { name: "Task messages" });
}

const events: CustomEvent[] = [];
for (const type of ["opanel:task-updated", "opanel:task-deleted"]) {
  window.addEventListener(type, (event) => {
    events.push(event as CustomEvent);
  });
}

function eventsOf(type: string): unknown[] {
  return events.filter((event) => event.type === type).map((event) => event.detail as unknown);
}

function fetchedPeople() {
  return calls("GET").filter(([url]) => url.startsWith("/api/v1/people"));
}

beforeEach(() => {
  installFetch();
  onLeave.mockReset();
  events.length = 0;
});

describe("TaskDetail: what it shows", () => {
  it("shows key, title, column, team, person, epic, reporter and the description as Markdown", async () => {
    await renderDetail({ canWrite: false, canComment: false, canDelete: false });

    expect(screen.getByRole("heading", { level: 1, name: "Review" })).toBeInTheDocument();
    expect(screen.getByText("OPA-3")).toBeInTheDocument();
    expect(await screen.findByText("In progress")).toBeInTheDocument();
    for (const text of ["Platform", "Mia", "Auth"]) {
      expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    }
    expect(screen.getByText(/Reported by/)).toHaveTextContent("Mia");
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    expect(screen.getByRole("link", { name: "link" })).toHaveAttribute("href", "https://a.test");
  });

  it("marks an assignee whose account is deactivated, and says so when there is no description", async () => {
    await renderDetail({
      canWrite: false,
      task: fullTask({ ...detailed, assignee: MAX }, { description: "" }),
    });

    expect(screen.getByText("Deactivated")).toBeInTheDocument();
    expect(screen.getByText("No description.")).toBeInTheDocument();
  });
});

describe("TaskDetail: editing", () => {
  it("sends only what changed with the version, disables Save until then, and uses the new version next", async () => {
    const user = await renderDetail();
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();

    on(`PATCH ${TASK}`, () => Response.json({ ...detailed, title: "Renamed", version: 2 }));
    const title = screen.getByRole("textbox", { name: "Title" });
    await user.clear(title);
    await user.type(title, "Renamed");
    await user.click(save);

    await waitFor(() => {
      expect(messages()).toHaveTextContent("Saved the task.");
    });
    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ title: "Renamed", version: 1 });
    expect(save).toBeDisabled();
    expect(screen.getByRole("heading", { level: 1, name: "Renamed" })).toBeInTheDocument();

    on(`PATCH ${TASK}`, () => Response.json({ ...detailed, title: "Again", version: 3 }));
    await user.clear(title);
    await user.type(title, "Again");
    await user.click(save);
    await waitFor(() => {
      expect(calls("PATCH")).toHaveLength(2);
    });
    expect(bodyOf(calls("PATCH")[1]?.[1])).toEqual({ title: "Again", version: 2 });
  });

  it("changes the type and the description", async () => {
    const user = await renderDetail();
    on(`PATCH ${TASK}`, () => Response.json({ ...detailed, type: "bug", version: 2 }));

    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(await screen.findByRole("option", { name: "Bug" }));
    await user.clear(screen.getByRole("textbox", { name: "Description" }));
    await user.type(screen.getByRole("textbox", { name: "Description" }), "New text");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(calls("PATCH")).toHaveLength(1);
    });
    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({
      type: "bug",
      description: "New text",
      version: 1,
    });
  });

  it("shows the Write and Preview tabs of the description with the same rendering", async () => {
    const user = await renderDetail();
    await user.clear(screen.getByRole("textbox", { name: "Description" }));
    await user.type(screen.getByRole("textbox", { name: "Description" }), "Hello **world**");

    await user.click(screen.getByRole("tab", { name: "Preview description" }));

    expect(screen.getByText("world").tagName).toBe("STRONG");
    expect(screen.queryByRole("textbox", { name: "Description" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Write description" }));
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("Hello **world**");
  });
});

describe("TaskDetail: assignment", () => {
  it("changes the team and the epic from the lists, with an option for none", async () => {
    const user = await renderDetail();
    on(`PATCH ${TASK}`, () => Response.json({ ...detailed, version: 2 }));

    await user.click(await screen.findByRole("combobox", { name: "Team" }));
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual([
      "No team",
      PLATFORM.name,
      DESIGN.name,
    ]);
    await user.click(screen.getByRole("option", { name: "Design" }));
    await user.click(screen.getByRole("combobox", { name: "Epic" }));
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual([
      "No epic",
      AUTH.title,
      BILLING.title,
    ]);
    await user.click(screen.getByRole("option", { name: "No epic" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(calls("PATCH")).toHaveLength(1);
    });
    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({
      assigneeTeamId: DESIGN.id,
      epicId: null,
      version: 1,
    });
  });

  it("keeps the task's own epic in the list even when it is closed", async () => {
    const closed = { id: "88888888-8888-4888-8888-888888888888", title: "Old epic" };
    const user = await renderDetail({
      task: fullTask({ ...detailed, epic: closed }, { description: "" }),
    });

    await user.click(await screen.findByRole("combobox", { name: "Epic" }));

    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toContain(
      "Old epic",
    );
  });

  it("searches people as one types, offers only active ones, and assigns or clears the person", async () => {
    const user = await renderDetail();
    on("GET /api/v1/people?limit=20&q=Gra", () =>
      Response.json({ items: [GRACE, MAX], nextCursor: null }),
    );
    on(`PATCH ${TASK}`, () => Response.json({ ...detailed, version: 2 }));

    await user.type(screen.getByRole("searchbox", { name: "Find a person" }), "Gra");

    expect(await screen.findByRole("button", { name: "Assign Grace" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Assign Max" })).not.toBeInTheDocument();
    expect(fetchedPeople()).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Assign Grace" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(calls("PATCH")).toHaveLength(1);
    });
    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ assigneeAccountId: GRACE.id, version: 1 });

    on(`PATCH ${TASK}`, () => Response.json({ ...detailed, assignee: null, version: 3 }));
    await user.click(screen.getByRole("button", { name: "No one" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(calls("PATCH")).toHaveLength(2);
    });
    expect(bodyOf(calls("PATCH")[1]?.[1])).toEqual({ assigneeAccountId: null, version: 2 });
  });
});

describe("TaskDetail: conflicts and errors", () => {
  async function editTitle(user: User) {
    const title = screen.getByRole("textbox", { name: "Title" });
    await user.clear(title);
    await user.type(title, "Mine");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
  }

  it("shows the current values when someone else changed the task", async () => {
    const user = await renderDetail();
    const current = { ...detailed, title: "Theirs", version: 5 };
    on(`PATCH ${TASK}`, () => problem(409, { code: "version_conflict", current }));

    await editTitle(user);

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Theirs");
    });
    expect(messages()).toHaveTextContent(
      "Someone else changed this task. Your edit was not saved; the current values are shown.",
    );
  });

  it("explains a deactivated person, a field error and an archived project", async () => {
    const user = await renderDetail();
    on(`PATCH ${TASK}`, () => problem(409, { code: "account_inactive" }));
    await editTitle(user);
    await waitFor(() => {
      expect(messages()).toHaveTextContent("This person is deactivated and cannot be assigned.");
    });

    on(`PATCH ${TASK}`, () =>
      problem(400, { code: "invalid_request", errors: [{ path: "title", message: "Too long." }] }),
    );
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Too long.")).toBeInTheDocument();

    on(`PATCH ${TASK}`, () => problem(409, { code: "project_archived" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(messages()).toHaveTextContent("The project is archived, so the task is read-only.");
    });
    expect(screen.queryByRole("textbox", { name: "Title" })).not.toBeInTheDocument();
  });
});

describe("TaskDetail: the column", () => {
  it("moves the task to the end of the chosen column with its version, and shows it there", async () => {
    const user = await renderDetail();
    on(`POST ${TASK}/move`, () => Response.json({ ...detailed, columnId: DONE, version: 2 }));

    await user.click(await screen.findByRole("combobox", { name: "Column" }));
    await user.click(await screen.findByRole("option", { name: "Done" }));

    await waitFor(() => {
      expect(messages()).toHaveTextContent("Moved OPA-3 to Done.");
    });
    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({ columnId: DONE, version: 1 });
    expect(screen.getByRole("combobox", { name: "Column" })).toHaveTextContent("Done");
  });

  it("says it could not move, and keeps the column", async () => {
    const user = await renderDetail();
    on(`POST ${TASK}/move`, () => problem(500, { code: "internal_error" }));

    await user.click(await screen.findByRole("combobox", { name: "Column" }));
    await user.click(await screen.findByRole("option", { name: "Done" }));

    await waitFor(() => {
      expect(messages()).toHaveTextContent("Could not move the task. It is where it was.");
    });
    expect(screen.getByRole("combobox", { name: "Column" })).toHaveTextContent("In progress");
  });
});

describe("TaskDetail: deleting", () => {
  it("is not offered without permission", async () => {
    await renderDetail({ canDelete: false });

    expect(screen.queryByRole("button", { name: "Delete task" })).not.toBeInTheDocument();
  });

  it("asks first, and cancelling deletes nothing", async () => {
    const user = await renderDetail();

    await user.click(screen.getByRole("button", { name: "Delete task" }));
    const confirmation = await screen.findByRole("alertdialog", { name: "Delete this task?" });
    await user.click(within(confirmation).getByRole("button", { name: "Cancel" }));

    expect(calls("DELETE")).toHaveLength(0);
    expect(onLeave).not.toHaveBeenCalled();
  });

  it("deletes, tells the board and leaves", async () => {
    const user = await renderDetail();
    on(`DELETE ${TASK}`, () => new Response(null, { status: 204 }));

    await user.click(screen.getByRole("button", { name: "Delete task" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }),
    );

    await waitFor(() => {
      expect(onLeave).toHaveBeenCalledOnce();
    });
    expect(eventsOf("opanel:task-deleted")).toEqual([detailed.id]);
  });

  it("keeps the task and says so when the delete fails", async () => {
    const user = await renderDetail();
    on(`DELETE ${TASK}`, () => problem(403, { code: "forbidden" }));

    await user.click(screen.getByRole("button", { name: "Delete task" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }),
    );

    await waitFor(() => {
      expect(messages()).toHaveTextContent("Could not delete the task.");
    });
    expect(onLeave).not.toHaveBeenCalled();
  });
});

describe("TaskDetail: comments", () => {
  it("lists them oldest first, as Markdown, and loads more", async () => {
    const user = await renderDetail({
      comments: {
        comments: [comment("1", "First **one**"), comment("2", "Second")],
        commentsCursor: "C1",
      },
    });
    on(`GET ${TASK}/comments?limit=50&cursor=C1`, () =>
      Response.json({ items: [comment("3", "Third")], nextCursor: null }),
    );

    const list = await screen.findByRole("list", { name: "Comments" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([expect.stringContaining("First one"), expect.stringContaining("Second")]);
    expect(within(list).getByText("one").tagName).toBe("STRONG");
    await user.click(screen.getByRole("button", { name: "Load more comments" }));

    expect(await screen.findByText("Third")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more comments" })).not.toBeInTheDocument();
  });

  it("adds a comment, shows it at once, and previews it", async () => {
    const user = await renderDetail();
    on(`POST ${TASK}/comments`, () =>
      Response.json(comment("9", "A **new** one"), { status: 201 }),
    );
    const box = await screen.findByRole("textbox", { name: "New comment" });

    await user.type(box, "A **new** one");
    await user.click(screen.getByRole("tab", { name: "Preview comment" }));
    expect(screen.getByText("new").tagName).toBe("STRONG");
    await user.click(screen.getByRole("tab", { name: "Write comment" }));
    await user.click(screen.getByRole("button", { name: "Add comment" }));

    await waitFor(() => {
      expect(
        within(screen.getByRole("list", { name: "Comments" })).getByText("new"),
      ).toBeInTheDocument();
    });
    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({ body: "A **new** one" });
    expect(screen.getByRole("textbox", { name: "New comment" })).toHaveValue("");
  });

  it("refuses a blank comment without a request", async () => {
    const user = await renderDetail();

    await user.click(await screen.findByRole("button", { name: "Add comment" }));

    expect(calls("POST")).toHaveLength(0);
    expect(messages()).toHaveTextContent("Write something first.");
  });

  it("has no form for someone who cannot comment", async () => {
    await renderDetail({ canComment: false });

    expect(screen.queryByRole("textbox", { name: "New comment" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add comment" })).not.toBeInTheDocument();
  });
});

describe("TaskDetail: read only", () => {
  it("shows no form, no select, no comment form and no Delete for a Viewer", async () => {
    await renderDetail({ canWrite: false, canComment: false, canDelete: false });

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete task" })).not.toBeInTheDocument();
  });

  it("is the same for an archived project, and says why", async () => {
    await renderDetail({ archived: true });

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete task" })).not.toBeInTheDocument();
    expect(screen.getByText("This project is archived, so the task is read-only.")).toBeVisible();
  });
});

describe("TaskDetail: the board behind it", () => {
  it("announces a save and a move with the task", async () => {
    const user = await renderDetail();
    on(`PATCH ${TASK}`, () => Response.json({ ...detailed, title: "Saved", version: 2 }));
    on(`POST ${TASK}/move`, () =>
      Response.json({ ...detailed, title: "Saved", columnId: TODO, version: 3 }),
    );

    const title = screen.getByRole("textbox", { name: "Title" });
    await user.clear(title);
    await user.type(title, "Saved");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(eventsOf("opanel:task-updated")).toHaveLength(1);
    });
    await user.click(await screen.findByRole("combobox", { name: "Column" }));
    await user.click(await screen.findByRole("option", { name: "To do" }));
    await waitFor(() => {
      expect(eventsOf("opanel:task-updated")).toHaveLength(2);
    });

    expect(eventsOf("opanel:task-updated")).toEqual([
      expect.objectContaining({ id: detailed.id, title: "Saved", version: 2 }),
      expect.objectContaining({ id: detailed.id, columnId: TODO, version: 3 }),
    ]);
  });
});

describe("TaskDetail: accessibility", () => {
  it("names every field, has one announced region and a Comments heading", async () => {
    await renderDetail();

    for (const name of ["Title", "Description", "New comment"]) {
      expect(await screen.findByRole("textbox", { name })).toBeInTheDocument();
    }
    expect(await screen.findByRole("searchbox", { name: "Find a person" })).toBeInTheDocument();
    for (const name of ["Type", "Team", "Epic", "Column"]) {
      expect(await screen.findByRole("combobox", { name })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("status", { name: "Task messages" })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 2, name: "Comments" })).toBeInTheDocument();
  });
});
