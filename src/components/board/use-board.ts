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

/** Whether another load was asked for, read through a function for the same reason. */
function askedAgain(loader: { readonly again: boolean }): boolean {
  return loader.again;
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
 * during a drag (`hold`), while a move is saved or while the board loads wait until it is
 * settled.
 *
 * Loads are ordered (WS-082): one at a time, only the latest applied, and none applied over
 * a drag or a move. A reload asked for during either waits until it ends.
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
  // Events waiting for a drag, a move or a load to end, whether too many arrived, and
  // whether a reload waits for the drag or the move to end (WS-082).
  const held = useRef({
    dragging: false,
    moving: false,
    queue: [] as ProjectEvent[],
    overflow: false,
    reload: false,
  });
  // The board's loads (WS-082): whether one runs, whether another was asked for meanwhile,
  // the generation whose result may be applied, and the running loop.
  const loader = useRef({
    running: false,
    again: false,
    generation: 0,
    promise: null as Promise<void> | null,
  });
  // `flush`, for the load loop, which is declared before it.
  const flushHeld = useRef<() => void>(() => undefined);
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

  /**
   * Loads the whole board, one load at a time (WS-082). Asked for while one runs, it loads
   * once more after it, and only that last result (or error) is applied. A result whose
   * generation was superseded by a drag or a move is dropped. The current board stays shown
   * while it loads.
   */
  const load = useCallback((): Promise<void> => {
    loadStarted.current = true;
    const state = loader.current;
    if (state.running) {
      state.again = true;
      return state.promise ?? Promise.resolve();
    }
    state.running = true;
    const run = async () => {
      try {
        do {
          state.again = false;
          const generation = ++state.generation;
          let loaded: Awaited<ReturnType<typeof fetchBoard>> | null = null;
          try {
            loaded = await fetchBoard();
          } catch {
            loaded = null;
          }
          if (!isMounted(mounted)) return;
          if (generation !== state.generation || askedAgain(state)) continue;
          if (loaded === null) {
            setPhase("error");
          } else {
            setColumns(loaded.columns);
            setBoard(loaded.board);
            setPhase("ready");
          }
        } while (askedAgain(state));
      } finally {
        state.running = false;
        state.promise = null;
        if (isMounted(mounted)) flushHeld.current();
      }
    };
    state.promise = run();
    return state.promise;
  }, [fetchBoard, setBoard]);

  /** Loads the whole board again, once any drag or move has ended (WS-082). */
  const reload = useCallback((): Promise<void> => {
    const state = held.current;
    if (state.dragging || state.moving) {
      state.reload = true;
      return Promise.resolve();
    }
    return load();
  }, [load]);

  /**
   * A drag or a move begins: a load in flight may predate it, so its result is dropped and
   * the board reloads once the drag or the move has ended (WS-082).
   */
  const supersede = useCallback(() => {
    const state = loader.current;
    state.generation++;
    if (state.running) {
      state.again = false;
      held.current.reload = true;
    }
  }, []);

  // The first load: when the stream opens, or after `fallbackMs` without it.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!loadStarted.current) void reload();
    }, fallbackMs);
    return () => {
      clearTimeout(timer);
    };
  }, [fallbackMs, reload]);

  /**
   * Shows a task in the column its `columnId` names, unless the board holds as new a
   * version: in place when it is there, otherwise taken out of wherever it is and that
   * column read again (WS-048 section 4, WS-082).
   */
  const placeTask = useCallback(
    async (task: TaskSummary) => {
      if (!isNewer(heldVersion(current.current, task.id), task.version)) return;
      // A task in the backlog is not on the board (WS-101 section 7).
      const columnId = task.columnId;
      if (columnId === null) {
        setBoard(removeTask(current.current, task.id));
        return;
      }
      const inPlace = replaceInPlace(current.current, task);
      if (inPlace !== null) {
        setBoard(inPlace);
        return;
      }
      const tasks = await listColumnTasks(projectKey, columnId);
      if (!isMounted(mounted)) return;
      setBoard(replaceColumn(removeTask(current.current, task.id), columnId, tasks));
    },
    [projectKey, setBoard],
  );

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
      await placeTask(task);
    },
    [placeTask, setBoard],
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
        // Cards do not show labels yet (WT-07 item F).
        case "label.changed":
          return;
      }
    },
    [refreshTask, reload, setBoard],
  );

  /**
   * Applies the held events once no drag, move or load is in progress. A reload asked for
   * meanwhile, too many events or a column change loads the whole board instead.
   */
  const flush = useCallback(() => {
    const state = held.current;
    if (state.dragging || state.moving || loader.current.running) return;
    const queue = state.queue;
    const whole =
      state.overflow || state.reload || queue.some((event) => event.type === "column.changed");
    state.queue = [];
    state.overflow = false;
    state.reload = false;
    if (whole) {
      void reload();
      return;
    }
    for (const event of queue) apply(event);
  }, [apply, reload]);

  useEffect(() => {
    flushHeld.current = flush;
  }, [flush]);

  const onEvent = useCallback(
    (event: ProjectEvent) => {
      const state = held.current;
      if (!state.dragging && !state.moving) {
        // A column change during a load asks for one more load; other events wait for the
        // snapshot, and then meet it through the version rule (WS-082).
        if (event.type === "column.changed" || !loader.current.running) {
          apply(event);
          return;
        }
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
      if (on) supersede();
      held.current.dragging = on;
      if (!on) flush();
    },
    [flush, supersede],
  );

  // Changes made in the task detail, over the board (WS-038 section 4).
  useEffect(
    () =>
      onTaskEvents({
        changed: (task) => {
          const latest = current.current;
          const place = placeOf(latest, task.id);
          if (place === null) return;
          // The version rule, as for events (WS-082).
          if (!isNewer(heldVersion(latest, task.id), task.version)) return;
          const summary = summaryOf(task);
          const from = latest[place.columnId] ?? [];
          const columnId = task.columnId;
          // Moved to the backlog: it leaves the board (WS-101 section 7).
          if (columnId === null) {
            setBoard(removeTask(latest, task.id));
            return;
          }
          if (place.columnId === columnId) {
            setBoard({
              ...latest,
              [place.columnId]: from.map((item) => (item.id === task.id ? summary : item)),
            });
            return;
          }
          setBoard({
            ...latest,
            [place.columnId]: from.filter((item) => item.id !== task.id),
            [columnId]: [...(latest[columnId] ?? []), summary],
          });
        },
        deleted: (id) => {
          setBoard(removeTask(current.current, id));
        },
      }),
    [setBoard],
  );

  /**
   * Shows a task the API created at the end of its column. Its event may have put it on
   * the board first: then it is replaced only by a newer version (WS-082).
   */
  const added = useCallback(
    (task: Task) => {
      const before = current.current;
      const summary = summaryOf(task);
      if (placeOf(before, task.id) !== null) {
        if (!isNewer(heldVersion(before, task.id), task.version)) return;
        const inPlace = replaceInPlace(before, summary);
        if (inPlace !== null) setBoard(inPlace);
        return;
      }
      // A task created in the backlog does not go on the board (WS-101 section 7).
      const columnId = task.columnId;
      if (columnId === null) return;
      setBoard({ ...before, [columnId]: [...(before[columnId] ?? []), summary] });
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

      supersede();
      setBoard(after);
      setMoving(true);
      held.current.moving = true;
      try {
        const moved = summaryOf(await moveTask(taskId, request));
        try {
          // In its own column, whatever the board did meanwhile (WS-082).
          await placeTask(moved);
        } catch {
          held.current.reload = true;
        }
      } catch (failure) {
        // This move owns the hold: its reload lands before the announcement.
        await load();
        announce(moveFailure(failure, key));
        if (failure instanceof ApiFailure && failure.code === "project_archived") onArchived();
      } finally {
        setMoving(false);
        held.current.moving = false;
        flush();
      }
    },
    [announce, flush, load, onArchived, placeTask, setBoard, supersede],
  );

  return { phase, columns, board, moving, live, reload, added, drop, hold };
}
