import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  todo,
  uiLabel,
} from "@/components/board/test-data";
import { bodyOf, calls, fetchMock, installFetch, on, problem, urlOf } from "@/components/fake-api";
import { ProjectEventsProvider } from "@/components/projects/project-events";
import { FakeSource } from "@/hooks/fake-event-source";
import type { ProjectEvent } from "@/lib/schemas/events";
import type { TaskSummary } from "@/lib/schemas/tasks";

import { useBacklog } from "./use-backlog";

const BACKLOG = "GET /api/v1/projects/OPA/backlog?limit=100";
const BACKLOG_URL = "/api/v1/projects/OPA/backlog?limit=100";

function inBacklog(number: number, extra: Partial<TaskSummary> = {}): TaskSummary {
  return task(number, "", { columnId: null, ...extra });
}

const t1 = inBacklog(1);
const t2 = inBacklog(2, { version: 4 });
const t3 = inBacklog(3);

function keys(tasks: readonly { key: string }[]) {
  return tasks.map((item) => item.key);
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
  const hook = renderHook(
    () => useBacklog({ projectKey: "OPA", announce, onArchived, fallbackMs }),
    { wrapper: Provider },
  );
  return { ...hook, announce, onArchived };
}

/** Mounts the backlog, opens its events stream and waits for the first load. */
async function renderBacklog() {
  const mounted = mount();
  act(() => {
    FakeSource.latest().open();
  });
  await waitFor(() => {
    expect(mounted.result.current.phase).toBe("ready");
  });
  return mounted;
}

/** How many times the backlog's first page was read. */
function loads(): number {
  return calls("GET").filter(([url]) => url === BACKLOG_URL).length;
}

function columnReads(): number {
  return calls("GET").filter(([url]) => url === "/api/v1/projects/OPA/columns").length;
}

function taskGets(): string[] {
  return calls("GET")
    .map(([url]) => url)
    .filter((url) => url.startsWith("/api/v1/tasks/"));
}

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
    at: "2026-11-23T10:00:00.000Z",
    ...(type === "comment.created" ? { taskId: t1.id } : {}),
  };
}

function send(type: ProjectEvent["type"], entityId: string, version: number | null) {
  act(() => {
    FakeSource.latest().send(type, event(type, entityId, version));
  });
}

/** Lets pending promises and zero timers run. */
async function settle() {
  for (let round = 0; round < 5; round++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * Makes the next request for `key` wait until the test answers it; later requests for it
 * answer from `on()` (as in the board's tests, WS-082).
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

beforeEach(() => {
  installFetch();
  FakeSource.all = [];
  vi.stubGlobal("EventSource", FakeSource);
  on(COLUMNS, page([todo, doing, done]));
  on(BACKLOG, page([t1, t2, t3]));
});

describe("useBacklog: loading", () => {
  it("loads the columns and the backlog in backlog order", async () => {
    const { result } = await renderBacklog();

    expect(result.current.columns.map((item) => item.name)).toEqual([
      "To do",
      "In progress",
      "Done",
    ]);
    expect(keys(result.current.tasks)).toEqual(["OPA-1", "OPA-2", "OPA-3"]);
  });

  it("follows nextCursor until it is null", async () => {
    on(BACKLOG, page([t1], "c1"));
    on(`${BACKLOG}&cursor=c1`, page([t2], "c 2"));
    on(`${BACKLOG}&cursor=c%202`, page([t3]));

    const { result } = await renderBacklog();

    expect(keys(result.current.tasks)).toEqual(["OPA-1", "OPA-2", "OPA-3"]);
  });

  it("reports an error, and loads again on reload", async () => {
    on(BACKLOG, problem(500, "internal_error"));
    const { result } = mount();
    act(() => {
      FakeSource.latest().open();
    });
    await waitFor(() => {
      expect(result.current.phase).toBe("error");
    });

    on(BACKLOG, page([t1]));
    await act(() => result.current.reload());

    expect(result.current.phase).toBe("ready");
    expect(keys(result.current.tasks)).toEqual(["OPA-1"]);
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

  it("reloads after a reconnect", async () => {
    await renderBacklog();

    act(() => {
      FakeSource.latest().drop();
      FakeSource.latest().open();
    });

    await waitFor(() => {
      expect(loads()).toBe(2);
    });
  });
});

describe("useBacklog: adding", () => {
  it("appends a task created in the backlog at its end", async () => {
    const { result } = await renderBacklog();

    act(() => {
      result.current.added(full(inBacklog(4)));
    });

    expect(keys(result.current.tasks)).toEqual(["OPA-1", "OPA-2", "OPA-3", "OPA-4"]);
    expect(result.current.tasks[3]).not.toHaveProperty("description");
  });

  it("shows a task once when its event put it in the backlog before the answer", async () => {
    const created = inBacklog(4);
    on(`GET /api/v1/tasks/${created.id}`, json(full(created)));
    const { result } = await renderBacklog();
    on(BACKLOG, page([t1, t2, t3, created]));

    send("task.created", created.id, 1);
    await waitFor(() => {
      expect(keys(result.current.tasks)).toEqual(["OPA-1", "OPA-2", "OPA-3", "OPA-4"]);
    });
    act(() => {
      result.current.added(full(created));
    });

    expect(keys(result.current.tasks)).toEqual(["OPA-1", "OPA-2", "OPA-3", "OPA-4"]);
  });

  it("does not show a task created on the board", async () => {
    const { result } = await renderBacklog();

    act(() => {
      result.current.added(full(task(4, todo.id)));
    });

    expect(keys(result.current.tasks)).toEqual(["OPA-1", "OPA-2", "OPA-3"]);
  });
});

describe("useBacklog: reordering (WS-109 section 3)", () => {
  it("places the row at once, sends the move to the backlog, and takes the returned version", async () => {
    const answer = deferNext(`POST /api/v1/tasks/${t3.id}/move`);
    const { result } = await renderBacklog();

    let drop: Promise<void> = Promise.resolve();
    act(() => {
      drop = result.current.drop(t3.id, 0);
    });

    expect(keys(result.current.tasks)).toEqual(["OPA-3", "OPA-1", "OPA-2"]);
    expect(result.current.moving).toBe(true);
    const [url, init] = calls("POST")[0] ?? [];
    expect(url).toBe(`/api/v1/tasks/${t3.id}/move`);
    expect(bodyOf(init)).toEqual({ columnId: null, beforeTaskId: t1.id, version: 1 });

    await answer(json(full({ ...t3, version: 2 })));
    await act(() => drop);

    expect(result.current.moving).toBe(false);
    expect(result.current.tasks[0]).toMatchObject({ key: "OPA-3", version: 2 });
    expect(result.current.tasks[0]).not.toHaveProperty("description");
    expect(loads()).toBe(1);
  });

  it("sends the task above as afterTaskId", async () => {
    on(`POST /api/v1/tasks/${t1.id}/move`, json(full({ ...t1, version: 2 })));
    const { result } = await renderBacklog();

    await act(() => result.current.drop(t1.id, 2));

    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({
      columnId: null,
      afterTaskId: t3.id,
      version: 1,
    });
    expect(keys(result.current.tasks)).toEqual(["OPA-2", "OPA-3", "OPA-1"]);
  });

  it("sends nothing when the row is dropped in its own place", async () => {
    const { result } = await renderBacklog();

    await act(() => result.current.drop(t2.id, 1));

    expect(calls("POST")).toEqual([]);
  });

  it.each([
    [problem(409, "version_conflict"), "Someone else changed OPA-3. The backlog was refreshed."],
    [problem(409, "project_archived"), "The project is archived."],
    [problem(404, "not_found"), "OPA-3 no longer exists. The backlog was refreshed."],
    [problem(500, "internal_error"), "Could not move OPA-3. The backlog was refreshed."],
  ])("reloads the backlog after a failed move and explains it", async (answer, message) => {
    on(`POST /api/v1/tasks/${t3.id}/move`, answer);
    const { result, announce } = await renderBacklog();

    await act(() => result.current.drop(t3.id, 0));

    expect(loads()).toBe(2);
    expect(keys(result.current.tasks)).toEqual(["OPA-1", "OPA-2", "OPA-3"]);
    expect(announce).toHaveBeenCalledWith(message);
    expect(result.current.moving).toBe(false);
  });

  it("tells the page when the project turned out to be archived", async () => {
    on(`POST /api/v1/tasks/${t3.id}/move`, problem(409, "project_archived"));
    const { result, onArchived } = await renderBacklog();

    await act(() => result.current.drop(t3.id, 0));

    expect(onArchived).toHaveBeenCalledOnce();
  });
});

describe("useBacklog: moving to the board (WS-109 section 4)", () => {
  it("sends the first column with no anchor, then removes the row and says where it went", async () => {
    const answer = deferNext(`POST /api/v1/tasks/${t2.id}/move`);
    const { result, announce } = await renderBacklog();

    let moved: Promise<boolean> = Promise.resolve(false);
    act(() => {
      moved = result.current.moveToBoard(t2.id);
    });

    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({ columnId: todo.id, version: 4 });
    expect(result.current.sending).toBe(t2.id);
    expect(keys(result.current.tasks)).toEqual(["OPA-1", "OPA-2", "OPA-3"]);

    await answer(json(full({ ...t2, columnId: todo.id, version: 5 })));

    await expect(moved).resolves.toBe(true);
    expect(result.current.sending).toBeNull();
    expect(keys(result.current.tasks)).toEqual(["OPA-1", "OPA-3"]);
    expect(announce).toHaveBeenCalledWith("OPA-2 was moved to To do.");
  });

  it("reloads the backlog and explains a failure", async () => {
    on(`POST /api/v1/tasks/${t2.id}/move`, problem(409, "version_conflict"));
    const { result, announce } = await renderBacklog();

    let moved = true;
    await act(async () => {
      moved = await result.current.moveToBoard(t2.id);
    });

    expect(moved).toBe(false);
    expect(loads()).toBe(2);
    expect(keys(result.current.tasks)).toEqual(["OPA-1", "OPA-2", "OPA-3"]);
    expect(announce).toHaveBeenCalledWith("Someone else changed OPA-2. The backlog was refreshed.");
  });
});

describe("useBacklog: other people's changes (WS-109 section 6)", () => {
  it("ignores the echo of a version it already holds", async () => {
    await renderBacklog();

    send("task.moved", t2.id, 4);
    send("task.updated", t2.id, 3);

    expect(taskGets()).toEqual([]);
  });

  it("replaces an updated row in place while it stays in the backlog", async () => {
    on(`GET /api/v1/tasks/${t2.id}`, json(full({ ...t2, title: "Renamed", version: 5 })));
    const { result } = await renderBacklog();

    send("task.updated", t2.id, 5);

    await waitFor(() => {
      expect(result.current.tasks[1]).toMatchObject({ title: "Renamed", version: 5 });
    });
    expect(result.current.tasks[1]).not.toHaveProperty("description");
    expect(loads()).toBe(1);
  });

  it("reloads the backlog when a task in it was moved, for its new order", async () => {
    on(`GET /api/v1/tasks/${t3.id}`, json(full({ ...t3, version: 2 })));
    const { result } = await renderBacklog();
    on(BACKLOG, page([{ ...t3, version: 2 }, t1, t2]));

    send("task.moved", t3.id, 2);

    await waitFor(() => {
      expect(keys(result.current.tasks)).toEqual(["OPA-3", "OPA-1", "OPA-2"]);
    });
    expect(loads()).toBe(2);
  });

  it("removes a row whose task moved to the board, with no reload", async () => {
    on(`GET /api/v1/tasks/${t1.id}`, json(full({ ...t1, columnId: doing.id, version: 2 })));
    const { result } = await renderBacklog();

    send("task.moved", t1.id, 2);

    await waitFor(() => {
      expect(keys(result.current.tasks)).toEqual(["OPA-2", "OPA-3"]);
    });
    expect(loads()).toBe(1);
  });

  it("reloads the backlog when a task arrives in it from the board", async () => {
    const arrived = inBacklog(5, { version: 3 });
    on(`GET /api/v1/tasks/${arrived.id}`, json(full(arrived)));
    const { result } = await renderBacklog();
    on(BACKLOG, page([t1, t2, t3, arrived]));

    send("task.moved", arrived.id, 3);

    await waitFor(() => {
      expect(keys(result.current.tasks)).toEqual(["OPA-1", "OPA-2", "OPA-3", "OPA-5"]);
    });
  });

  it("only reads a task that moved on the board, and leaves the backlog alone", async () => {
    const onBoard = task(6, todo.id, { version: 2 });
    on(`GET /api/v1/tasks/${onBoard.id}`, json(full(onBoard)));
    const { result } = await renderBacklog();

    send("task.moved", onBoard.id, 2);
    send("task.updated", onBoard.id, 2);
    await act(settle);

    expect(taskGets().length).toBeGreaterThanOrEqual(1);
    expect(loads()).toBe(1);
    expect(keys(result.current.tasks)).toEqual(["OPA-1", "OPA-2", "OPA-3"]);
  });

  it("reloads the backlog for a task created or restored in it", async () => {
    const created = inBacklog(4);
    const restored = inBacklog(5, { version: 3 });
    on(`GET /api/v1/tasks/${created.id}`, json(full(created)));
    on(`GET /api/v1/tasks/${restored.id}`, json(full(restored)));
    const { result } = await renderBacklog();
    on(BACKLOG, page([created, t1, t2, t3]));

    send("task.created", created.id, 1);
    await waitFor(() => {
      expect(keys(result.current.tasks)).toEqual(["OPA-4", "OPA-1", "OPA-2", "OPA-3"]);
    });

    on(BACKLOG, page([created, t1, restored, t2, t3]));
    send("task.restored", restored.id, 3);
    await waitFor(() => {
      expect(keys(result.current.tasks)).toEqual(["OPA-4", "OPA-1", "OPA-5", "OPA-2", "OPA-3"]);
    });
  });

  it("removes a deleted row without asking the server", async () => {
    const { result } = await renderBacklog();

    send("task.deleted", t1.id, 2);

    expect(keys(result.current.tasks)).toEqual(["OPA-2", "OPA-3"]);
    expect(taskGets()).toEqual([]);
  });

  it("removes a row whose task turns out deleted or gone", async () => {
    on(
      `GET /api/v1/tasks/${t1.id}`,
      json(full({ ...t1, version: 2, deletedAt: "2026-11-23T10:00:00.000Z" })),
    );
    on(`GET /api/v1/tasks/${t2.id}`, problem(404, "not_found"));
    const { result } = await renderBacklog();

    send("task.updated", t1.id, 2);
    send("task.updated", t2.id, 5);

    await waitFor(() => {
      expect(keys(result.current.tasks)).toEqual(["OPA-3"]);
    });
  });

  it("reads the columns again when a column changes, and not the backlog", async () => {
    const { result } = await renderBacklog();
    on(COLUMNS, page([doing, todo, done]));

    send("column.changed", doing.id, 2);

    await waitFor(() => {
      expect(result.current.columns[0]?.name).toBe("In progress");
    });
    expect(columnReads()).toBe(2);
    expect(loads()).toBe(1);
  });

  it("leaves project changes to the frame, and ignores comments and epics", async () => {
    await renderBacklog();

    send("project.changed", PROJECT_ID, opa.version);
    send("comment.created", "99999999-9999-4999-8999-999999999999", null);
    send("epic.changed", "99999999-9999-4999-8999-999999999999", 2);

    expect(calls("GET")).toHaveLength(2);
  });

  it("rewrites the rows' labels from one read of the labels (WS-108)", async () => {
    on(BACKLOG, page([inBacklog(1, { labels: [ref(bugLabel), ref(uiLabel)] }), t2]));
    on(LABELS, page([{ ...bugLabel, name: "Defect", version: 2 }]));
    const { result } = await renderBacklog();

    send("label.changed", bugLabel.id, 2);

    await waitFor(() => {
      expect(result.current.tasks[0]?.labels).toEqual([
        { id: bugLabel.id, name: "Defect", colour: "red" },
      ]);
    });
    expect(loads()).toBe(1);
  });
});

describe("useBacklog: changes made in the task detail", () => {
  function dispatch(name: string, detail: unknown) {
    act(() => {
      window.dispatchEvent(new CustomEvent(name, { detail }));
    });
  }

  it("replaces a changed task in place while it stays in the backlog", async () => {
    const { result } = await renderBacklog();

    dispatch("opanel:task-changed", full({ ...t2, title: "Renamed", version: 5 }));

    expect(keys(result.current.tasks)).toEqual(["OPA-1", "OPA-2", "OPA-3"]);
    expect(result.current.tasks[1]).toMatchObject({ title: "Renamed", version: 5 });
  });

  it("removes a task moved to the board", async () => {
    const { result } = await renderBacklog();

    dispatch("opanel:task-changed", full({ ...t1, columnId: todo.id, version: 2 }));

    expect(keys(result.current.tasks)).toEqual(["OPA-2", "OPA-3"]);
  });

  it("reloads the backlog for a task moved into it", async () => {
    const arrived = inBacklog(7, { version: 2 });
    const { result } = await renderBacklog();
    on(BACKLOG, page([t1, t2, t3, arrived]));

    dispatch("opanel:task-changed", full(arrived));

    await waitFor(() => {
      expect(keys(result.current.tasks)).toEqual(["OPA-1", "OPA-2", "OPA-3", "OPA-7"]);
    });
  });

  it("removes a deleted task, and ignores an older version and tasks on the board", async () => {
    const { result } = await renderBacklog();

    dispatch("opanel:task-changed", full({ ...t2, title: "Old", version: 3 }));
    dispatch("opanel:task-changed", full(task(9, todo.id)));
    dispatch("opanel:task-deleted", { id: t1.id });

    expect(keys(result.current.tasks)).toEqual(["OPA-2", "OPA-3"]);
    expect(result.current.tasks[0]?.title).toBe("Task 2");
    expect(loads()).toBe(1);
  });
});

describe("useBacklog: events during a drag, a move or a load (WS-048, WS-082)", () => {
  it("holds events while a row is dragged, and applies them once it ends", async () => {
    const { result } = await renderBacklog();

    act(() => {
      result.current.hold(true);
    });
    send("task.deleted", t1.id, 2);
    expect(keys(result.current.tasks)).toEqual(["OPA-1", "OPA-2", "OPA-3"]);

    act(() => {
      result.current.hold(false);
    });

    expect(keys(result.current.tasks)).toEqual(["OPA-2", "OPA-3"]);
  });

  it("holds events while a move is being saved", async () => {
    const answer = deferNext(`POST /api/v1/tasks/${t3.id}/move`);
    const { result } = await renderBacklog();
    let drop: Promise<void> = Promise.resolve();
    act(() => {
      drop = result.current.drop(t3.id, 0);
    });

    send("task.deleted", t1.id, 2);
    expect(keys(result.current.tasks)).toEqual(["OPA-3", "OPA-1", "OPA-2"]);

    await answer(json(full({ ...t3, version: 2 })));
    await act(() => drop);

    expect(keys(result.current.tasks)).toEqual(["OPA-3", "OPA-2"]);
  });

  it("holds events while a task is being moved to the board", async () => {
    const answer = deferNext(`POST /api/v1/tasks/${t2.id}/move`);
    const { result } = await renderBacklog();
    let moved: Promise<boolean> = Promise.resolve(false);
    act(() => {
      moved = result.current.moveToBoard(t2.id);
    });

    send("task.deleted", t1.id, 2);
    expect(keys(result.current.tasks)).toEqual(["OPA-1", "OPA-2", "OPA-3"]);

    await answer(json(full({ ...t2, columnId: todo.id, version: 5 })));
    await act(() => moved);

    expect(keys(result.current.tasks)).toEqual(["OPA-3"]);
  });

  it("reloads once instead of applying more than 200 held events", async () => {
    const { result } = await renderBacklog();
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

  it("drops a load that was in flight when a drag started, and loads once after it", async () => {
    const { result } = await renderBacklog();
    const answer = deferNext(BACKLOG);

    act(() => {
      void result.current.reload();
    });
    act(() => {
      result.current.hold(true);
    });
    await answer(page([t1]));

    expect(keys(result.current.tasks)).toEqual(["OPA-1", "OPA-2", "OPA-3"]);
    expect(loads()).toBe(2);

    on(BACKLOG, page([t2, t3]));
    act(() => {
      result.current.hold(false);
    });

    await waitFor(() => {
      expect(keys(result.current.tasks)).toEqual(["OPA-2", "OPA-3"]);
    });
    expect(loads()).toBe(3);
  });

  it("runs one load at a time: a burst during a load costs one more", async () => {
    const { result } = await renderBacklog();
    const answer = deferNext(BACKLOG);

    act(() => {
      void result.current.reload();
    });
    act(() => {
      void result.current.reload();
    });
    act(() => {
      void result.current.reload();
    });
    expect(loads()).toBe(2);

    on(BACKLOG, page([t1, t2]));
    await answer(page([t1, t2, t3]));
    await act(settle);

    expect(loads()).toBe(3);
    expect(keys(result.current.tasks)).toEqual(["OPA-1", "OPA-2"]);
  });

  it("does not lose an event that arrives during the first load", async () => {
    const answer = deferNext(BACKLOG);
    const { result } = mount();
    act(() => {
      FakeSource.latest().open();
    });
    await act(settle);

    send("task.deleted", t1.id, 2);
    await answer(page([t1, t2, t3]));

    await waitFor(() => {
      expect(keys(result.current.tasks)).toEqual(["OPA-2", "OPA-3"]);
    });
  });
});
