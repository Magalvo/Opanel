import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bodyOf, calls, fetchMock, installFetch, on, problem } from "@/components/fake-api";

import { COLUMNS, doing, done, full, page, task, TASKS, todo } from "./test-data";
import { useBoard } from "./use-board";

const t1 = task(1, todo.id);
const t2 = task(2, todo.id, { version: 4 });
const t3 = task(3, doing.id);

function keys(board: Record<string, { key: string }[]>, columnId: string): string[] {
  return (board[columnId] ?? []).map((item) => item.key);
}

async function renderBoard() {
  const announce = vi.fn<(message: string) => void>();
  const onArchived = vi.fn<() => void>();
  const hook = renderHook(() => useBoard({ projectKey: "OPA", announce, onArchived }));
  await waitFor(() => {
    expect(hook.result.current.phase).toBe("ready");
  });
  return { ...hook, announce, onArchived };
}

function loads(): number {
  return calls("GET").filter(([url]) => url === "/api/v1/projects/OPA/columns").length;
}

beforeEach(() => {
  installFetch();
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
    const { result } = renderHook(() =>
      useBoard({ projectKey: "OPA", announce: vi.fn(), onArchived: vi.fn() }),
    );
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
