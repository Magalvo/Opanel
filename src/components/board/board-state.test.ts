import { describe, expect, it } from "vitest";

import { anchorsFor, groupTasks, moveCard } from "./board-state";
import { columns, DOING, DONE, t1, t2, t3, t4, task, TODO } from "./test-support";

function ids(state: ReturnType<typeof groupTasks>, columnId: string): string[] {
  return (state.cards[columnId] ?? []).map((card) => card.key);
}

describe("groupTasks", () => {
  it("puts each task in its column in the order received, and gives an empty column an empty list", () => {
    const state = groupTasks(columns, [t1, t3, t2]);

    expect(ids(state, TODO)).toEqual(["OPA-1", "OPA-2"]);
    expect(ids(state, DOING)).toEqual(["OPA-3"]);
    expect(ids(state, DONE)).toEqual([]);
    expect(state.columns.map((column) => column.name)).toEqual(["To do", "In progress", "Done"]);
  });

  it("drops a task whose column is not in the list", () => {
    const stray = task("OPA-9", "Stray", "99999999-0000-4000-8000-000000000000");

    expect(Object.values(groupTasks(columns, [t1, stray]).cards).flat()).toEqual([t1]);
  });
});

describe("moveCard", () => {
  const start = groupTasks(columns, [t1, t2, t3]);

  it("moves a card down, up and to the ends of its column", () => {
    expect(ids(moveCard(start, t1.id, TODO, 1), TODO)).toEqual(["OPA-2", "OPA-1"]);
    expect(ids(moveCard(start, t2.id, TODO, 0), TODO)).toEqual(["OPA-2", "OPA-1"]);
  });

  it("moves a card into another column at the start, the middle, the end and into an empty one", () => {
    const toDoing = groupTasks(columns, [t1, t2, t3, task("OPA-5", "Five", DOING)]);

    expect(ids(moveCard(toDoing, t1.id, DOING, 0), DOING)).toEqual(["OPA-1", "OPA-3", "OPA-5"]);
    expect(ids(moveCard(toDoing, t1.id, DOING, 1), DOING)).toEqual(["OPA-3", "OPA-1", "OPA-5"]);
    expect(ids(moveCard(toDoing, t1.id, DOING, 2), DOING)).toEqual(["OPA-3", "OPA-5", "OPA-1"]);
    const intoEmpty = moveCard(start, t1.id, DONE, 0);
    expect(ids(intoEmpty, DONE)).toEqual(["OPA-1"]);
    expect(ids(intoEmpty, TODO)).toEqual(["OPA-2"]);
  });

  it("sets the card's column, and changes nothing when it is put where it is", () => {
    expect(moveCard(start, t1.id, DOING, 0).cards[DOING]?.[0]?.columnId).toBe(DOING);
    expect(moveCard(start, t1.id, TODO, 0)).toEqual(start);
    expect(moveCard(start, "nope", TODO, 0)).toBe(start);
  });

  it("does not change the state it is given", () => {
    const before = structuredClone(start);

    moveCard(start, t1.id, DOING, 1);

    expect(start).toEqual(before);
  });
});

describe("anchorsFor", () => {
  const state = groupTasks(columns, [t1, t2, t3, t4]);

  it("anchors a card below the one above it, with afterTaskId", () => {
    expect(anchorsFor(moveCard(state, t1.id, TODO, 1), t1.id)).toEqual({ afterTaskId: t2.id });
    expect(anchorsFor(moveCard(state, t1.id, DOING, 1), t1.id)).toEqual({ afterTaskId: t3.id });
  });

  it("anchors the first place of a column that has cards with beforeTaskId", () => {
    expect(anchorsFor(moveCard(state, t2.id, TODO, 0), t2.id)).toEqual({ beforeTaskId: t1.id });
    expect(anchorsFor(moveCard(state, t1.id, DOING, 0), t1.id)).toEqual({ beforeTaskId: t3.id });
  });

  it("gives no anchor for a card alone in its column, and never both anchors", () => {
    expect(anchorsFor(moveCard(state, t1.id, DONE, 0), t1.id)).toEqual({ beforeTaskId: t4.id });
    const empty = groupTasks(columns, [t1]);
    expect(anchorsFor(moveCard(empty, t1.id, DONE, 0), t1.id)).toEqual({});
    for (const index of [0, 1, 2]) {
      const anchors = anchorsFor(moveCard(state, t1.id, TODO, index), t1.id);
      expect(Object.keys(anchors).length).toBeLessThanOrEqual(1);
    }
  });
});
