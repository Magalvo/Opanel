import { describe, expect, it } from "vitest";

import type { Column } from "@/lib/schemas/columns";
import type { TaskSummary } from "@/lib/schemas/tasks";

import {
  applyDrop,
  type Board,
  columnDroppableId,
  groupByColumn,
  menuMoves,
  moveRequest,
  placeOf,
  targetOf,
} from "./moves";

const PROJECT_ID = "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f";
const TODO = "11111111-1111-4111-8111-111111111111";
const DOING = "22222222-2222-4222-8222-222222222222";
const DONE = "33333333-3333-4333-8333-333333333333";

function column(id: string, name: string): Column {
  return {
    id,
    projectId: PROJECT_ID,
    name,
    category: "todo",
    version: 1,
    createdAt: "2026-11-12T10:00:00.000Z",
    updatedAt: "2026-11-12T10:00:00.000Z",
  };
}

function task(number: number, columnId: string, version = 1): TaskSummary {
  return {
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(number).padStart(12, "0")}`,
    key: `OPA-${String(number)}`,
    number,
    projectId: PROJECT_ID,
    type: "task",
    title: `Task ${String(number)}`,
    columnId,
    assigneeTeam: null,
    assignee: null,
    epic: null,
    parent: null,
    reporter: { id: "55555555-5555-4555-8555-555555555555", name: "Ada", kind: "human" },
    severity: null,
    fingerprint: null,
    occurrences: 0,
    lastReportedAt: null,
    priority: "none",
    dueDate: null,
    storyPoints: null,
    sprint: null,
    labels: [],
    subtasks: null,
    version,
    createdAt: "2026-11-12T10:00:00.000Z",
    updatedAt: "2026-11-12T10:00:00.000Z",
    deletedAt: null,
  };
}

const t1 = task(1, TODO);
const t2 = task(2, TODO, 4);
const t3 = task(3, TODO);
const t4 = task(4, DOING);

/** To do: OPA-1, OPA-2, OPA-3. In progress: OPA-4. Done: empty. */
const board: Board = { [TODO]: [t1, t2, t3], [DOING]: [t4], [DONE]: [] };

function keys(of: Board, columnId: string): string[] {
  return (of[columnId] ?? []).map((item) => item.key);
}

describe("groupByColumn", () => {
  it("keeps the API's order, lists every column, and ignores tasks of unknown columns", () => {
    const grouped = groupByColumn(
      [column(TODO, "To do"), column(DOING, "In progress"), column(DONE, "Done")],
      [t1, t2, t4, t3, task(9, "99999999-9999-4999-8999-999999999999")],
    );

    expect(keys(grouped, TODO)).toEqual(["OPA-1", "OPA-2", "OPA-3"]);
    expect(keys(grouped, DOING)).toEqual(["OPA-4"]);
    expect(grouped[DONE]).toEqual([]);
    expect(Object.keys(grouped)).toEqual([TODO, DOING, DONE]);
  });

  it("leaves out a task in the backlog (WS-101)", () => {
    const grouped = groupByColumn([column(TODO, "To do")], [t1, { ...t2, columnId: null }]);

    expect(keys(grouped, TODO)).toEqual(["OPA-1"]);
  });
});

describe("placeOf and targetOf", () => {
  it("finds a task's column and index", () => {
    expect(placeOf(board, t2.id)).toEqual({ columnId: TODO, index: 1 });
    expect(placeOf(board, "nope")).toBeNull();
  });

  it("turns a drop target into a place: a task is its own place, a column is its end", () => {
    expect(targetOf(board, t4.id)).toEqual({ columnId: DOING, index: 0 });
    expect(targetOf(board, columnDroppableId(DOING))).toEqual({ columnId: DOING, index: 1 });
    expect(targetOf(board, columnDroppableId(DONE))).toEqual({ columnId: DONE, index: 0 });
    expect(targetOf(board, "nope")).toBeNull();
  });
});

describe("applyDrop", () => {
  it("moves a card within a column and keeps the others in order", () => {
    const after = applyDrop(board, t1.id, TODO, 2);

    expect(keys(after, TODO)).toEqual(["OPA-2", "OPA-3", "OPA-1"]);
    expect(keys(after, DOING)).toEqual(["OPA-4"]);
    expect(keys(board, TODO)).toEqual(["OPA-1", "OPA-2", "OPA-3"]);
  });

  it("moves a card to another column, at the given index, and sets its columnId", () => {
    const after = applyDrop(board, t2.id, DOING, 0);

    expect(keys(after, TODO)).toEqual(["OPA-1", "OPA-3"]);
    expect(keys(after, DOING)).toEqual(["OPA-2", "OPA-4"]);
    expect(after[DOING]?.[0]?.columnId).toBe(DOING);
  });

  it("puts a card past the end at the end, and into an empty column", () => {
    expect(keys(applyDrop(board, t1.id, DOING, 99), DOING)).toEqual(["OPA-4", "OPA-1"]);
    expect(keys(applyDrop(board, t1.id, DONE, 0), DONE)).toEqual(["OPA-1"]);
  });

  it("returns the same board for an unknown task or column", () => {
    expect(applyDrop(board, "nope", TODO, 0)).toBe(board);
    expect(applyDrop(board, t1.id, "nope", 0)).toBe(board);
  });
});

describe("moveRequest", () => {
  it("sends beforeTaskId of the next task when the card is first", () => {
    expect(moveRequest(board, applyDrop(board, t3.id, TODO, 0), t3.id)).toEqual({
      columnId: TODO,
      beforeTaskId: t1.id,
      version: 1,
    });
  });

  it("sends afterTaskId of the previous task in the middle and at the end", () => {
    expect(moveRequest(board, applyDrop(board, t1.id, TODO, 1), t1.id)).toEqual({
      columnId: TODO,
      afterTaskId: t2.id,
      version: 1,
    });
    expect(moveRequest(board, applyDrop(board, t2.id, DOING, 1), t2.id)).toEqual({
      columnId: DOING,
      afterTaskId: t4.id,
      version: 4,
    });
  });

  it("sends neither when the card is alone in its column", () => {
    expect(moveRequest(board, applyDrop(board, t2.id, DONE, 0), t2.id)).toEqual({
      columnId: DONE,
      version: 4,
    });
  });

  it("sends nothing when the card is back in its own place, or unknown", () => {
    expect(moveRequest(board, applyDrop(board, t2.id, TODO, 1), t2.id)).toBeNull();
    expect(moveRequest(board, board, "nope")).toBeNull();
  });
});

describe("menuMoves (WS-111 section 2)", () => {
  const columns = [column(TODO, "To do"), column(DOING, "In progress"), column(DONE, "Done")];

  function inColumn(taskId: string) {
    return menuMoves(board, columns, taskId)
      .slice(0, 4)
      .map(({ label, columnId, index, disabled }) => ({ label, columnId, index, disabled }));
  }

  it("cannot move the first card up or to the top", () => {
    expect(inColumn(t1.id)).toEqual([
      { label: "Move to top", columnId: TODO, index: 0, disabled: true },
      { label: "Move up", columnId: TODO, index: 0, disabled: true },
      { label: "Move down", columnId: TODO, index: 1, disabled: false },
      { label: "Move to bottom", columnId: TODO, index: 2, disabled: false },
    ]);
  });

  it("moves a middle card one place either way, or to either end", () => {
    expect(inColumn(t2.id)).toEqual([
      { label: "Move to top", columnId: TODO, index: 0, disabled: false },
      { label: "Move up", columnId: TODO, index: 0, disabled: false },
      { label: "Move down", columnId: TODO, index: 2, disabled: false },
      { label: "Move to bottom", columnId: TODO, index: 2, disabled: false },
    ]);
  });

  it("cannot move the last card down or to the bottom", () => {
    expect(inColumn(t3.id)).toEqual([
      { label: "Move to top", columnId: TODO, index: 0, disabled: false },
      { label: "Move up", columnId: TODO, index: 1, disabled: false },
      { label: "Move down", columnId: TODO, index: 2, disabled: true },
      { label: "Move to bottom", columnId: TODO, index: 2, disabled: true },
    ]);
  });

  it("cannot move a column's only card within it", () => {
    expect(inColumn(t4.id).map((move) => move.disabled)).toEqual([true, true, true, true]);
  });

  it("offers every other column in board order, at its end, never the card's own", () => {
    expect(menuMoves(board, columns, t4.id).slice(4)).toEqual([
      { label: "To do", columnId: TODO, index: 3, disabled: false },
      { label: "Done", columnId: DONE, index: 0, disabled: false },
    ]);
  });

  it("puts a card moved to another column last there", () => {
    const [toDoing] = menuMoves(board, columns, t1.id).slice(4);
    expect(toDoing).toEqual({ label: "In progress", columnId: DOING, index: 1, disabled: false });
    const after = applyDrop(board, t1.id, DOING, toDoing?.index ?? -1);
    expect(keys(after, DOING)).toEqual(["OPA-4", "OPA-1"]);
  });

  it("gives no moves for a task that is not on the board", () => {
    expect(menuMoves(board, columns, "unknown")).toEqual([]);
  });
});
