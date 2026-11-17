import type { Active, ClientRect, Coordinates, DroppableContainer } from "@dnd-kit/core";
import { describe, expect, it } from "vitest";

import { boardCollision } from "./collision";
import { columnDroppableId } from "./moves";

// Plain rectangles, as `@dnd-kit` measures them: cards are 238 × 90, 10 px apart.
function rect(left: number, top: number, width = 238, height = 90): ClientRect {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

function container(id: string): DroppableContainer {
  return {
    id,
    key: id,
    data: { current: undefined },
    disabled: false,
    node: { current: null },
    rect: { current: null },
  };
}

const active: Active = {
  id: "echo",
  data: { current: undefined },
  rect: { current: { initial: null, translated: null } },
};

const TODO = columnDroppableId("todo");
const DOING = columnDroppableId("doing");

/** Runs the board's rule on `rects` (column targets first, as they tie with their cards). */
function overOf(
  rects: Record<string, ClientRect>,
  columns: Record<string, string>,
  collisionRect: ClientRect,
  pointerCoordinates: Coordinates | null = null,
) {
  const detect = boardCollision((taskId) => columns[taskId] ?? null);
  const collisions = detect({
    active,
    collisionRect,
    droppableRects: new Map(Object.entries(rects)),
    droppableContainers: Object.keys(rects).map(container),
    pointerCoordinates,
  });
  return collisions[0]?.id;
}

describe("the board's collision rule without a pointer (keyboard)", () => {
  it("takes the card, not its column, when the column holds one card of the same size", () => {
    expect(
      overOf(
        { [TODO]: rect(0, 0), [DOING]: rect(300, 0), foxtrot: rect(0, 0), echo: rect(300, 0) },
        { foxtrot: "todo", echo: "doing" },
        rect(0, 0),
      ),
    ).toBe("foxtrot");
  });

  it("keeps the same place once the column has grown with the dragged card on top", () => {
    expect(
      overOf(
        {
          [TODO]: rect(0, 0, 238, 190),
          [DOING]: rect(300, 0, 238, 64),
          echo: rect(0, 0),
          foxtrot: rect(0, 100),
        },
        { foxtrot: "todo", echo: "todo" },
        rect(0, 0),
      ),
    ).toBe("echo");
  });

  it("takes an empty column", () => {
    expect(
      overOf(
        { [TODO]: rect(0, 0), [DOING]: rect(300, 0, 238, 64), echo: rect(0, 0) },
        { echo: "todo" },
        rect(300, 0),
      ),
    ).toBe(DOING);
  });

  it("takes the next card of the same column", () => {
    expect(
      overOf(
        { [TODO]: rect(0, 0, 238, 190), echo: rect(0, 0), foxtrot: rect(0, 100) },
        { foxtrot: "todo", echo: "todo" },
        rect(0, 100),
      ),
    ).toBe("foxtrot");
  });
});

describe("the board's collision rule with a pointer", () => {
  const rects = {
    [TODO]: rect(0, 0, 238, 300),
    [DOING]: rect(300, 0, 238, 64),
    echo: rect(0, 0),
    foxtrot: rect(0, 100),
  };
  const columns = { foxtrot: "todo", echo: "todo" };

  it("takes the card under the pointer", () => {
    expect(overOf(rects, columns, rect(500, 500), { x: 50, y: 150 })).toBe("foxtrot");
  });

  it("takes the column's closest card when the pointer is on the column but no card", () => {
    expect(overOf(rects, columns, rect(0, 180), { x: 100, y: 250 })).toBe("foxtrot");
  });

  it("takes an empty column under the pointer", () => {
    expect(overOf(rects, columns, rect(500, 500), { x: 400, y: 30 })).toBe(DOING);
  });
});
