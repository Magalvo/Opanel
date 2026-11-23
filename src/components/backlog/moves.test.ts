import { describe, expect, it } from "vitest";

import { task } from "@/components/board/test-data";

import { backlogMoveRequest, reorder } from "./moves";

const t1 = task(1, "", { columnId: null });
const t2 = task(2, "", { columnId: null, version: 4 });
const t3 = task(3, "", { columnId: null, version: 7 });
const backlog = [t1, t2, t3];

function keys(tasks: readonly { key: string }[]) {
  return tasks.map((item) => item.key);
}

describe("reorder (WS-109 section 3)", () => {
  it("moves a task to an index of the backlog, and keeps it in the backlog", () => {
    expect(keys(reorder(backlog, t3.id, 0))).toEqual(["OPA-3", "OPA-1", "OPA-2"]);
    expect(keys(reorder(backlog, t1.id, 2))).toEqual(["OPA-2", "OPA-3", "OPA-1"]);
    expect(keys(reorder(backlog, t1.id, 9))).toEqual(["OPA-2", "OPA-3", "OPA-1"]);
    expect(reorder(backlog, t3.id, 0).every((item) => item.columnId === null)).toBe(true);
  });

  it("changes nothing for an unknown task", () => {
    expect(reorder(backlog, task(9, "").id, 0)).toBe(backlog);
  });
});

describe("backlogMoveRequest (WS-109 section 3)", () => {
  it("names the task above as afterTaskId, for the backlog", () => {
    expect(backlogMoveRequest(backlog, reorder(backlog, t1.id, 2), t1.id)).toEqual({
      columnId: null,
      afterTaskId: t3.id,
      version: 1,
    });
  });

  it("names the task below as beforeTaskId when the task is first", () => {
    expect(backlogMoveRequest(backlog, reorder(backlog, t3.id, 0), t3.id)).toEqual({
      columnId: null,
      beforeTaskId: t1.id,
      version: 7,
    });
  });

  it("names neither when the task is alone", () => {
    expect(backlogMoveRequest([t2], [t2], t2.id)).toBeNull();
    expect(backlogMoveRequest([], [t2], t2.id)).toBeNull();
  });

  it("is null for a drop in its own place or an unknown task", () => {
    expect(backlogMoveRequest(backlog, reorder(backlog, t2.id, 1), t2.id)).toBeNull();
    expect(backlogMoveRequest(backlog, backlog, task(9, "").id)).toBeNull();
  });
});
