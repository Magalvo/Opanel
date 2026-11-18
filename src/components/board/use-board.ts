"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useProjectEventListener } from "@/components/projects/project-events";
import { getTask } from "@/components/task/api";
import { onTaskEvents } from "@/components/task/events";
import { ApiFailure } from "@/lib/api-client";
import type { Column } from "@/lib/schemas/columns";
import type { ProjectEvent } from "@/lib/schemas/events";
import type { Task, TaskSummary } from "@/lib/schemas/tasks";

import { listAllTasks, listColumns, listColumnTasks, moveTask } from "./api";
import { heldVersion, isNewer, removeTask, replaceColumn, replaceInPlace } from "./live";
import { applyDrop, type Board, groupByColumn, moveRequest, placeOf } from "./moves";

export type BoardPhase = "loading" | "error" | "ready";

/** How long the first load waits for the events stream to open (WS-048 section 3). */
const FALLBACK_MS = 3_000;

/** Events held during a drag or a move; past this, the board reloads instead (section 5). */
const MAX_HELD = 200;

/** Read through a function, so a check after an `await` is not narrowed away. */
function isMounted(ref: { readonly current: boolean }): boolean {
  return ref.current;
}

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
 *
 * It is live (WS-048): it listens to the project's events, loads first once that stream is
 * open, applies other people's changes, and reloads after a reconnect. Events that arrive
 * during a drag (`hold`) or while a move is saved wait until it is settled.
 */
export function useBoard({
  projectKey,
  announce,
  onArchived,
  fallbackMs = FALLBACK_MS,
}: {
  projectKey: string;
  announce: (message: string) => void;
  onArchived: () => void;
  fallbackMs?: number;
}) {
  const [phase, setPhase] = useState<BoardPhase>("loading");
  const [columns, setColumns] = useState<Column[]>([]);
  const [board, setBoardState] = useState<Board>({});
  const [moving, setMoving] = useState(false);
  // The latest board, for handlers that run between renders.
  const current = useRef<Board>(board);
  const mounted = useRef(true);
  const loadStarted = useRef(false);
  // Events waiting for a drag or a move to end, and whether too many arrived.
  const held = useRef({
    dragging: false,
    moving: false,
    queue: [] as ProjectEvent[],
    overflow: false,
  });
  // Tasks being fetched, and those to fetch again once that ends.
  const fetching = useRef(new Set<string>());
  const again = useRef(new Set<string>());

  const setBoard = useCallback((next: Board) => {
    current.current = next;
    setBoardState(next);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fetchBoard = useCallback(async () => {
    const [loadedColumns, tasks] = await Promise.all([
      listColumns(projectKey),
      listAllTasks(projectKey),
    ]);
    return { columns: loadedColumns.items, board: groupByColumn(loadedColumns.items, tasks) };
  }, [projectKey]);

  /** Loads the whole board again. The current board stays shown while it loads. */
  const reload = useCallback(async () => {
    loadStarted.current = true;
    try {
      const loaded = await fetchBoard();
      if (!isMounted(mounted)) return;
      setColumns(loaded.columns);
      setBoard(loaded.board);
      setPhase("ready");
    } catch {
      if (isMounted(mounted)) setPhase("error");
    }
  }, [fetchBoard, setBoard]);

  // The first load: when the stream opens, or after `fallbackMs` without it.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!loadStarted.current) void reload();
    }, fallbackMs);
    return () => {
      clearTimeout(timer);
    };
  }, [fallbackMs, reload]);

  /** Reads a task again and puts it where it now is (WS-048 section 4). */
  const refreshOnce = useCallback(
    async (taskId: string) => {
      let task: TaskSummary | null;
      try {
        const loaded = await getTask(taskId);
        task = loaded.deletedAt === null ? summaryOf(loaded) : null;
      } catch (failure) {
        if (!(failure instanceof ApiFailure && failure.status === 404)) throw failure;
        task = null;
      }
      if (!isMounted(mounted)) return;
      if (task === null) {
        setBoard(removeTask(current.current, taskId));
        return;
      }
      if (!isNewer(heldVersion(current.current, taskId), task.version)) return;
      const inPlace = replaceInPlace(current.current, task);
      if (inPlace !== null) {
        setBoard(inPlace);
        return;
      }
      const tasks = await listColumnTasks(projectKey, task.columnId);
      if (!isMounted(mounted)) return;
      setBoard(replaceColumn(removeTask(current.current, taskId), task.columnId, tasks));
    },
    [projectKey, setBoard],
  );

  /**
   * One fetch per task at a time; an event that arrives during it fetches once more after.
   * A failure other than `404` reloads the whole board.
   */
  const refreshTask = useCallback(
    async (taskId: string) => {
      if (fetching.current.has(taskId)) {
        again.current.add(taskId);
        return;
      }
      fetching.current.add(taskId);
      try {
        do {
          await refreshOnce(taskId);
        } while (again.current.delete(taskId));
      } catch {
        if (isMounted(mounted)) await reload();
      } finally {
        fetching.current.delete(taskId);
        again.current.delete(taskId);
      }
    },
    [refreshOnce, reload],
  );

  const apply = useCallback(
    (event: ProjectEvent) => {
      switch (event.type) {
        case "task.deleted":
          setBoard(removeTask(current.current, event.entityId));
          return;
        case "task.created":
        case "task.restored":
        case "task.updated":
        case "task.moved":
          if (isNewer(heldVersion(current.current, event.entityId), event.version)) {
            void refreshTask(event.entityId);
          }
          return;
        case "column.changed":
          void reload();
          return;
        // The frame reads the project again (WS-049 section 2).
        case "project.changed":
        case "comment.created":
        case "epic.changed":
          return;
      }
    },
    [refreshTask, reload, setBoard],
  );

  /** Applies the held events once neither a drag nor a move is in progress. */
  const flush = useCallback(() => {
    const state = held.current;
    if (state.dragging || state.moving) return;
    const queue = state.queue;
    const overflow = state.overflow;
    state.queue = [];
    state.overflow = false;
    if (overflow) {
      void reload();
      return;
    }
    for (const event of queue) apply(event);
  }, [apply, reload]);

  const onEvent = useCallback(
    (event: ProjectEvent) => {
      const state = held.current;
      if (!state.dragging && !state.moving) {
        apply(event);
        return;
      }
      if (state.overflow) return;
      if (state.queue.length >= MAX_HELD) {
        state.queue = [];
        state.overflow = true;
        return;
      }
      state.queue.push(event);
    },
    [apply],
  );

  // The page's stream (WS-049 section 2). Its first open starts the first load, at once
  // when it is already open as the board mounts; a reconnect, or an open after the fallback
  // load, reloads, since events may have been missed (doc 0002 section 4).
  const { status: live, opened } = useProjectEventListener({
    onEvent,
    onReconnect: () => void reload(),
  });
  useEffect(() => {
    if (!opened) return;
    // Started from a timer, like the fallback load, so the effect sets no state itself.
    const timer = setTimeout(() => void reload(), 0);
    return () => {
      clearTimeout(timer);
    };
  }, [opened, reload]);

  /** Holds incoming events while a card is dragged (WS-048 section 5). */
  const hold = useCallback(
    (on: boolean) => {
      held.current.dragging = on;
      if (!on) flush();
    },
    [flush],
  );

  // Changes made in the task detail, over the board (WS-038 section 4).
  useEffect(
    () =>
      onTaskEvents({
        changed: (task) => {
          const latest = current.current;
          const place = placeOf(latest, task.id);
          if (place === null) return;
          const summary = summaryOf(task);
          const from = latest[place.columnId] ?? [];
          if (place.columnId === task.columnId) {
            setBoard({
              ...latest,
              [place.columnId]: from.map((item) => (item.id === task.id ? summary : item)),
            });
            return;
          }
          setBoard({
            ...latest,
            [place.columnId]: from.filter((item) => item.id !== task.id),
            [task.columnId]: [...(latest[task.columnId] ?? []), summary],
          });
        },
        deleted: (id) => {
          setBoard(removeTask(current.current, id));
        },
      }),
    [setBoard],
  );

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
      held.current.moving = true;
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
        held.current.moving = false;
        flush();
      }
    },
    [announce, flush, onArchived, reload, setBoard],
  );

  return { phase, columns, board, moving, live, reload, added, drop, hold };
}
