import type {
  Active,
  ClientRect,
  DroppableContainer,
  KeyboardCoordinateGetter,
  UniqueIdentifier,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { describe, expect, it } from "vitest";

import { snapRect } from "./measure";
import { columnDroppableId } from "./moves";

// WS-098 section 3: a keyboard move carries Echo from "In progress" back to the top of
// "To do", which holds Foxtrot, while Foxtrot is still sliding up after the previous drop.
// The values are the ones logged on the board in the browser.

const TODO = columnDroppableId("todo");
const DOING = columnDroppableId("doing");
const DONE = columnDroppableId("done");

function rect(left: number, top: number, width = 238, height = 86): ClientRect {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

/** A droppable as `@dnd-kit/sortable` registers it: a card knows its list and its index. */
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

/** What `DndContext` hands the keyboard: enabled droppables and their measured rects. */
function containers(list: DroppableContainer[]) {
  const map = new Map<UniqueIdentifier, DroppableContainer>(list.map((c) => [c.id, c]));
  return Object.assign(map, {
    getEnabled: () => list.filter((c) => !c.disabled),
    getNodeFor: (id: UniqueIdentifier) => map.get(id)?.node.current ?? undefined,
    toArray: () => list,
  });
}

const active: Active = {
  id: "echo",
  data: { current: undefined },
  rect: { current: { initial: null, translated: null } },
};

// The dragged card as `@dnd-kit` sees it: the drag overlay, 238 × 82.5.
const OVERLAY = { width: 238, height: 82.5 };

/** The coordinates `sortableKeyboardCoordinates` moves the dragged card to for `code`. */
function keyboardMove(
  code: string,
  at: { x: number; y: number },
  list: DroppableContainer[],
  rects: Record<string, ClientRect>,
  measure: (rect: ClientRect) => ClientRect,
) {
  const droppableRects = new Map(Object.entries(rects).map(([id, r]) => [id, measure(r)]));
  const echoRect = droppableRects.get("echo");
  if (echoRect === undefined) throw new Error("no rect for echo");
  const context = {
    active,
    collisionRect: rect(at.x, at.y, OVERLAY.width, OVERLAY.height),
    droppableRects,
    droppableContainers: containers(list),
    over: { id: "echo", rect: echoRect, disabled: false, data: { current: undefined } },
    scrollableAncestors: [],
  } as unknown as Parameters<KeyboardCoordinateGetter>[1]["context"];
  return sortableKeyboardCoordinates(new KeyboardEvent("keydown", { code }), {
    active: "echo",
    currentCoordinates: at,
    context,
  });
}

/** ArrowLeft into "To do", then ArrowDown: where ArrowDown puts Echo. */
function arrowDownAfterArrowLeft(measure: (rect: ClientRect) => ClientRect) {
  // ArrowLeft: Echo is the only card of "In progress"; Foxtrot, still sliding, is measured
  // 0.00004 px above its place (WS-098 section 3).
  const left = keyboardMove(
    "ArrowLeft",
    { x: 514.5, y: 240 },
    [
      container("echo", { containerId: "doing", index: 0 }),
      container("foxtrot", { containerId: "todo", index: 0 }),
      container(TODO),
      container(DOING),
      container(DONE),
    ],
    {
      echo: rect(514.5, 240),
      foxtrot: rect(252, 239.99996018066406),
      [TODO]: rect(252, 240, 238, 86),
      [DOING]: rect(514.5, 240, 238, 86),
      [DONE]: rect(777, 240, 238, 64),
    },
    measure,
  );
  if (left === undefined) throw new Error("ArrowLeft did not move");

  // ArrowDown: Echo now holds the top of "To do", Foxtrot is below it.
  return keyboardMove(
    "ArrowDown",
    left,
    [
      container("echo", { containerId: "todo", index: 0 }),
      container("foxtrot", { containerId: "todo", index: 1 }),
      container(TODO),
      container(DOING),
      container(DONE),
    ],
    {
      echo: rect(252, 240),
      foxtrot: rect(252, 333),
      [TODO]: rect(252, 240, 238, 179),
      [DOING]: rect(514.5, 240, 238, 64),
      [DONE]: rect(777, 240, 238, 64),
    },
    measure,
  );
}

describe("a keyboard move while a card is still sliding (WS-098)", () => {
  it("with rects measured to whole layout units, ArrowDown goes to the next card", () => {
    // Foxtrot's corner, less the overlay's 3.5 px of height it is shorter than a card.
    expect(arrowDownAfterArrowLeft(snapRect)).toEqual({ x: 252, y: 336.5 });
  });

  it("with the raw rects, ArrowDown stays at the top of the column (the defect)", () => {
    expect(arrowDownAfterArrowLeft((r) => r)).toEqual({ x: 252, y: 240 });
  });
});
