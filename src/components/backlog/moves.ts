// The backlog's pure logic (WS-109 section 3): where a drop puts a row, and which move
// request it becomes. The request is built by the board's `moveRequest`, on the backlog held
// as a board of one column. No React and no `@dnd-kit` here.
import { moveRequest } from "@/components/board/moves";
import type { MoveTaskRequest, TaskSummary } from "@/lib/schemas/tasks";

/** The one column of the board the backlog is held as; never a column's uuid. */
const BACKLOG = "backlog";

/**
 * The backlog after moving a task to `index` (its index once moved; past the end means the
 * end). An unknown task changes nothing.
 */
export function reorder(
  tasks: readonly TaskSummary[],
  taskId: string,
  index: number,
): readonly TaskSummary[] {
  const from = tasks.findIndex((task) => task.id === taskId);
  const task = tasks[from];
  if (task === undefined) return tasks;
  const next = tasks.filter((item) => item.id !== taskId);
  next.splice(Math.min(Math.max(index, 0), next.length), 0, task);
  return next;
}

/**
 * The move request for a task, from the backlog before and after a drop: the task above it,
 * or, when it is first, the task below. `null` when it is back in its own place or unknown.
 */
export function backlogMoveRequest(
  before: readonly TaskSummary[],
  after: readonly TaskSummary[],
  taskId: string,
): MoveTaskRequest | null {
  const request = moveRequest({ [BACKLOG]: before }, { [BACKLOG]: after }, taskId);
  return request === null ? null : { ...request, columnId: null };
}
