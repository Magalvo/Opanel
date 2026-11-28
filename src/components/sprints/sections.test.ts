import { describe, expect, it } from "vitest";

import {
  activeSprintOf,
  dropRefusal,
  groupSections,
  plannedSprintsOf,
  rowMoves,
  sectionMove,
  sectionOf,
  UNSCHEDULED,
} from "./sections";
import { inBacklog, sprint } from "./test-data";

const s4 = sprint(4, "active", "2026-12-01", "2026-12-14");
const s5 = sprint(5, "planned", "2026-12-15", "2026-12-28");
const s6 = sprint(6, "planned", "2026-12-29", "2027-01-11");
const s3 = sprint(3, "completed", "2026-11-17", "2026-11-30");

const b1 = inBacklog(1, s5);
const b2 = inBacklog(2, null);
const b3 = inBacklog(3, s5);
const b4 = inBacklog(4, s6);
const b5 = inBacklog(5, null);
// A sub-task of b1, in its sprint.
const sub = inBacklog(6, s5, { parent: { id: b1.id, key: b1.key, title: b1.title } });

// The backlog's one ranking: sprints and unscheduled tasks interleaved.
const ranking = [b1, b2, b3, b4, b5];
const planned = [s5, s6];

describe("the sprints of a backlog (WS-144 section 4)", () => {
  it("orders the planned sprints by start date and finds the active one", () => {
    expect(plannedSprintsOf([s6, s4, s5, s3]).map((item) => item.id)).toEqual([s5.id, s6.id]);
    expect(activeSprintOf([s6, s4, s5])?.id).toBe(s4.id);
    expect(activeSprintOf([s5, s6])).toBeNull();
  });

  it("groups the one ranking into a section per planned sprint, then the unscheduled ones", () => {
    const sections = groupSections(ranking, planned);

    expect(Object.keys(sections)).toEqual([s5.id, s6.id, UNSCHEDULED]);
    expect(sections[s5.id]?.map((item) => item.key)).toEqual(["OPA-1", "OPA-3"]);
    expect(sections[s6.id]?.map((item) => item.key)).toEqual(["OPA-4"]);
    expect(sections[UNSCHEDULED]?.map((item) => item.key)).toEqual(["OPA-2", "OPA-5"]);
  });

  it("keeps a planned sprint with no tasks as an empty section", () => {
    expect(groupSections([b2], planned)[s6.id]).toEqual([]);
  });

  it("puts a task whose sprint it does not know among the unscheduled ones", () => {
    const stray = inBacklog(7, sprint(9, "planned", "2027-02-01", "2027-02-14"));
    expect(sectionOf(stray, planned)).toBe(UNSCHEDULED);
    expect(sectionOf(b4, planned)).toBe(s6.id);
  });
});

describe("a move between sections (WS-144 section 5, test 4)", () => {
  it("is one move with the target's sprint and the task above it as the anchor", () => {
    const moved = sectionMove(ranking, planned, b2.id, s5.id, 1);

    expect(moved?.request).toEqual({
      columnId: null,
      sprintId: s5.id,
      afterTaskId: b1.id,
      version: b2.version,
    });
    // In the ranking, right after its anchor, now in Sprint 5.
    expect(moved?.after.map((item) => item.key)).toEqual([
      "OPA-1",
      "OPA-2",
      "OPA-3",
      "OPA-4",
      "OPA-5",
    ]);
    expect(moved?.after[1]?.sprint).toEqual({ id: s5.id, name: s5.name, state: "planned" });
  });

  it("anchors on the task below when it goes first", () => {
    const moved = sectionMove(ranking, planned, b5.id, s5.id, 0);

    expect(moved?.request).toEqual({
      columnId: null,
      sprintId: s5.id,
      beforeTaskId: b1.id,
      version: b5.version,
    });
    expect(moved?.after.map((item) => item.key)).toEqual([
      "OPA-5",
      "OPA-1",
      "OPA-2",
      "OPA-3",
      "OPA-4",
    ]);
  });

  it("unschedules a task moved to the backlog's section, with sprintId null", () => {
    const moved = sectionMove(ranking, planned, b4.id, UNSCHEDULED, 2);

    expect(moved?.request).toEqual({
      columnId: null,
      sprintId: null,
      afterTaskId: b5.id,
      version: b4.version,
    });
    expect(moved?.after.at(-1)?.sprint).toBeNull();
  });

  it("goes to the end of the ranking in an empty section, with no anchor", () => {
    const moved = sectionMove([b1, b2], planned, b2.id, s6.id, 0);

    expect(moved?.request).toEqual({ columnId: null, sprintId: s6.id, version: b2.version });
    expect(moved?.after.map((item) => item.key)).toEqual(["OPA-1", "OPA-2"]);
  });

  it("is nothing when the task stays where it is", () => {
    expect(sectionMove(ranking, planned, b1.id, s5.id, 0)).toBeNull();
  });

  it("refuses a sub-task's move to another section before any request", () => {
    expect(dropRefusal(sub, s5.id, UNSCHEDULED)).toBe("A sub-task stays in its parent's sprint.");
    expect(dropRefusal(sub, s5.id, s5.id)).toBeNull();
    expect(dropRefusal(b1, s5.id, UNSCHEDULED)).toBeNull();
  });
});

describe("a row's Move to menu (WS-144 section 5, test 4)", () => {
  const sections = groupSections(ranking, planned);

  it("offers the top and bottom of its section, the other planned sprints, the backlog and the active sprint", () => {
    expect(rowMoves(sections, planned, b1.id, true)).toEqual([
      { label: "Move to top", sectionId: s5.id, index: 0, disabled: true },
      { label: "Move to bottom", sectionId: s5.id, index: 1, disabled: false },
      { label: "Sprint 6", sectionId: s6.id, index: 1, disabled: false },
      { label: "Backlog", sectionId: UNSCHEDULED, index: 2, disabled: false },
      { label: "Active sprint", sectionId: null, index: 0, disabled: false },
    ]);
  });

  it("leaves out the active sprint when none is active, and its own section", () => {
    expect(rowMoves(sections, planned, b2.id, false).map((move) => move.label)).toEqual([
      "Move to top",
      "Move to bottom",
      "Sprint 5",
      "Sprint 6",
    ]);
  });

  it("offers a sub-task only moves within its section", () => {
    const withSub = groupSections([b1, sub, b2], planned);
    expect(rowMoves(withSub, planned, sub.id, true).map((move) => move.label)).toEqual([
      "Move to top",
      "Move to bottom",
    ]);
  });
});
