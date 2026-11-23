// The board's pure logic (WS-037 section 5): where cards are, where a drop puts them, and
// which move request a drop becomes. No React and no `@dnd-kit` here.
import type { Column } from "@/lib/schemas/columns";
import type { MoveTaskRequest, TaskSummary } from "@/lib/schemas/tasks";

/** Each column's tasks in board order, keyed by column id, in the columns' order. */
export type Board = Readonly<Record<string, readonly TaskSummary[]>>;

export interface Place {
  columnId: string;
  index: number;
}

const COLUMN_PREFIX = "column:";

/** The drop-target id of a column itself, as opposed to one of its cards. */
export function columnDroppableId(columnId: string): string {
  return `${COLUMN_PREFIX}${columnId}`;
}

/** Groups the API's task list, which is in board order, by column. */
export function groupByColumn(columns: readonly Column[], tasks: readonly TaskSummary[]): Board {
  const board: Record<string, TaskSummary[]> = {};
  for (const column of columns) board[column.id] = [];
  // A task in the backlog has no column, and is not on the board (WS-101).
  for (const task of tasks) if (task.columnId !== null) board[task.columnId]?.push(task);
  return board;
}

/** Where a task is now. */
export function placeOf(board: Board, taskId: string): Place | null {
  for (const [columnId, tasks] of Object.entries(board)) {
    const index = tasks.findIndex((task) => task.id === taskId);
    if (index !== -1) return { columnId, index };
  }
  return null;
}

/** The place a drop target stands for: a card's own place, or the end of a column. */
export function targetOf(board: Board, overId: string): Place | null {
  if (overId.startsWith(COLUMN_PREFIX)) {
    const columnId = overId.slice(COLUMN_PREFIX.length);
    const tasks = board[columnId];
    return tasks === undefined ? null : { columnId, index: tasks.length };
  }
  return placeOf(board, overId);
}

/**
 * The board after moving a task to `index` of a column (its index in the column once
 * moved; past the end means the end). An unknown task or column changes nothing.
 */
export function applyDrop(board: Board, taskId: string, columnId: string, index: number): Board {
  const from = placeOf(board, taskId);
  const target = board[columnId];
  const task = from === null ? undefined : board[from.columnId]?.[from.index];
  if (from === null || target === undefined || task === undefined) return board;

  const next: Record<string, readonly TaskSummary[]> = { ...board };
  next[from.columnId] = (board[from.columnId] ?? []).filter((item) => item.id !== taskId);
  const into = [...(next[columnId] ?? [])];
  into.splice(Math.min(Math.max(index, 0), into.length), 0, { ...task, columnId });
  next[columnId] = into;
  return next;
}

/**
 * The move request for a task, from the board before and after a drop: the task just above
 * it, or, when it is first, the task just below, or neither when it is alone. `null` when
 * the task is back in its own place or unknown.
 */
export function moveRequest(before: Board, after: Board, taskId: string): MoveTaskRequest | null {
  const from = placeOf(before, taskId);
  const to = placeOf(after, taskId);
  if (from === null || to === null) return null;
  if (from.columnId === to.columnId && from.index === to.index) return null;

  const tasks = after[to.columnId] ?? [];
  const task = tasks[to.index];
  if (task === undefined) return null;
  const above = tasks[to.index - 1];
  const below = tasks[to.index + 1];
  if (above !== undefined) {
    return { columnId: to.columnId, afterTaskId: above.id, version: task.version };
  }
  if (below !== undefined) {
    return { columnId: to.columnId, beforeTaskId: below.id, version: task.version };
  }
  return { columnId: to.columnId, version: task.version };
}

/** One entry of a card's menu (WS-111 section 2): where the card would go. */
export interface MenuMove {
  label: string;
  columnId: string;
  index: number;
  disabled: boolean;
}

/**
 * The moves a card's menu offers: to the top, up, down and to the bottom of its column,
 * then to the end of each other column in board order. A move that would leave the card
 * where it is is disabled. A task that is not on the board has none.
 */
export function menuMoves(board: Board, columns: readonly Column[], taskId: string): MenuMove[] {
  const from = placeOf(board, taskId);
  if (from === null) return [];
  const { columnId, index } = from;
  const last = (board[columnId]?.length ?? 1) - 1;
  const within: MenuMove[] = [
    { label: "Move to top", columnId, index: 0, disabled: index === 0 },
    { label: "Move up", columnId, index: Math.max(index - 1, 0), disabled: index === 0 },
    { label: "Move down", columnId, index: Math.min(index + 1, last), disabled: index === last },
    { label: "Move to bottom", columnId, index: last, disabled: index === last },
  ];
  const others = columns
    .filter((column) => column.id !== columnId)
    .map((column) => ({
      label: column.name,
      columnId: column.id,
      index: board[column.id]?.length ?? 0,
      disabled: false,
    }));
  return [...within, ...others];
}
