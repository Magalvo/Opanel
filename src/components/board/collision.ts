// The board's collision rule (WS-037 "Deviations", WS-054): which card or column a dragged
// card is over. Kept apart from the component so that it can be tested with rectangles.
import {
  type ClientRect,
  closestCenter,
  closestCorners,
  type CollisionDetection,
  pointerWithin,
} from "@dnd-kit/core";

import { columnDroppableId } from "./moves";

const COLUMN_PREFIX = columnDroppableId("");

/** Whether a drop target is a column itself, as opposed to one of its cards. */
export function isColumnTarget(id: string | number): boolean {
  return String(id).startsWith(COLUMN_PREFIX);
}

type CollisionArgs = Parameters<CollisionDetection>[0];

function centreOf(rect: ClientRect): { x: number; y: number } {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * The cards under the pointer first; on a column but no card, the column's closest card,
 * or the column itself when empty. A keyboard drag has no pointer, so the centre of the
 * dragged card stands in for it: the same rule then holds, and a column holding one card
 * no longer ties with that card (WS-054). `columnOf` says which column a task is in, on the
 * board as shown while dragging.
 */
export function boardCollision(
  args: CollisionArgs,
  columnOf: (taskId: string) => string | null,
): ReturnType<CollisionDetection> {
  const point = args.pointerCoordinates ?? centreOf(args.collisionRect);
  const hits = pointerWithin({ ...args, pointerCoordinates: point });
  const cards = hits.filter((hit) => !isColumnTarget(hit.id));
  if (cards.length > 0) return cards;
  const column = hits.find((hit) => isColumnTarget(hit.id));
  if (column !== undefined) {
    const columnId = String(column.id).slice(COLUMN_PREFIX.length);
    const inColumn = args.droppableContainers.filter(
      (container) => !isColumnTarget(container.id) && columnOf(String(container.id)) === columnId,
    );
    return inColumn.length === 0
      ? [column]
      : closestCenter({ ...args, droppableContainers: inColumn });
  }
  return closestCorners(args);
}
