import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  bodyOf,
  calls,
  fetchMock,
  hold,
  installFetch,
  on,
  problem,
  urlOf,
} from "@/components/fake-api";
import { ProjectEventsProvider } from "@/components/projects/project-events";
import { FakeSource } from "@/hooks/fake-event-source";
import type { ProjectEvent } from "@/lib/schemas/events";

import {
  bugLabel,
  COLUMNS,
  doing,
  done,
  full,
  json,
  LABELS,
  opa,
  page,
  PROJECT_ID,
  ref,
  task,
  TASKS,
  todo,
  uiLabel,
} from "./test-data";
import { useBoard } from "./use-board";

const t1 = task(1, todo.id);
const t2 = task(2, todo.id, { version: 4 });
const t3 = task(3, doing.id);

function keys(board: Readonly<Record<string, readonly { key: string }[]>>, columnId: string) {
  return (board[columnId] ?? []).map((item) => item.key);
}

function Provider({ children }: { children: ReactNode }) {
  return (
    <ProjectEventsProvider project={opa} setProject={vi.fn()}>
      {children}
    </ProjectEventsProvider>
  );
}

function mount(fallbackMs = 60_000) {
  const announce = vi.fn<(message: string) => void>();
  const onArchived = vi.fn<() => void>();
  const hook = renderHook(() => useBoard({ projectKey: "OPA", announce, onArchived, fallbackMs }), {
    wrapper: Provider,
  });
  return { ...hook, announce, onArchived };
}

/** Mounts the board, opens its events stream and waits for the first load. */
async function renderBoard() {
  const mounted = mount();
  act(() => {
    FakeSource.latest().open();
  });
  await waitFor(() => {
    expect(mounted.result.current.phase).toBe("ready");
  });
  return mounted;
}

function loads(): number {
  return calls("GET").filter(([url]) => url === "/api/v1/projects/OPA/columns").length;
}

function taskGets(): string[] {
  return calls("GET")
    .map(([url]) => url)
    .filter((url) => url.startsWith("/api/v1/tasks/") || url.includes("columnId="));
}

const COLUMN_TASKS = (columnId: string) => `${TASKS}&columnId=${columnId}`;

function event(type: ProjectEvent["type"], entityId: string, version: number | null) {
  const entity = type.split(".")[0];
  return {
    id: crypto.randomUUID(),
    type,
    projectId: PROJECT_ID,
    entity,
    entityId: type === "project.changed" ? PROJECT_ID : entityId,
    version,
    actorAccountId: "55555555-5555-4555-8555-555555555555",
    at: "2026-11-18T10:00:00.000Z",
    ...(type === "comment.created" ? { taskId: t1.id } : {}),
  };
}

function send(type: ProjectEvent["type"], entityId: string, version: number | null) {
  act(() => {
    FakeSource.latest().send(type, event(type, entityId, version));
  });
}

beforeEach(() => {
  installFetch();
  FakeSource.all = [];
  vi.stubGlobal("EventSource", FakeSource);
  on(COLUMNS, page([todo, doing, done]));
  on(TASKS, page([t1, t2, t3]));
});

describe("useBoard: loading", () => {
  it("loads columns and tasks and groups them by column in board order", async () => {
    const { result } = await renderBoard();

    expect(result.current.columns.map((item) => item.name)).toEqual([
      "To do",
      "In progress",
      "Done",
    ]);
    expect(keys(result.current.board, todo.id)).toEqual(["OPA-1", "OPA-2"]);
    expect(keys(result.current.board, doing.id)).toEqual(["OPA-3"]);
    expect(keys(result.current.board, done.id)).toEqual([]);
  });

  it("follows nextCursor until it is null", async () => {
    on(TASKS, page([t1], "c1"));
    on(`${TASKS}&cursor=c1`, page([t2], "c 2"));
    on(`${TASKS}&cursor=c%202`, page([t3]));

    const { result } = await renderBoard();

    expect(keys(result.current.board, todo.id)).toEqual(["OPA-1", "OPA-2"]);
    expect(keys(result.current.board, doing.id)).toEqual(["OPA-3"]);
  });

  it("reports an error, and loads again on reload", async () => {
    on(TASKS, problem(500, "internal_error"));
    const { result } = mount();
    act(() => {
      FakeSource.latest().open();
    });
    await waitFor(() => {
      expect(result.current.phase).toBe("error");
    });

    on(TASKS, page([t1]));
    await act(() => result.current.reload());

    expect(result.current.phase).toBe("ready");
    expect(keys(result.current.board, todo.id)).toEqual(["OPA-1"]);
  });
});

describe("useBoard: adding", () => {
  it("appends an added task at the end of its column", async () => {
    const { result } = await renderBoard();

    act(() => {
      result.current.added(full(task(4, todo.id)));
    });

    expect(keys(result.current.board, todo.id)).toEqual(["OPA-1", "OPA-2", "OPA-4"]);
  });
});

describe("useBoard: moving", () => {
  it("places the card at once, sends the move, and takes the returned version", async () => {
    let answer: (response: Response) => void = () => undefined;
    const { result } = await renderBoard();
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );

    let drop: Promise<void> = Promise.resolve();
    act(() => {
      drop = result.current.drop(t2.id, doing.id, 0);
    });

    expect(keys(result.current.board, doing.id)).toEqual(["OPA-2", "OPA-3"]);
    expect(result.current.moving).toBe(true);
    const [url, init] = calls("POST")[0] ?? [];
    expect(url).toBe(`/api/v1/tasks/${t2.id}/move`);
    expect(bodyOf(init)).toEqual({ columnId: doing.id, beforeTaskId: t3.id, version: 4 });

    await act(async () => {
      answer(Response.json(full(t2, { columnId: doing.id, version: 5 })));
      await drop;
    });

    expect(result.current.moving).toBe(false);
    expect(result.current.board[doing.id]?.[0]).toMatchObject({ key: "OPA-2", version: 5 });
    expect(result.current.board[doing.id]?.[0]).not.toHaveProperty("description");
  });

  it("places its own move within a column without reading the column (WS-113)", async () => {
    on(`POST /api/v1/tasks/${t1.id}/move`, json(full(t1, { version: 2 })));
    const { result } = await renderBoard();

    await act(() => result.current.drop(t1.id, todo.id, 1));

    expect(keys(result.current.board, todo.id)).toEqual(["OPA-2", "OPA-1"]);
    expect(result.current.board[todo.id]?.[1]).toMatchObject({ version: 2 });
    expect(taskGets()).toEqual([]);
  });

  it("sends nothing when the card is dropped on its own place", async () => {
    const { result } = await renderBoard();

    await act(() => result.current.drop(t2.id, todo.id, 1));

    expect(calls("POST")).toEqual([]);
  });

  it.each([
    [problem(409, "version_conflict"), "Someone else changed OPA-2. The board was refreshed."],
    [problem(409, "project_archived"), "The project is archived."],
    [problem(404, "not_found"), "OPA-2 no longer exists. The board was refreshed."],
    [problem(500, "internal_error"), "Could not move OPA-2. The board was refreshed."],
  ])("reloads the whole board after a failed move and explains it", async (answer, message) => {
    on(`POST /api/v1/tasks/${t2.id}/move`, answer);
    const { result, announce } = await renderBoard();
    expect(loads()).toBe(1);

    await act(() => result.current.drop(t2.id, done.id, 0));

    expect(loads()).toBe(2);
    expect(keys(result.current.board, todo.id)).toEqual(["OPA-1", "OPA-2"]);
    expect(keys(result.current.board, done.id)).toEqual([]);
    expect(announce).toHaveBeenCalledWith(message);
    expect(result.current.moving).toBe(false);
  });

  it("reloads after a network failure too", async () => {
    const { result, announce } = await renderBoard();
    fetchMock.mockImplementationOnce(() => Promise.reject(new TypeError("offline")));

    await act(() => result.current.drop(t2.id, done.id, 0));

    expect(loads()).toBe(2);
    expect(announce).toHaveBeenCalledWith("Could not move OPA-2. The board was refreshed.");
  });

  it("tells the page when the project turned out to be archived", async () => {
    on(`POST /api/v1/tasks/${t2.id}/move`, problem(409, "project_archived"));
    const { result, onArchived } = await renderBoard();

    await act(() => result.current.drop(t2.id, done.id, 0));

    expect(onArchived).toHaveBeenCalledOnce();
  });
});

describe("useBoard: changes made in the task detail (WS-038 section 4)", () => {
  function dispatch(name: string, detail: unknown) {
    act(() => {
      window.dispatchEvent(new CustomEvent(name, { detail }));
    });
  }

  it("replaces a changed task in place", async () => {
    const { result } = await renderBoard();

    dispatch("opanel:task-changed", full({ ...t2, title: "Renamed", version: 5 }));

    expect(keys(result.current.board, todo.id)).toEqual(["OPA-1", "OPA-2"]);
    expect(result.current.board[todo.id]?.[1]).toMatchObject({ title: "Renamed", version: 5 });
    expect(result.current.board[todo.id]?.[1]).not.toHaveProperty("description");
  });

  it("moves a task that changed column to the end of that column", async () => {
    const { result } = await renderBoard();

    dispatch("opanel:task-changed", full({ ...t1, columnId: doing.id, version: 2 }));

    expect(keys(result.current.board, todo.id)).toEqual(["OPA-2"]);
    expect(keys(result.current.board, doing.id)).toEqual(["OPA-3", "OPA-1"]);
  });

  it("removes a deleted task", async () => {
    const { result } = await renderBoard();

    dispatch("opanel:task-deleted", { id: t1.id });

    expect(keys(result.current.board, todo.id)).toEqual(["OPA-2"]);
  });

  it("removes a task moved to the backlog (WS-101)", async () => {
    const { result } = await renderBoard();

    dispatch("opanel:task-changed", full({ ...t1, columnId: null, version: 2 }));

    expect(keys(result.current.board, todo.id)).toEqual(["OPA-2"]);
    expect(consistent(result.current.board)).toBe(true);
  });

  it("ignores unknown tasks and malformed events", async () => {
    const { result } = await renderBoard();
    const before = result.current.board;

    dispatch("opanel:task-changed", full(task(9, todo.id)));
    dispatch("opanel:task-changed", { nonsense: true });
    dispatch("opanel:task-deleted", { id: "not a uuid" });

    expect(result.current.board).toEqual(before);
  });
});

describe("useBoard: the first load waits for the events stream (WS-048 section 3)", () => {
  it("loads at once when the page's stream is already open (WS-049 section 2)", async () => {
    function Probe() {
      const { phase } = useBoard({ projectKey: "OPA", announce: vi.fn(), onArchived: vi.fn() });
      return <p>{phase}</p>;
    }
    function Page({ shown }: { shown: boolean }) {
      return <Provider>{shown && <Probe />}</Provider>;
    }
    const { rerender } = render(<Page shown={false} />);
    act(() => {
      FakeSource.latest().open();
    });

    rerender(<Page shown />);

    expect(await screen.findByText("ready")).toBeInTheDocument();
    expect(loads()).toBe(1);
    expect(FakeSource.all).toHaveLength(1);
  });

  it("opens the project's stream and loads only once it is open", async () => {
    const { result } = mount();

    expect(FakeSource.latest().url).toBe(`/api/v1/projects/${PROJECT_ID}/events`);
    expect(loads()).toBe(0);
    expect(result.current.phase).toBe("loading");

    act(() => {
      FakeSource.latest().open();
    });
    await waitFor(() => {
      expect(result.current.phase).toBe("ready");
    });
    expect(loads()).toBe(1);
  });

  it("loads anyway when the stream has not opened in time, and reloads when it opens", async () => {
    const { result } = mount(10);
    await waitFor(() => {
      expect(result.current.phase).toBe("ready");
    });
    expect(loads()).toBe(1);

    act(() => {
      FakeSource.latest().open();
    });

    await waitFor(() => {
      expect(loads()).toBe(2);
    });
  });

  it("reloads the whole board after a reconnect", async () => {
    await renderBoard();

    act(() => {
      FakeSource.latest().drop();
      FakeSource.latest().open();
    });

    await waitFor(() => {
      expect(loads()).toBe(2);
    });
  });

  it("reports the stream's status", async () => {
    const { result } = await renderBoard();
    expect(result.current.live).toBe("live");

    act(() => {
      FakeSource.latest().refuse();
    });

    expect(result.current.live).toBe("paused");
  });
});

describe("useBoard: other people's changes (WS-048 section 4)", () => {
  it("ignores the echo of a version it already holds", async () => {
    await renderBoard();

    send("task.moved", t2.id, 4);
    send("task.updated", t2.id, 3);

    expect(taskGets()).toEqual([]);
  });

  it("replaces an updated card in place when it stays in its column", async () => {
    on(`GET /api/v1/tasks/${t2.id}`, json(full({ ...t2, title: "Renamed", version: 5 })));
    const { result } = await renderBoard();

    send("task.updated", t2.id, 5);

    await waitFor(() => {
      expect(result.current.board[todo.id]?.[1]).toMatchObject({ title: "Renamed", version: 5 });
    });
    expect(result.current.board[todo.id]?.[1]).not.toHaveProperty("description");
    expect(taskGets()).toEqual([`/api/v1/tasks/${t2.id}`]);
  });

  it("moves a card by reloading its new column, and takes it out of the old one", async () => {
    const moved = { ...t1, columnId: doing.id, version: 2 };
    on(`GET /api/v1/tasks/${t1.id}`, json(full(moved)));
    on(COLUMN_TASKS(doing.id), page([moved, t3]));
    const { result } = await renderBoard();

    send("task.moved", t1.id, 2);

    await waitFor(() => {
      expect(keys(result.current.board, doing.id)).toEqual(["OPA-1", "OPA-3"]);
    });
    expect(keys(result.current.board, todo.id)).toEqual(["OPA-2"]);
  });

  it("reorders a card moved within its column by reading that column (WS-113)", async () => {
    const moved = { ...t1, version: 2 };
    on(`GET /api/v1/tasks/${t1.id}`, json(full(moved)));
    on(COLUMN_TASKS(todo.id), page([t2, moved]));
    const { result } = await renderBoard();

    send("task.moved", t1.id, 2);

    await waitFor(() => {
      expect(keys(result.current.board, todo.id)).toEqual(["OPA-2", "OPA-1"]);
    });
    expect(taskGets()).toEqual([
      `/api/v1/tasks/${t1.id}`,
      COLUMN_TASKS(todo.id).slice("GET ".length),
    ]);
  });

  it("still reads the column when an update follows a move during the task's fetch (WS-113)", async () => {
    const release = hold(`GET /api/v1/tasks/${t1.id}`);
    const { result } = await renderBoard();

    send("task.updated", t1.id, 2);
    send("task.moved", t1.id, 3);
    send("task.updated", t1.id, 4);
    const latest = { ...t1, title: "Renamed", version: 4 };
    on(`GET /api/v1/tasks/${t1.id}`, json(full(latest)));
    on(COLUMN_TASKS(todo.id), page([t2, latest]));
    await act(() => release(json(full({ ...t1, version: 2 }))));

    await waitFor(() => {
      expect(keys(result.current.board, todo.id)).toEqual(["OPA-2", "OPA-1"]);
    });
    expect(result.current.board[todo.id]?.[1]).toMatchObject({ title: "Renamed", version: 4 });
  });

  it("removes a card whose task moved to the backlog, reading no column (WS-101)", async () => {
    const moved = { ...t1, columnId: null, version: 2 };
    on(`GET /api/v1/tasks/${t1.id}`, json(full(moved)));
    const { result } = await renderBoard();

    send("task.moved", t1.id, 2);

    await waitFor(() => {
      expect(keys(result.current.board, todo.id)).toEqual(["OPA-2"]);
    });
    expect(consistent(result.current.board)).toBe(true);
  });

  it("shows a created or restored task in its place in its column", async () => {
    const created = task(4, todo.id);
    on(`GET /api/v1/tasks/${created.id}`, json(full(created)));
    on(COLUMN_TASKS(todo.id), page([t1, created, t2]));
    const { result } = await renderBoard();

    send("task.created", created.id, 1);

    await waitFor(() => {
      expect(keys(result.current.board, todo.id)).toEqual(["OPA-1", "OPA-4", "OPA-2"]);
    });

    const restored = task(5, doing.id, { version: 3 });
    on(`GET /api/v1/tasks/${restored.id}`, json(full(restored)));
    on(COLUMN_TASKS(doing.id), page([t3, restored]));

    send("task.restored", restored.id, 3);

    await waitFor(() => {
      expect(keys(result.current.board, doing.id)).toEqual(["OPA-3", "OPA-5"]);
    });
  });

  it("removes a deleted card without asking the server", async () => {
    const { result } = await renderBoard();

    send("task.deleted", t1.id, 2);

    expect(keys(result.current.board, todo.id)).toEqual(["OPA-2"]);
    expect(taskGets()).toEqual([]);
  });

  it("removes a card whose task turns out deleted or gone", async () => {
    on(
      `GET /api/v1/tasks/${t1.id}`,
      json(full({ ...t1, version: 2, deletedAt: "2026-11-18T10:00:00.000Z" })),
    );
    on(`GET /api/v1/tasks/${t2.id}`, problem(404, "not_found"));
    const { result } = await renderBoard();

    send("task.updated", t1.id, 2);
    send("task.updated", t2.id, 5);

    await waitFor(() => {
      expect(keys(result.current.board, todo.id)).toEqual([]);
    });
  });

  it("reloads the whole board when a column changes", async () => {
    await renderBoard();

    send("column.changed", doing.id, 2);

    await waitFor(() => {
      expect(loads()).toBe(2);
    });
  });

  it("leaves a project change to the frame (WS-049 section 2)", async () => {
    await renderBoard();

    send("project.changed", PROJECT_ID, opa.version);

    expect(calls("GET")).toHaveLength(2);
  });

  it("does nothing for comments and epics, which a card does not show", async () => {
    await renderBoard();

    send("comment.created", "99999999-9999-4999-8999-999999999999", null);
    send("epic.changed", "99999999-9999-4999-8999-999999999999", 2);

    expect(calls("GET")).toHaveLength(2);
  });

  describe("label.changed (WS-108)", () => {
    const labelled = task(1, todo.id, { labels: [ref(bugLabel), ref(uiLabel)] });
    const alsoBug = task(2, todo.id, { labels: [ref(bugLabel)] });

    function labelsOf(board: Readonly<Record<string, readonly { labels: unknown }[]>>) {
      return (board[todo.id] ?? []).map((item) => item.labels);
    }

    function labelReads(): number {
      return calls("GET").filter(([url]) => url === "/api/v1/projects/OPA/labels").length;
    }

    it("reads the labels once and rewrites the cards, without loading the tasks again", async () => {
      on(TASKS, page([labelled, alsoBug, t3]));
      const { result } = await renderBoard();
      const tasksBefore = calls("GET").filter(([url]) => url.startsWith(TASKS.slice(4))).length;
      // UI was deleted; Bug was renamed and recoloured.
      on(LABELS, page([{ ...bugLabel, name: "Defect", colour: "pink", version: 2 }]));

      send("label.changed", uiLabel.id, null);

      const defect = { id: bugLabel.id, name: "Defect", colour: "pink" };
      await waitFor(() => {
        expect(labelsOf(result.current.board)).toEqual([[defect], [defect]]);
      });
      expect(labelReads()).toBe(1);
      expect(loads()).toBe(1);
      expect(calls("GET").filter(([url]) => url.startsWith(TASKS.slice(4))).length).toBe(
        tasksBefore,
      );
    });

    it("waits while a drag is in progress", async () => {
      on(TASKS, page([labelled, t3]));
      const { result } = await renderBoard();
      on(LABELS, page([bugLabel]));
      act(() => {
        result.current.hold(true);
      });

      send("label.changed", uiLabel.id, null);
      expect(labelReads()).toBe(0);
      act(() => {
        result.current.hold(false);
      });

      await waitFor(() => {
        expect(labelsOf(result.current.board)).toEqual([[ref(bugLabel)]]);
      });
    });
  });
});

describe("useBoard: events during a drag or a move (WS-048 section 5)", () => {
  it("holds events while a drag is in progress, and applies them once it ends", async () => {
    const { result } = await renderBoard();

    act(() => {
      result.current.hold(true);
    });
    send("task.deleted", t1.id, 2);
    expect(keys(result.current.board, todo.id)).toEqual(["OPA-1", "OPA-2"]);

    act(() => {
      result.current.hold(false);
    });

    expect(keys(result.current.board, todo.id)).toEqual(["OPA-2"]);
  });

  it("holds events while a move is being saved", async () => {
    let answer: (response: Response) => void = () => undefined;
    const { result } = await renderBoard();
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    let drop: Promise<void> = Promise.resolve();
    act(() => {
      drop = result.current.drop(t2.id, doing.id, 0);
    });

    send("task.deleted", t1.id, 2);
    expect(keys(result.current.board, todo.id)).toEqual(["OPA-1"]);

    await act(async () => {
      answer(Response.json(full(t2, { columnId: doing.id, version: 5 })));
      await drop;
    });

    expect(keys(result.current.board, todo.id)).toEqual([]);
    expect(keys(result.current.board, doing.id)).toEqual(["OPA-2", "OPA-3"]);
  });

  it("reloads once instead of applying more than 200 held events", async () => {
    const { result } = await renderBoard();
    act(() => {
      result.current.hold(true);
    });
    for (let i = 0; i < 201; i++) send("task.deleted", t1.id, 2);

    act(() => {
      result.current.hold(false);
    });

    await waitFor(() => {
      expect(loads()).toBe(2);
    });
  });
});

/**
 * Makes the next request for `key` ("GET /api/v1/...") wait until the test answers it;
 * later requests for it answer from `on()` (WS-082).
 */
function deferNext(key: string): (response: () => Response) => Promise<void> {
  let release: (response: Response) => void = () => undefined;
  const pending = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const previous = fetchMock.getMockImplementation();
  let used = false;
  fetchMock.mockImplementation((input, init) => {
    if (!used && `${init?.method ?? "GET"} ${urlOf(input)}` === key) {
      used = true;
      return pending;
    }
    return previous?.(input, init) ?? Promise.reject(new Error("no fetch"));
  });
  return async (response) => {
    await act(async () => {
      release(response());
      await settle();
    });
  };
}

/** Lets pending promises and zero timers run. */
async function settle() {
  for (let round = 0; round < 5; round++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** Every card is in the column its own `columnId` names. */
function consistent(
  board: Readonly<Record<string, readonly { columnId: string | null }[]>>,
): boolean {
  return Object.entries(board).every(([columnId, items]) =>
    items.every((item) => item.columnId === columnId),
  );
}

const MOVE_T2 = `POST /api/v1/tasks/${t2.id}/move`;
const t2Moved = { ...t2, columnId: doing.id, version: 5 };

/** Starts a move of OPA-2 to the top of "In progress" whose answer the test releases. */
function pendingMove(result: { current: ReturnType<typeof useBoard> }) {
  const answer = deferNext(MOVE_T2);
  let drop: Promise<void> = Promise.resolve();
  act(() => {
    drop = result.current.drop(t2.id, doing.id, 0);
  });
  return async (response: () => Response) => {
    await answer(response);
    await act(() => drop);
  };
}

describe("useBoard: loads around drags and moves (WS-082)", () => {
  const triggers = {
    reconnect: async () => {
      const mounted = await renderBoard();
      return {
        ...mounted,
        trigger: () => {
          act(() => {
            FakeSource.latest().drop();
            FakeSource.latest().open();
          });
        },
      };
    },
    "first open after the fallback load": async () => {
      const mounted = mount(10);
      await waitFor(() => {
        expect(mounted.result.current.phase).toBe("ready");
      });
      return {
        ...mounted,
        trigger: () => {
          act(() => {
            FakeSource.latest().open();
          });
        },
      };
    },
  };

  it.each(Object.keys(triggers) as (keyof typeof triggers)[])(
    "a %s during a move loads nothing until the move ends, then loads once (test 1)",
    async (name) => {
      const { result, trigger } = await triggers[name]();
      const answer = pendingMove(result);

      trigger();
      await act(settle);
      expect(loads()).toBe(1);

      on(TASKS, page([t1, t2Moved, t3]));
      await answer(json(full(t2Moved)));

      await waitFor(() => {
        expect(loads()).toBe(2);
      });
      await act(settle);
      expect(loads()).toBe(2);
      expect(keys(result.current.board, doing.id)).toEqual(["OPA-2", "OPA-3"]);
      expect(consistent(result.current.board)).toBe(true);
    },
  );

  it.each(Object.keys(triggers) as (keyof typeof triggers)[])(
    "a %s answered with the board before the move never leaves a card in the wrong column (test 2)",
    async (name) => {
      const { result, trigger } = await triggers[name]();
      const answer = pendingMove(result);

      trigger();
      await act(settle);
      on(TASKS, page([t1, t2Moved, t3]));
      await answer(json(full(t2Moved)));
      await act(settle);

      expect(consistent(result.current.board)).toBe(true);
      expect(keys(result.current.board, doing.id)).toEqual(["OPA-2", "OPA-3"]);
    },
  );

  it("drops a load that was in flight when a drag started, and loads once after it (test 3)", async () => {
    const { result } = await renderBoard();
    const answer = deferNext(TASKS);

    send("column.changed", doing.id, 2);
    act(() => {
      result.current.hold(true);
    });
    await answer(page([t1]));

    expect(keys(result.current.board, todo.id)).toEqual(["OPA-1", "OPA-2"]);
    expect(loads()).toBe(2);

    on(TASKS, page([t1, t2]));
    act(() => {
      result.current.hold(false);
    });

    await waitFor(() => {
      expect(keys(result.current.board, doing.id)).toEqual([]);
    });
    expect(loads()).toBe(3);
  });

  it("runs one load at a time: a burst during a load costs one more (test 4)", async () => {
    const { result } = await renderBoard();
    const answer = deferNext(TASKS);

    send("column.changed", doing.id, 2);
    send("column.changed", doing.id, 3);
    send("column.changed", doing.id, 4);
    expect(loads()).toBe(2);

    on(TASKS, page([t1, t2]));
    await answer(page([t1, t2, t3]));
    await act(settle);

    expect(loads()).toBe(3);
    expect(keys(result.current.board, doing.id)).toEqual([]);
  });

  it("applies only the last load, whichever lands last (test 5)", async () => {
    const answer = deferNext(TASKS);
    const { result } = mount(10);
    await waitFor(() => {
      expect(loads()).toBe(1);
    });

    on(TASKS, page([t1, t2]));
    act(() => {
      FakeSource.latest().open();
    });
    // The open's reload has had every chance to start and land before the first load does.
    await act(settle);
    await answer(page([t1, t2, t3]));
    await act(settle);

    expect(result.current.phase).toBe("ready");
    expect(keys(result.current.board, doing.id)).toEqual([]);
    expect(keys(result.current.board, todo.id)).toEqual(["OPA-1", "OPA-2"]);
  });

  it("does not report the error of a load that a newer one replaces (test 6)", async () => {
    const answer = deferNext(TASKS);
    const { result } = mount();
    act(() => {
      FakeSource.latest().open();
    });
    await waitFor(() => {
      expect(loads()).toBe(1);
    });

    send("column.changed", doing.id, 2);
    await answer(problem(500, "internal_error"));
    await act(settle);

    expect(result.current.phase).toBe("ready");
    expect(keys(result.current.board, doing.id)).toEqual(["OPA-3"]);
  });
});

describe("useBoard: events during a load (WS-082)", () => {
  // A task.updated with the version held is read once for its progress only (WS-135
  // section 5): the card keeps every other field of the snapshot.
  it.each([
    ["holds the version", { ...t1, version: 2 }, [`/api/v1/tasks/${t1.id}`]],
    ["is older", t1, [`/api/v1/tasks/${t1.id}`]],
  ])(
    "holds an event until the load lands, then applies the version rule: the snapshot %s (test 7)",
    async (_, inSnapshot, expected) => {
      on(`GET /api/v1/tasks/${t1.id}`, json(full({ ...t1, title: "Renamed", version: 2 })));
      const { result } = await renderBoard();
      const answer = deferNext(TASKS);

      send("column.changed", doing.id, 2);
      send("task.updated", t1.id, 2);
      expect(taskGets()).toEqual([]);

      await answer(page([inSnapshot, t2, t3]));
      await act(settle);

      expect(taskGets()).toEqual(expected);
      expect(result.current.board[todo.id]?.[0]).toMatchObject({ version: 2 });
    },
  );

  it("does not lose an event that arrives during the first load (test 8)", async () => {
    const created = task(4, todo.id);
    on(`GET /api/v1/tasks/${created.id}`, json(full(created)));
    on(COLUMN_TASKS(todo.id), page([t1, t2, created]));
    const answer = deferNext(TASKS);
    const { result } = mount();
    act(() => {
      FakeSource.latest().open();
    });
    await waitFor(() => {
      expect(loads()).toBe(1);
    });

    send("task.created", created.id, 1);
    // Anything the event starts has had every chance to finish before the snapshot lands.
    await act(settle);
    await answer(page([t1, t2, t3]));

    await waitFor(() => {
      expect(keys(result.current.board, todo.id)).toEqual(["OPA-1", "OPA-2", "OPA-4"]);
    });
  });
});

describe("useBoard: the board stays consistent (WS-082)", () => {
  it("puts a move's answer in the column it names, even when a refresh answers during the move (test 9)", async () => {
    const t2v5 = { ...t2, version: 5 };
    const t2v6 = { ...t2, columnId: doing.id, version: 6 };
    on(COLUMN_TASKS(todo.id), page([t1, t2v5]));
    on(COLUMN_TASKS(doing.id), page([t2v6, t3]));
    const { result } = await renderBoard();
    const refreshed = deferNext(`GET /api/v1/tasks/${t2.id}`);
    send("task.updated", t2.id, 5);

    const answer = pendingMove(result);
    await refreshed(json(full(t2v5)));
    // Nothing changes under the move (WS-123 section 4): the card stays where it was dropped.
    expect(keys(result.current.board, todo.id)).toEqual(["OPA-1"]);
    expect(keys(result.current.board, doing.id)).toEqual(["OPA-2", "OPA-3"]);
    // The refresh is fetched again after the move, and the server now holds the move.
    on(`GET /api/v1/tasks/${t2.id}`, json(full(t2v6)));
    await answer(json(full(t2v6)));
    await act(settle);

    expect(keys(result.current.board, doing.id)).toEqual(["OPA-2", "OPA-3"]);
    expect(result.current.board[doing.id]?.[0]).toMatchObject({ version: 6 });
    expect(consistent(result.current.board)).toBe(true);
  });

  it("shows a task once when its event put it on the board before the answer (test 10)", async () => {
    const created = task(4, todo.id);
    on(`GET /api/v1/tasks/${created.id}`, json(full(created)));
    on(COLUMN_TASKS(todo.id), page([t1, t2, created]));
    const { result } = await renderBoard();
    send("task.created", created.id, 1);
    await waitFor(() => {
      expect(keys(result.current.board, todo.id)).toEqual(["OPA-1", "OPA-2", "OPA-4"]);
    });

    act(() => {
      result.current.added(full(created));
    });
    expect(keys(result.current.board, todo.id)).toEqual(["OPA-1", "OPA-2", "OPA-4"]);

    act(() => {
      result.current.added(full({ ...created, title: "Newer", version: 2 }));
    });
    expect(keys(result.current.board, todo.id)).toEqual(["OPA-1", "OPA-2", "OPA-4"]);
    expect(result.current.board[todo.id]?.[2]).toMatchObject({ title: "Newer", version: 2 });
  });

  it.each([3, 4])(
    "ignores a change from the task detail with version %i when the board holds 4 (test 11)",
    async (version) => {
      const { result } = await renderBoard();
      const before = result.current.board;

      act(() => {
        window.dispatchEvent(
          new CustomEvent("opanel:task-changed", {
            detail: full({ ...t2, title: "Renamed", version }),
          }),
        );
      });

      expect(result.current.board).toEqual(before);
    },
  );
});

describe("useBoard: the newest state wins (WS-123)", () => {
  function columnReads(columnId: string): number {
    return calls("GET").filter(([url]) => url.includes(`columnId=${columnId}`)).length;
  }

  /** OPA-1's move within "To do" starts a column read that the test answers later. */
  async function staleColumnRead() {
    const mounted = await renderBoard();
    const moved = { ...t1, version: 2 };
    on(`GET /api/v1/tasks/${t1.id}`, json(full(moved)));
    const answer = deferNext(COLUMN_TASKS(todo.id));
    send("task.moved", t1.id, 2);
    await waitFor(() => {
      expect(columnReads(todo.id)).toBe(1);
    });
    return { ...mounted, moved, answer };
  }

  it("does not apply a column read that a newer change overtook (test 4)", async () => {
    const { result, moved, answer } = await staleColumnRead();
    const renamed = { ...t2, title: "Renamed", version: 5 };
    on(`GET /api/v1/tasks/${t2.id}`, json(full(renamed)));
    send("task.updated", t2.id, 5);
    await waitFor(() => {
      expect(result.current.board[todo.id]?.[1]).toMatchObject({ version: 5 });
    });

    on(COLUMN_TASKS(todo.id), page([renamed, moved]));
    await answer(page([t2, moved]));

    expect(keys(result.current.board, todo.id)).toEqual(["OPA-2", "OPA-1"]);
    expect(result.current.board[todo.id]?.[0]).toMatchObject({ title: "Renamed", version: 5 });
    expect(columnReads(todo.id)).toBe(2);
  });

  it("does not bring back a card deleted before the old read returns (test 5)", async () => {
    const { result, moved, answer } = await staleColumnRead();
    send("task.deleted", t2.id, 5);
    expect(keys(result.current.board, todo.id)).toEqual(["OPA-1"]);

    on(COLUMN_TASKS(todo.id), page([moved]));
    await answer(page([t2, moved]));

    expect(keys(result.current.board, todo.id)).toEqual(["OPA-1"]);
  });

  it("does not bring back a card moved to another column before the old read returns (test 5)", async () => {
    const { result, moved, answer } = await staleColumnRead();
    const t2Elsewhere = { ...t2, columnId: doing.id, version: 5 };
    on(`GET /api/v1/tasks/${t2.id}`, json(full(t2Elsewhere)));
    on(COLUMN_TASKS(doing.id), page([t2Elsewhere, t3]));
    send("task.moved", t2.id, 5);
    await waitFor(() => {
      expect(keys(result.current.board, doing.id)).toEqual(["OPA-2", "OPA-3"]);
    });

    on(COLUMN_TASKS(todo.id), page([moved]));
    await answer(page([t2, moved]));

    expect(keys(result.current.board, todo.id)).toEqual(["OPA-1"]);
    expect(keys(result.current.board, doing.id)).toEqual(["OPA-2", "OPA-3"]);
  });

  it("applies no column read under a drag, and reads the column once it ends (test 6)", async () => {
    const { result, moved, answer } = await staleColumnRead();
    act(() => {
      result.current.hold(true);
    });

    await answer(page([t2, moved]));
    expect(keys(result.current.board, todo.id)).toEqual(["OPA-1", "OPA-2"]);

    on(COLUMN_TASKS(todo.id), page([t2, moved]));
    act(() => {
      result.current.hold(false);
    });

    await waitFor(() => {
      expect(keys(result.current.board, todo.id)).toEqual(["OPA-2", "OPA-1"]);
    });
    expect(columnReads(todo.id)).toBe(2);
  });

  it("applies no card fetched under a drag, and fetches it again once it ends (test 7)", async () => {
    const { result } = await renderBoard();
    const answer = deferNext(`GET /api/v1/tasks/${t2.id}`);
    send("task.updated", t2.id, 5);
    act(() => {
      result.current.hold(true);
    });

    const renamed = { ...t2, title: "Renamed", version: 5 };
    await answer(json(full(renamed)));
    expect(result.current.board[todo.id]?.[1]).toMatchObject({ title: t2.title, version: 4 });

    on(`GET /api/v1/tasks/${t2.id}`, json(full(renamed)));
    act(() => {
      result.current.hold(false);
    });

    await waitFor(() => {
      expect(result.current.board[todo.id]?.[1]).toMatchObject({ title: "Renamed", version: 5 });
    });
    expect(taskGets().filter((url) => url === `/api/v1/tasks/${t2.id}`)).toHaveLength(2);
  });

  it("shows a task listed twice during the load once, where its newest version is (test 8)", async () => {
    const t1Done = { ...t1, columnId: done.id, version: 2 };
    on(TASKS, page([t1, t2], "c1"));
    on(`${TASKS}&cursor=c1`, page([t3, t1Done]));

    const { result } = await renderBoard();

    expect(keys(result.current.board, todo.id)).toEqual(["OPA-2"]);
    expect(keys(result.current.board, done.id)).toEqual(["OPA-1"]);
    expect(result.current.board[done.id]?.[0]).toMatchObject({ version: 2 });
  });

  it("keeps the later of two equal versions listed during the load (test 8)", async () => {
    on(TASKS, page([t1, t2], "c1"));
    on(`${TASKS}&cursor=c1`, page([t3, { ...t1, columnId: done.id }]));

    const { result } = await renderBoard();

    expect(keys(result.current.board, todo.id)).toEqual(["OPA-2"]);
    expect(keys(result.current.board, done.id)).toEqual(["OPA-1"]);
  });

  it("shows a task listed twice by a column read once (test 9)", async () => {
    const { result } = await renderBoard();
    const moved = { ...t1, version: 2 };
    on(`GET /api/v1/tasks/${t1.id}`, json(full(moved)));
    on(COLUMN_TASKS(todo.id), page([t2, moved], "c1"));
    on(`${COLUMN_TASKS(todo.id)}&cursor=c1`, page([moved]));

    send("task.moved", t1.id, 2);

    await waitFor(() => {
      expect(keys(result.current.board, todo.id)).toEqual(["OPA-2", "OPA-1"]);
    });
  });
});

describe("useBoard: a parent's progress (WS-135 test 7)", () => {
  it("takes a parent's progress from a task.updated with the version it holds", async () => {
    on(`GET /api/v1/tasks/${t1.id}`, json(full({ ...t1, subtasks: { done: 1, total: 2 } })));
    const { result } = await renderBoard();

    send("task.updated", t1.id, t1.version);

    await waitFor(() => {
      expect(result.current.board[todo.id]?.[0]?.subtasks).toEqual({ done: 1, total: 2 });
    });
    expect(keys(result.current.board, todo.id)).toEqual(["OPA-1", "OPA-2"]);
    expect(taskGets()).toEqual([`/api/v1/tasks/${t1.id}`]);
  });

  it("keeps the card when the read finds a newer version, and places that as before", async () => {
    on(
      `GET /api/v1/tasks/${t1.id}`,
      json(full({ ...t1, title: "Renamed", version: 2, subtasks: { done: 0, total: 1 } })),
    );
    const { result } = await renderBoard();

    send("task.updated", t1.id, t1.version);

    await waitFor(() => {
      expect(result.current.board[todo.id]?.[0]).toMatchObject({
        title: "Renamed",
        version: 2,
        subtasks: { done: 0, total: 1 },
      });
    });
  });
});
