import { describe, expect, it } from "vitest";

import { heldVersion, isNewer, removeTask, replaceColumn, replaceInPlace } from "./live";
import { doing, done, task, todo } from "./test-data";

const t1 = task(1, todo.id, { version: 3 });
const t2 = task(2, todo.id);
const t3 = task(3, doing.id);
const board = { [todo.id]: [t1, t2], [doing.id]: [t3], [done.id]: [] };

function keys(next: Readonly<Record<string, readonly { key: string }[]>>, columnId: string) {
  return (next[columnId] ?? []).map((item) => item.key);
}

describe("isNewer: the version rule of WT-04 decision 4 (WS-048)", () => {
  it("is true for a version newer than the one held", () => {
    expect(isNewer(3, 4)).toBe(true);
  });

  it("is false for the same version (an echo) or an older one", () => {
    expect(isNewer(3, 3)).toBe(false);
    expect(isNewer(3, 2)).toBe(false);
  });

  it("is true when nothing is held, and for an event without a version", () => {
    expect(isNewer(null, 1)).toBe(true);
    expect(isNewer(3, null)).toBe(true);
  });
});

describe("heldVersion", () => {
  it("is the version of the card on the board, or null when it is not there", () => {
    expect(heldVersion(board, t1.id)).toBe(3);
    expect(heldVersion(board, task(9, todo.id).id)).toBeNull();
  });
});

describe("removeTask", () => {
  it("removes the card from its column and leaves the others", () => {
    const next = removeTask(board, t1.id);
    expect(keys(next, todo.id)).toEqual(["OPA-2"]);
    expect(keys(next, doing.id)).toEqual(["OPA-3"]);
  });

  it("returns the same board when the card is not on it", () => {
    expect(removeTask(board, task(9, todo.id).id)).toBe(board);
  });
});

describe("replaceInPlace", () => {
  it("replaces a card that stays in its column, keeping its place", () => {
    const next = replaceInPlace(board, { ...t1, title: "Renamed", version: 4 });
    expect(next?.[todo.id]?.map((item) => item.title)).toEqual(["Renamed", "Task 2"]);
  });

  it("is null when the card is in another column or not on the board", () => {
    expect(replaceInPlace(board, { ...t1, columnId: doing.id, version: 4 })).toBeNull();
    expect(replaceInPlace(board, task(9, todo.id))).toBeNull();
  });
});

describe("replaceColumn", () => {
  it("replaces one column with the tasks given, in their order", () => {
    const moved = { ...t3, columnId: todo.id, version: 2 };
    const next = replaceColumn(board, todo.id, [t2, moved, t1]);
    expect(keys(next, todo.id)).toEqual(["OPA-2", "OPA-3", "OPA-1"]);
  });

  it("removes those tasks from any other column", () => {
    const moved = { ...t3, columnId: todo.id, version: 2 };
    const next = replaceColumn(board, todo.id, [t1, t2, moved]);
    expect(keys(next, doing.id)).toEqual([]);
  });

  it("ignores a column the board does not have", () => {
    expect(replaceColumn(board, "99999999-9999-4999-8999-999999999999", [t1])).toBe(board);
  });
});
