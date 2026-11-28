import type {
  Active,
  ClientRect,
  DroppableContainer,
  KeyboardCoordinateGetter,
  UniqueIdentifier,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { describe, expect, it } from "vitest";

import { boardCollision } from "@/components/board/collision";
import { snapRect } from "@/components/board/measure";

import {
  groupSections,
  positionText,
  sectionDroppableId,
  sectionTarget,
  UNSCHEDULED,
} from "./sections";
import { inBacklog, sprint } from "./test-data";

// Under jsdom, as `@dnd-kit` reads the droppables' nodes (WS-097): a `.test.tsx` file.

const s5 = sprint(5, "planned", "2026-12-15", "2026-12-28");
const s6 = sprint(6, "planned", "2026-12-29", "2027-01-11");
const planned = [s5, s6];
const b1 = inBacklog(1, s5);
const b2 = inBacklog(2, null);
const b3 = inBacklog(3, s5);
const b5 = inBacklog(5, null);

// Keyboard moves between sections (test 5): the sections are stacked, so ArrowDown from the
// last row of Sprint 5 carries the row to the first place of the backlog's section, and the
// announcement names that section.

function rect(top: number, height = 86, left = 0, width = 600): ClientRect {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

function container(id: string, sortable?: { containerId: string; index: number }) {
  const value: DroppableContainer = {
    id,
    key: id,
    data: {
      current: sortable === undefined ? undefined : { sortable: { ...sortable, items: [] } },
    },
    disabled: false,
    node: { current: document.createElement("div") },
    rect: { current: null },
  };
  return value;
}

function containers(list: DroppableContainer[]) {
  const map = new Map<UniqueIdentifier, DroppableContainer>(list.map((c) => [c.id, c]));
  return Object.assign(map, {
    getEnabled: () => list.filter((c) => !c.disabled),
    getNodeFor: (id: UniqueIdentifier) => map.get(id)?.node.current ?? undefined,
    toArray: () => list,
  });
}

describe("keyboard moves between sections (WS-144 section 5, test 5)", () => {
  const sections = groupSections([b1, b3, b2, b5], planned);
  const list = [
    container(b1.id, { containerId: s5.id, index: 0 }),
    container(b3.id, { containerId: s5.id, index: 1 }),
    container(b2.id, { containerId: UNSCHEDULED, index: 0 }),
    container(b5.id, { containerId: UNSCHEDULED, index: 1 }),
    container(sectionDroppableId(s5.id)),
    container(sectionDroppableId(s6.id)),
    container(sectionDroppableId(UNSCHEDULED)),
  ];
  const rects: Record<string, ClientRect> = {
    [b1.id]: rect(0),
    [b3.id]: rect(94),
    [sectionDroppableId(s5.id)]: rect(0, 180),
    [sectionDroppableId(s6.id)]: rect(240, 40),
    [b2.id]: rect(340),
    [b5.id]: rect(434),
    [sectionDroppableId(UNSCHEDULED)]: rect(340, 180),
  };
  const droppableRects = new Map(Object.entries(rects).map(([id, r]) => [id, snapRect(r)]));
  const active: Active = {
    id: b3.id,
    data: { current: undefined },
    rect: { current: { initial: null, translated: null } },
  };
  const collisionRect = { ...rect(94, 82.5) };

  it("ArrowDown from the last row of a sprint goes on to the next section, which announces itself", () => {
    const context = {
      active,
      collisionRect,
      droppableRects,
      droppableContainers: containers(list),
      over: { id: b3.id, rect: rects[b3.id], disabled: false, data: { current: undefined } },
      scrollableAncestors: [],
    } as unknown as Parameters<KeyboardCoordinateGetter>[1]["context"];

    const at = sortableKeyboardCoordinates(new KeyboardEvent("keydown", { code: "ArrowDown" }), {
      active: b3.id,
      currentCoordinates: { x: 0, y: 94 },
      context,
    });
    if (at === undefined) throw new Error("ArrowDown did not move");

    // The empty Sprint 6 is next: it takes the row at its end.
    const hits = boardCollision(
      {
        active,
        collisionRect: rect(at.y, 82.5, at.x),
        droppableRects,
        droppableContainers: list,
        pointerCoordinates: null,
      },
      (taskId) => {
        for (const [sectionId, tasks] of Object.entries(sections)) {
          if (tasks.some((item) => item.id === taskId)) return sectionId;
        }
        return null;
      },
    );
    const over = String(hits[0]?.id);
    const to = sectionTarget(sections, over);

    expect(to).toEqual({ columnId: s6.id, index: 0 });
    expect(positionText(sections, planned, b3.id, to)).toBe("Sprint 6, position 1 of 1");
  });

  it("names the section and the place of a row where it is", () => {
    expect(positionText(sections, planned, b3.id)).toBe("Sprint 5, position 2 of 2");
    expect(positionText(sections, planned, b2.id)).toBe("Backlog, position 1 of 2");
    expect(positionText(sections, planned, b2.id, { columnId: s5.id, index: 0 })).toBe(
      "Sprint 5, position 1 of 3",
    );
  });
});
