import type { Column } from "@/lib/schemas/columns";
import type { TaskSummary } from "@/lib/schemas/tasks";

/** The board as the page holds it: the columns in order and each column's cards in order. */
export interface BoardState {
  columns: readonly Column[];
  cards: Readonly<Record<string, readonly TaskSummary[]>>;
}

/**
 * Puts every task in its column. The API returns tasks in board order (WT-03 decision 11), so
 * the order received is kept. A task of a column that is not in the list is left out.
 */
export function groupTasks(columns: readonly Column[], tasks: readonly TaskSummary[]): BoardState {
  const cards: Record<string, TaskSummary[]> = Object.fromEntries(
    columns.map((column) => [column.id, []]),
  );
  for (const task of tasks) {
    cards[task.columnId]?.push(task);
  }
  return { columns, cards };
}

/** The column that holds the card, and its place there. */
export function locate(
  state: BoardState,
  taskId: string,
): { columnId: string; index: number } | undefined {
  for (const [columnId, list] of Object.entries(state.cards)) {
    const index = list.findIndex((card) => card.id === taskId);
    if (index !== -1) return { columnId, index };
  }
  return undefined;
}

/**
 * The state after the card is put in `columnId` at `index`, counted in that column without the
 * card. The index is kept inside the column. The state it is given is not changed; a move to
 * where the card already is returns the same state.
 */
export function moveCard(
  state: BoardState,
  taskId: string,
  columnId: string,
  index: number,
): BoardState {
  const from = locate(state, taskId);
  const target = state.cards[columnId];
  const card = from === undefined ? undefined : state.cards[from.columnId]?.[from.index];
  if (from === undefined || card === undefined || target === undefined) return state;

  const without = target.filter((other) => other.id !== taskId);
  const place = Math.max(0, Math.min(index, without.length));
  if (from.columnId === columnId && from.index === place) return state;

  const cards = {
    ...state.cards,
    [from.columnId]: (state.cards[from.columnId] ?? []).filter((other) => other.id !== taskId),
  };
  cards[columnId] = [...without.slice(0, place), { ...card, columnId }, ...without.slice(place)];
  return { columns: state.columns, cards };
}

/**
 * What the move endpoint needs to place the card where it now is (WS-031): the card above it
 * (`afterTaskId`), or else the card below it (`beforeTaskId`), or nothing for a column in which
 * it is alone. Never both.
 */
export function anchorsFor(
  state: BoardState,
  taskId: string,
): { afterTaskId?: string } | { beforeTaskId?: string } {
  const place = locate(state, taskId);
  const list = place === undefined ? undefined : state.cards[place.columnId];
  if (place === undefined || list === undefined) return {};

  const above = list[place.index - 1];
  if (above !== undefined) return { afterTaskId: above.id };
  const below = list[place.index + 1];
  if (below !== undefined) return { beforeTaskId: below.id };
  return {};
}
