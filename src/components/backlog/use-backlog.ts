"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { listColumns, moveTask } from "@/components/board/api";
import { isNewer, withLabels } from "@/components/board/live";
import { listLabels } from "@/components/labels/api";
import { useProjectEventListener } from "@/components/projects/project-events";
import { getTask } from "@/components/task/api";
import { onTaskEvents } from "@/components/task/events";
import { ApiFailure } from "@/lib/api-client";
import type { Column } from "@/lib/schemas/columns";
import type { ProjectEvent } from "@/lib/schemas/events";
import type { Task, TaskSummary } from "@/lib/schemas/tasks";

import { listAllBacklog } from "./api";
import { backlogMoveRequest, reorder } from "./moves";

export type BacklogPhase = "loading" | "error" | "ready";

type Rows = readonly TaskSummary[];

/** How long the first load waits for the events stream to open (WS-048 section 3). */
const FALLBACK_MS = 3_000;

/** Events held during a drag or a move; past this, the backlog reloads instead. */
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

/** The version of the row, or null when the backlog does not hold the task. */
function heldVersion(tasks: Rows, taskId: string): number | null {
  return tasks.find((task) => task.id === taskId)?.version ?? null;
}

/** The backlog without that row; the same backlog when it is not there. */
function removeRow(tasks: Rows, taskId: string): Rows {
  return tasks.some((task) => task.id === taskId)
    ? tasks.filter((task) => task.id !== taskId)
    : tasks;
}

/** The row replaced where it is; the same backlog when it is not there. */
function replaceRow(tasks: Rows, task: TaskSummary): Rows {
  return tasks.some((item) => item.id === task.id)
    ? tasks.map((item) => (item.id === task.id ? task : item))
    : tasks;
}

function moveFailure(failure: unknown, key: string): string {
  const code = failure instanceof ApiFailure ? failure.code : null;
  if (code === "version_conflict") {
    return `Someone else changed ${key}. The backlog was refreshed.`;
  }
  if (code === "project_archived") return "The project is archived.";
  if (failure instanceof ApiFailure && failure.status === 404) {
    return `${key} no longer exists. The backlog was refreshed.`;
  }
  return `Could not move ${key}. The backlog was refreshed.`;
}

/**
 * The backlog's state (WS-109 section 6): loads the columns and every backlog task, adds
 * created tasks, reorders rows optimistically and moves a task to the board. After a failed
 * move the whole backlog is loaded again, so it never shows what the server does not hold.
 *
 * It is live, by the board's rules (WS-048, WS-082): it loads first once the project's
 * stream is open, applies other people's changes, reloads after a reconnect, holds events
 * during a drag, a move or a load, and runs one load at a time, applying only the latest.
 */
export function useBacklog({
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
  const [phase, setPhase] = useState<BacklogPhase>("loading");
  const [columns, setColumnsState] = useState<Column[]>([]);
  const [tasks, setTasksState] = useState<Rows>([]);
  const [moving, setMoving] = useState(false);
  // The task being moved to the board, whose row is disabled meanwhile.
  const [sending, setSending] = useState<string | null>(null);
  // The latest rows and columns, for handlers that run between renders.
  const current = useRef<Rows>(tasks);
  const currentColumns = useRef<Column[]>(columns);
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
  // The loads (WS-082): whether one runs, whether another was asked for meanwhile, the
  // generation whose result may be applied, and the running loop.
  const loader = useRef({
    running: false,
    again: false,
    generation: 0,
    promise: null as Promise<void> | null,
  });
  // `flush`, for the load loop, which is declared before it.
  const flushHeld = useRef<() => void>(() => undefined);
  // Tasks being fetched, and those to fetch again once that ends, with whether any of the
  // events asked about the backlog's order.
  const fetching = useRef(new Set<string>());
  const again = useRef(new Map<string, boolean>());

  const setTasks = useCallback((next: Rows) => {
    current.current = next;
    setTasksState(next);
  }, []);

  const setColumns = useCallback((next: Column[]) => {
    currentColumns.current = next;
    setColumnsState(next);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fetchBacklog = useCallback(async () => {
    const [loadedColumns, loadedTasks] = await Promise.all([
      listColumns(projectKey),
      listAllBacklog(projectKey),
    ]);
    return { columns: loadedColumns.items, tasks: loadedTasks };
  }, [projectKey]);

  /**
   * Loads the whole backlog, one load at a time (WS-082). Asked for while one runs, it loads
   * once more after it, and only that last result (or error) is applied. A result whose
   * generation was superseded by a drag or a move is dropped.
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
          let loaded: Awaited<ReturnType<typeof fetchBacklog>> | null = null;
          try {
            loaded = await fetchBacklog();
          } catch {
            loaded = null;
          }
          if (!isMounted(mounted)) return;
          if (generation !== state.generation || askedAgain(state)) continue;
          if (loaded === null) {
            setPhase("error");
          } else {
            setColumns(loaded.columns);
            setTasks(loaded.tasks);
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
  }, [fetchBacklog, setColumns, setTasks]);

  /** Loads the whole backlog again, once any drag or move has ended (WS-082). */
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
   * the backlog reloads once the drag or the move has ended (WS-082).
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
   * Reads a task again and shows it as it now is (section 6): out of the backlog when it is
   * on the board, deleted or gone; replaced in place after an edit; and the backlog read
   * again when its order may have changed or the task arrived in it.
   */
  const refreshOnce = useCallback(
    async (taskId: string, ordered: boolean) => {
      let task: TaskSummary | null;
      try {
        const loaded = await getTask(taskId);
        task = loaded.deletedAt === null ? summaryOf(loaded) : null;
      } catch (failure) {
        if (!(failure instanceof ApiFailure && failure.status === 404)) throw failure;
        task = null;
      }
      if (!isMounted(mounted)) return;
      // Deleted, gone or on the board.
      if (task?.columnId !== null) {
        setTasks(removeRow(current.current, taskId));
        return;
      }
      const version = heldVersion(current.current, taskId);
      if (version !== null && !ordered) {
        if (isNewer(version, task.version)) setTasks(replaceRow(current.current, task));
        return;
      }
      await reload();
    },
    [reload, setTasks],
  );

  /**
   * A parent's sub-tasks changed: its `task.updated` carries the version the backlog holds
   * (WS-133 section 7). Its progress is read and taken into its row (WS-135 section 5).
   */
  const refreshProgress = useCallback(
    async (taskId: string) => {
      let loaded: TaskSummary;
      try {
        const task = await getTask(taskId);
        if (task.deletedAt !== null) return;
        loaded = summaryOf(task);
      } catch {
        return;
      }
      if (!isMounted(mounted)) return;
      const held = current.current.find((row) => row.id === taskId);
      if (held === undefined) return;
      if (held.version === loaded.version) {
        setTasks(replaceRow(current.current, { ...held, subtasks: loaded.subtasks }));
      } else if (isNewer(held.version, loaded.version) && loaded.columnId === null) {
        setTasks(replaceRow(current.current, loaded));
      }
    },
    [setTasks],
  );

  /**
   * One fetch per task at a time; an event that arrives during it fetches once more after.
   * A failure other than `404` reloads the whole backlog.
   */
  const refreshTask = useCallback(
    async (taskId: string, ordered: boolean) => {
      if (fetching.current.has(taskId)) {
        again.current.set(taskId, (again.current.get(taskId) ?? false) || ordered);
        return;
      }
      fetching.current.add(taskId);
      try {
        let next: boolean | undefined = ordered;
        while (next !== undefined) {
          await refreshOnce(taskId, next);
          next = again.current.get(taskId);
          again.current.delete(taskId);
        }
      } catch {
        if (isMounted(mounted)) await reload();
      } finally {
        fetching.current.delete(taskId);
        again.current.delete(taskId);
      }
    },
    [refreshOnce, reload],
  );

  /** Reads the columns again, for "Move to board" (section 6). */
  const refreshColumns = useCallback(async () => {
    try {
      const { items } = await listColumns(projectKey);
      if (isMounted(mounted)) setColumns(items);
    } catch {
      // The next column event, or a reload, brings them.
    }
  }, [projectKey, setColumns]);

  /** Rewrites the rows' labels from the project's labels (WS-108 section 4). */
  const refreshLabels = useCallback(async () => {
    try {
      const { items } = await listLabels(projectKey);
      if (!isMounted(mounted)) return;
      setTasks(withLabels({ backlog: current.current }, items).backlog ?? current.current);
    } catch {
      // The next label event, or a reload, brings them.
    }
  }, [projectKey, setTasks]);

  const apply = useCallback(
    (event: ProjectEvent) => {
      switch (event.type) {
        case "task.deleted":
          setTasks(removeRow(current.current, event.entityId));
          return;
        case "task.created":
        case "task.restored":
        case "task.updated":
        case "task.moved": {
          const held = heldVersion(current.current, event.entityId);
          if (isNewer(held, event.version)) {
            void refreshTask(event.entityId, event.type !== "task.updated");
          } else if (event.type === "task.updated" && held === event.version) {
            void refreshProgress(event.entityId);
          }
          return;
        }
        case "column.changed":
          void refreshColumns();
          return;
        case "label.changed":
          void refreshLabels();
          return;
        // The frame reads the project again (WS-049 section 2); a row shows neither
        // comments nor epics.
        case "project.changed":
        case "comment.created":
        case "epic.changed":
          return;
      }
    },
    [refreshColumns, refreshLabels, refreshProgress, refreshTask, setTasks],
  );

  /**
   * Applies the held events once no drag, move or load is in progress. A reload asked for
   * meanwhile, or too many events, loads the whole backlog instead.
   */
  const flush = useCallback(() => {
    const state = held.current;
    if (state.dragging || state.moving || loader.current.running) return;
    const queue = state.queue;
    const whole = state.overflow || state.reload;
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
      if (!state.dragging && !state.moving && !loader.current.running) {
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

  // The page's stream (WS-049 section 2). Its first open starts the first load; a
  // reconnect, or an open after the fallback load, reloads, since events may have been
  // missed (doc 0002 section 4).
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

  /** Holds incoming events while a row is dragged (WS-048 section 5). */
  const hold = useCallback(
    (on: boolean) => {
      if (on) supersede();
      held.current.dragging = on;
      if (!on) flush();
    },
    [flush, supersede],
  );

  // Changes made in the task detail, over the backlog (WS-038 section 4).
  useEffect(
    () =>
      onTaskEvents({
        changed: (task) => {
          const latest = current.current;
          const version = heldVersion(latest, task.id);
          if (task.columnId === null && version === null) {
            // Moved into the backlog: it went to the end (WS-101 section 4).
            void reload();
            return;
          }
          if (version === null || !isNewer(version, task.version)) return;
          setTasks(
            task.columnId === null
              ? replaceRow(latest, summaryOf(task))
              : removeRow(latest, task.id),
          );
        },
        deleted: (id) => {
          setTasks(removeRow(current.current, id));
        },
      }),
    [reload, setTasks],
  );

  /**
   * Shows a task the API created at the end of the backlog. Its event may have put it there
   * first: then it is replaced only by a newer version (WS-082).
   */
  const added = useCallback(
    (task: Task) => {
      const before = current.current;
      const version = heldVersion(before, task.id);
      if (version !== null) {
        if (isNewer(version, task.version)) setTasks(replaceRow(before, summaryOf(task)));
        return;
      }
      if (task.columnId !== null) return;
      setTasks([...before, summaryOf(task)]);
    },
    [setTasks],
  );

  /** Moves a row to `index` of the backlog: shown at once, then saved (section 3). */
  const drop = useCallback(
    async (taskId: string, index: number) => {
      const before = current.current;
      const after = reorder(before, taskId, index);
      const request = backlogMoveRequest(before, after, taskId);
      const key = before.find((task) => task.id === taskId)?.key ?? "";
      if (request === null) return;

      supersede();
      setTasks(after);
      setMoving(true);
      held.current.moving = true;
      try {
        const moved = summaryOf(await moveTask(taskId, request));
        setTasks(
          moved.columnId === null
            ? replaceRow(current.current, moved)
            : removeRow(current.current, taskId),
        );
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
    [announce, flush, load, onArchived, setTasks, supersede],
  );

  /**
   * Moves a task to the end of the first column (section 4). Not optimistic: the row stays,
   * disabled, until the move is saved. Answers whether it moved.
   */
  const moveToBoard = useCallback(
    async (taskId: string): Promise<boolean> => {
      const task = current.current.find((item) => item.id === taskId);
      const first = currentColumns.current[0];
      if (task === undefined || first === undefined) return false;

      supersede();
      setSending(taskId);
      setMoving(true);
      held.current.moving = true;
      try {
        await moveTask(taskId, { columnId: first.id, version: task.version });
        setTasks(removeRow(current.current, taskId));
        announce(`${task.key} was moved to ${first.name}.`);
        return true;
      } catch (failure) {
        await load();
        announce(moveFailure(failure, task.key));
        if (failure instanceof ApiFailure && failure.code === "project_archived") onArchived();
        return false;
      } finally {
        setSending(null);
        setMoving(false);
        held.current.moving = false;
        flush();
      }
    },
    [announce, flush, load, onArchived, setTasks, supersede],
  );

  return {
    phase,
    columns,
    tasks,
    moving,
    sending,
    live,
    reload,
    added,
    drop,
    moveToBoard,
    hold,
  };
}
