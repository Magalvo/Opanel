import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bodyOf, calls, fetchMock, installFetch, on, problem } from "@/components/fake-api";
import { ProjectEventsProvider } from "@/components/projects/project-events";
import { FakeSource } from "@/hooks/fake-event-source";
import type { ProjectEvent } from "@/lib/schemas/events";

import {
  COLUMNS,
  doing,
  done,
  full,
  json,
  opa,
  page,
  PROJECT_ID,
  task,
  TASKS,
  todo,
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
