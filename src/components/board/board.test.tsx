import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import type { TaskSummary } from "@/lib/schemas/tasks";

import {
  bodyOf,
  calls,
  installFetch,
  on,
  problem,
  project,
  PROJECT_ID,
} from "../projects/test-support";
import { Board } from "./board";
import { columns, DOING, DONE, fullTask, t1, t2, t3, t4, task, TODO } from "./test-support";

const BASE = `/api/v1/projects/${PROJECT_ID}`;
const TASKS = `GET ${BASE}/tasks?limit=100`;

function respondWith(items: TaskSummary[], nextCursor: string | null = null) {
  return () => Response.json({ items, nextCursor });
}

function register(tasks: TaskSummary[] = [t1, t2, t3, t4]) {
  on(`GET ${BASE}/columns`, () => Response.json({ items: columns, nextCursor: null }));
  on(TASKS, respondWith(tasks));
}

async function renderBoard(
  options: { canWrite?: boolean; archived?: boolean; tasks?: TaskSummary[] } = {},
) {
  register(options.tasks);
  const user = userEvent.setup();
  render(
    <Board
      project={project()}
      canWrite={options.canWrite ?? true}
      archived={options.archived ?? false}
    />,
  );
  await screen.findByRole("region", { name: "Board" });
  return user;
}

function listOf(column: string) {
  return screen.getByRole("list", { name: column });
}

function keysIn(column: string): string[] {
  return within(listOf(column))
    .getAllByRole("listitem")
    .map((item) => /OPA-\d+/.exec(item.textContent)?.[0] ?? "");
}

async function chooseMenuItem(user: ReturnType<typeof userEvent.setup>, key: string, item: string) {
  await user.click(screen.getByRole("button", { name: `Actions for ${key}` }));
  await user.click(await screen.findByRole("menuitem", { name: item }));
}

beforeEach(() => {
  installFetch();
});

describe("Board: loading", () => {
  it("shows a placeholder, then the columns in order with their cards in order", async () => {
    register();
    render(<Board project={project()} canWrite archived={false} />);
    expect(screen.getByText("Loading the board…")).toBeInTheDocument();

    await screen.findByRole("region", { name: "Board" });

    expect(
      screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(["To do", "In progress", "Done"]);
    expect(
      within(screen.getByRole("region", { name: "Board" }))
        .getAllByLabelText(/ cards?$/)
        .map((count) => count.getAttribute("aria-label")),
    ).toEqual(["2 cards", "1 card", "1 card"]);
    expect(keysIn("To do")).toEqual(["OPA-1", "OPA-2"]);
    expect(keysIn("In progress")).toEqual(["OPA-3"]);
  });

  it("follows every page of tasks", async () => {
    on(`GET ${BASE}/columns`, () => Response.json({ items: columns, nextCursor: null }));
    on(TASKS, respondWith([t1], "C1"));
    on(`${TASKS}&cursor=C1`, respondWith([t2], "C2"));
    on(`${TASKS}&cursor=C2`, respondWith([t3]));
    render(<Board project={project()} canWrite archived={false} />);

    await screen.findByRole("region", { name: "Board" });

    expect(keysIn("To do")).toEqual(["OPA-1", "OPA-2"]);
    expect(keysIn("In progress")).toEqual(["OPA-3"]);
  });

  it("says it could not load, retries, and Reload loads again", async () => {
    on(`GET ${BASE}/columns`, () => problem(500, { code: "internal_error" }));
    const user = userEvent.setup();
    render(<Board project={project()} canWrite archived={false} />);
    expect(await screen.findByText("Could not load the board.")).toBeInTheDocument();

    register();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("region", { name: "Board" });

    on(TASKS, respondWith([t1]));
    await user.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() => {
      expect(keysIn("To do")).toEqual(["OPA-1"]);
    });
  });
});

describe("Board: cards", () => {
  it("show key, title, a type badge only for bugs and stories, assignee, team and epic", async () => {
    await renderBoard();

    const [first] = within(listOf("To do")).getAllByRole("listitem");
    expect(first).toHaveTextContent("OPA-1");
    expect(first).toHaveTextContent("Fix login");
    expect(first?.textContent).not.toContain("Bug");
    expect(within(listOf("To do")).getByText("Bug")).toBeInTheDocument();
    expect(within(listOf("Done")).getByText("Story")).toBeInTheDocument();
    const third = within(listOf("In progress")).getByRole("listitem");
    expect(within(third).getByText("Mia")).toBeInTheDocument();
    expect(within(third).getByText("Platform")).toBeInTheDocument();
    expect(within(third).getByText("Auth")).toBeInTheDocument();
  });

  it("marks an assignee whose account is deactivated", async () => {
    const gone = task("OPA-7", "Orphan", TODO, {
      assignee: { id: "44444444-4444-4444-8444-444444444444", name: "Max", active: false },
    });
    await renderBoard({ tasks: [gone] });

    expect(within(listOf("To do")).getByText("Deactivated")).toBeInTheDocument();
  });

  it("are not links yet", async () => {
    await renderBoard();

    expect(within(listOf("To do")).queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("Board: adding a task", () => {
  it("posts the title and column, shows the card at the end, clears the field and keeps focus", async () => {
    const user = await renderBoard();
    const created = task("OPA-5", "New one", DOING);
    on(`POST ${BASE}/tasks`, () => Response.json(fullTask(created), { status: 201 }));
    const field = screen.getByRole("textbox", { name: "Add a task to In progress" });

    await user.type(field, "  New one  {Enter}");

    await waitFor(() => {
      expect(keysIn("In progress")).toEqual(["OPA-3", "OPA-5"]);
    });
    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({ title: "New one", columnId: DOING });
    expect(field).toHaveValue("");
    expect(field).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Added OPA-5.");
  });

  it("refuses a blank title without a request", async () => {
    const user = await renderBoard();

    await user.type(screen.getByRole("textbox", { name: "Add a task to To do" }), "   ");
    await user.click(screen.getByRole("button", { name: "Add to To do" }));

    expect(calls("POST")).toHaveLength(0);
    expect(screen.getByRole("status")).toHaveTextContent("Enter a title.");
  });

  it("says when adding failed, and that the project is archived on 409", async () => {
    const user = await renderBoard();
    const field = screen.getByRole("textbox", { name: "Add a task to To do" });

    on(`POST ${BASE}/tasks`, () => problem(500, { code: "internal_error" }));
    await user.type(field, "One{Enter}");
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Could not add the task. Try again.");
    });
    expect(field).toHaveValue("One");

    on(`POST ${BASE}/tasks`, () => problem(409, { code: "project_archived" }));
    await user.type(field, "{Enter}");
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "The project is archived, so the board is read-only.",
      );
    });
  });
});

describe("Board: the move menu", () => {
  it("offers Move to for the other columns, and no Move up on the first card or Move down on the last", async () => {
    const user = await renderBoard();

    await user.click(screen.getByRole("button", { name: "Actions for OPA-1" }));
    const items = (await screen.findAllByRole("menuitem")).map((item) => item.textContent);

    expect(items).toEqual(["Move to In progress", "Move to Done", "Move down"]);
  });

  it("moves a card to another column, after the last card there, with its version", async () => {
    const user = await renderBoard();
    on(`POST /api/v1/tasks/OPA-1/move`, () =>
      Response.json(fullTask(t1, { columnId: DOING, version: 2 })),
    );

    await chooseMenuItem(user, "OPA-1", "Move to In progress");

    await waitFor(() => {
      expect(keysIn("In progress")).toEqual(["OPA-3", "OPA-1"]);
    });
    expect(keysIn("To do")).toEqual(["OPA-2"]);
    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({
      columnId: DOING,
      afterTaskId: t3.id,
      version: 1,
    });
    expect(screen.getByRole("status")).toHaveTextContent("Moved OPA-1 to In progress.");
  });

  it("moves a card down after its neighbour and up before it", async () => {
    const user = await renderBoard();
    on(`POST /api/v1/tasks/OPA-1/move`, () => Response.json(fullTask(t1, { version: 2 })));
    await chooseMenuItem(user, "OPA-1", "Move down");
    await waitFor(() => {
      expect(keysIn("To do")).toEqual(["OPA-2", "OPA-1"]);
    });
    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({
      columnId: TODO,
      afterTaskId: t2.id,
      version: 1,
    });

    on(`POST /api/v1/tasks/OPA-2/move`, () => Response.json(fullTask(t2, { version: 2 })));
    await chooseMenuItem(user, "OPA-1", "Move up");
    await waitFor(() => {
      expect(keysIn("To do")).toEqual(["OPA-1", "OPA-2"]);
    });
  });

  it("sends the new version on the next move of the same card", async () => {
    const user = await renderBoard();
    on(`POST /api/v1/tasks/OPA-1/move`, () =>
      Response.json(fullTask(t1, { columnId: DOING, version: 2 })),
    );
    await chooseMenuItem(user, "OPA-1", "Move to In progress");
    await waitFor(() => {
      expect(keysIn("In progress")).toContain("OPA-1");
    });

    on(`POST /api/v1/tasks/OPA-1/move`, () =>
      Response.json(fullTask(t1, { columnId: DONE, version: 3 })),
    );
    await chooseMenuItem(user, "OPA-1", "Move to Done");

    await waitFor(() => {
      expect(calls("POST")).toHaveLength(2);
    });
    expect(bodyOf(calls("POST")[1]?.[1])).toMatchObject({ columnId: DONE, version: 2 });
  });

  it("disables the menus while a move is in flight", async () => {
    const user = await renderBoard();
    let answer: (response: Response) => void = () => undefined;
    on(`POST /api/v1/tasks/OPA-1/move`, () => {
      throw new Error("answered by the pending promise");
    });
    // A response that arrives later: replace the fetch of this one request.
    const original = globalThis.fetch;
    const pending = new Promise<Response>((resolve) => {
      answer = resolve;
    });
    globalThis.fetch = (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      init?.method === "POST" ? pending : original(input, init);

    await chooseMenuItem(user, "OPA-1", "Move to In progress");

    expect(screen.getByRole("button", { name: "Actions for OPA-2" })).toBeDisabled();
    answer(Response.json(fullTask(t1, { columnId: DOING, version: 2 })));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Actions for OPA-2" })).toBeEnabled();
    });
    globalThis.fetch = original;
  });
});

describe("Board: a move that fails", () => {
  it("puts the card back and says so", async () => {
    const user = await renderBoard();
    on(`POST /api/v1/tasks/OPA-1/move`, () => problem(500, { code: "internal_error" }));

    await chooseMenuItem(user, "OPA-1", "Move to In progress");

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Could not move the task. It is back where it was.",
      );
    });
    expect(keysIn("To do")).toEqual(["OPA-1", "OPA-2"]);
    expect(keysIn("In progress")).toEqual(["OPA-3"]);
  });

  it("reloads the board on a version conflict", async () => {
    const user = await renderBoard();
    on(`POST /api/v1/tasks/OPA-1/move`, () =>
      problem(409, { code: "version_conflict", current: fullTask(t1, { version: 5 }) }),
    );
    on(TASKS, respondWith([t2, t1, t3, t4]));

    await chooseMenuItem(user, "OPA-1", "Move to In progress");

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Someone else changed the board. It was reloaded.",
      );
    });
    expect(keysIn("To do")).toEqual(["OPA-2", "OPA-1"]);
  });

  it("reloads and says the project is archived on project_archived", async () => {
    const user = await renderBoard();
    on(`POST /api/v1/tasks/OPA-1/move`, () => problem(409, { code: "project_archived" }));

    await chooseMenuItem(user, "OPA-1", "Move to In progress");

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "The project is archived, so the board is read-only.",
      );
    });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Actions for OPA-1" })).not.toBeInTheDocument();
    });
  });
});

describe("Board: read only", () => {
  it("renders no add form, no menu and no drag handle for someone who cannot write", async () => {
    await renderBoard({ canWrite: false });

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Actions for/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Drag / })).not.toBeInTheDocument();
    expect(keysIn("To do")).toEqual(["OPA-1", "OPA-2"]);
  });

  it("is the same for an archived project, and says why", async () => {
    await renderBoard({ canWrite: true, archived: true });

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Actions for/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Drag / })).not.toBeInTheDocument();
    expect(screen.getByText("This project is archived, so the board is read-only.")).toBeVisible();
  });

  it("gives a writable board a drag handle on every card", async () => {
    await renderBoard();

    for (const key of ["OPA-1", "OPA-2", "OPA-3", "OPA-4"]) {
      expect(screen.getByRole("button", { name: `Drag ${key}` })).toBeInTheDocument();
    }
  });
});

describe("Board: accessibility", () => {
  it("has a named, focusable board region, named column lists and one status region", async () => {
    await renderBoard();

    const region = screen.getByRole("region", { name: "Board" });
    expect(region).toHaveAttribute("tabindex", "0");
    for (const name of ["To do", "In progress", "Done"]) {
      expect(within(region).getByRole("list", { name })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });
});
