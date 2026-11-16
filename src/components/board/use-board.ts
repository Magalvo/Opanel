"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiFailure } from "@/lib/api-client";
import type { Column } from "@/lib/schemas/columns";
import type { Task, TaskSummary } from "@/lib/schemas/tasks";

import { listAllTasks, listColumns, moveTask } from "./api";
import { applyDrop, type Board, groupByColumn, moveRequest, placeOf } from "./moves";

export type BoardPhase = "loading" | "error" | "ready";

function summaryOf(task: Task): TaskSummary {
  const { description: _description, ...summary } = task;
  return summary;
}

function moveFailure(failure: unknown, key: string): string {
  const code = failure instanceof ApiFailure ? failure.code : null;
  if (code === "version_conflict") return `Someone else changed ${key}. The board was refreshed.`;
  if (code === "project_archived") return "The project is archived.";
  if (failure instanceof ApiFailure && failure.status === 404) {
    return `${key} no longer exists. The board was refreshed.`;
  }
  return `Could not move ${key}. The board was refreshed.`;
}

/**
 * The board's state (WS-037 sections 2 and 5): loads columns and every task, adds created
 * tasks, and moves cards optimistically. After a failed move the whole board is loaded
 * again, so it never shows what the server does not hold.
 */
export function useBoard({
  projectKey,
  announce,
  onArchived,
}: {
  projectKey: string;
  announce: (message: string) => void;
  onArchived: () => void;
}) {
  const [phase, setPhase] = useState<BoardPhase>("loading");
  const [columns, setColumns] = useState<Column[]>([]);
  const [board, setBoardState] = useState<Board>({});
  const [moving, setMoving] = useState(false);
  // The latest board, for handlers that run between renders.
  const current = useRef<Board>(board);

  const setBoard = useCallback((next: Board) => {
    current.current = next;
    setBoardState(next);
  }, []);

  const fetchBoard = useCallback(async () => {
    const [loadedColumns, tasks] = await Promise.all([
      listColumns(projectKey),
      listAllTasks(projectKey),
    ]);
    return { columns: loadedColumns.items, board: groupByColumn(loadedColumns.items, tasks) };
  }, [projectKey]);

  useEffect(() => {
    let cancelled = false;
    fetchBoard().then(
      (loaded) => {
        if (cancelled) return;
        setColumns(loaded.columns);
        setBoard(loaded.board);
        setPhase("ready");
      },
      () => {
        if (!cancelled) setPhase("error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fetchBoard, setBoard]);

  /** Loads the whole board again. The current board stays shown while it loads. */
  const reload = useCallback(async () => {
    try {
      const loaded = await fetchBoard();
      setColumns(loaded.columns);
      setBoard(loaded.board);
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }, [fetchBoard, setBoard]);

  /** Shows a task the API created at the end of its column. */
  const added = useCallback(
    (task: Task) => {
      const before = current.current;
      setBoard({ ...before, [task.columnId]: [...(before[task.columnId] ?? []), summaryOf(task)] });
    },
    [setBoard],
  );

  /** Moves a card to `index` of a column: shown at once, then saved. */
  const drop = useCallback(
    async (taskId: string, columnId: string, index: number) => {
      const before = current.current;
      const after = applyDrop(before, taskId, columnId, index);
      const request = moveRequest(before, after, taskId);
      const from = placeOf(before, taskId);
      const key = from === null ? "" : (before[from.columnId]?.[from.index]?.key ?? "");
      if (request === null) return;

      setBoard(after);
      setMoving(true);
      try {
        const moved = summaryOf(await moveTask(taskId, request));
        const latest = current.current;
        const place = placeOf(latest, taskId);
        if (place !== null) {
          const tasks = [...(latest[place.columnId] ?? [])];
          tasks[place.index] = moved;
          setBoard({ ...latest, [place.columnId]: tasks });
        }
      } catch (failure) {
        await reload();
        announce(moveFailure(failure, key));
        if (failure instanceof ApiFailure && failure.code === "project_archived") onArchived();
      } finally {
        setMoving(false);
      }
    },
    [announce, onArchived, reload, setBoard],
  );

  return { phase, columns, board, moving, reload, added, drop };
}
