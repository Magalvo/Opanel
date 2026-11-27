// Applying other people's changes to the board (WS-048 section 4). Pure, like `moves.ts`.
import type { Label, LabelRef } from "@/lib/schemas/labels";
import type { TaskSummary } from "@/lib/schemas/tasks";

import { type Board, placeOf } from "./moves";

/**
 * The version rule of WT-04 decision 4: an event is worth a refetch only when its version
 * is newer than the one held. An equal or older one is the echo of a write already shown.
 * Nothing held, or an event without a version, always counts as newer.
 */
export function isNewer(held: number | null, version: number | null): boolean {
  return held === null || version === null || version > held;
}

/** The version of the card on the board, or null when it is not there. */
export function heldVersion(board: Board, taskId: string): number | null {
  const place = placeOf(board, taskId);
  return place === null ? null : (board[place.columnId]?.[place.index]?.version ?? null);
}

/** The board without that card; the same board when it is not on it. */
export function removeTask(board: Board, taskId: string): Board {
  const place = placeOf(board, taskId);
  if (place === null) return board;
  return {
    ...board,
    [place.columnId]: (board[place.columnId] ?? []).filter((item) => item.id !== taskId),
  };
}

/**
 * The card replaced where it is, when it is still in the same column; null when it is in
 * another column or not on the board, which needs its new column reloaded instead.
 */
export function replaceInPlace(board: Board, task: TaskSummary): Board | null {
  const place = placeOf(board, task.id);
  if (place?.columnId !== task.columnId) return null;
  return {
    ...board,
    [place.columnId]: (board[place.columnId] ?? []).map((item) =>
      item.id === task.id ? task : item,
    ),
  };
}

/**
 * One column replaced by its tasks as the API lists them, in board order. Those tasks are
 * removed from any other column, where the board may still show them.
 */
export function replaceColumn(
  board: Board,
  columnId: string,
  tasks: readonly TaskSummary[],
): Board {
  if (!(columnId in board)) return board;
  const ids = new Set(tasks.map((item) => item.id));
  const next: Record<string, readonly TaskSummary[]> = {};
  for (const [id, items] of Object.entries(board)) {
    next[id] = id === columnId ? tasks : items.filter((item) => !ids.has(item.id));
  }
  return next;
}

/**
 * One item per task (WS-123 section 5): a task listed twice, because it moved while its
 * pages were read, keeps its newest version (the later one on a tie), at that one's place.
 */
export function uniqueTasks(tasks: readonly TaskSummary[]): TaskSummary[] {
  const kept = new Map<string, number>();
  tasks.forEach((task, index) => {
    const held = kept.get(task.id);
    if (held === undefined || task.version >= (tasks[held]?.version ?? 0)) kept.set(task.id, index);
  });
  return tasks.filter((task, index) => kept.get(task.id) === index);
}

function byName(a: LabelRef, b: LabelRef): number {
  const left = a.name.toLowerCase();
  const right = b.name.toLowerCase();
  if (left !== right) return left < right ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The board with every card's labels as the project's labels are now (WS-108 section 4):
 * new names and colours, deleted labels dropped, by name as the API orders them. A card
 * that does not change keeps its object.
 */
export function withLabels(board: Board, labels: readonly Label[]): Board {
  const known = new Map(labels.map((label) => [label.id, label]));
  const next: Record<string, readonly TaskSummary[]> = {};
  for (const [columnId, tasks] of Object.entries(board)) {
    next[columnId] = tasks.map((task) => {
      if (task.labels.length === 0) return task;
      const updated = task.labels
        .flatMap((held) => {
          const label = known.get(held.id);
          return label === undefined
            ? []
            : [{ id: label.id, name: label.name, colour: label.colour }];
        })
        .sort(byName);
      const same =
        updated.length === task.labels.length &&
        updated.every((label, index) => {
          const held = task.labels[index];
          return held?.id === label.id && held.name === label.name && held.colour === label.colour;
        });
      return same ? task : { ...task, labels: updated };
    });
  }
  return next;
}

/**
 * A card with its sub-task progress taken from `task`, when it holds that same version: the
 * parent's `task.updated` that WS-133 sends when its sub-tasks change keeps its version
 * (WS-135 section 5). Any other field stays as the card holds it.
 */
export function withProgress(board: Board, task: TaskSummary): Board {
  const place = placeOf(board, task.id);
  if (place === null) return board;
  const column = board[place.columnId] ?? [];
  return {
    ...board,
    [place.columnId]: column.map((item) =>
      item.id === task.id && item.version === task.version
        ? { ...item, subtasks: task.subtasks }
        : item,
    ),
  };
}
