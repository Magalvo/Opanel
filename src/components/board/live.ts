// Applying other people's changes to the board (WS-048 section 4). Pure, like `moves.ts`.
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
