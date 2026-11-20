import type { ClientRect } from "@dnd-kit/core";
import { describe, expect, it } from "vitest";

import { snapRect } from "./measure";

function rect(left: number, top: number, width: number, height: number): ClientRect {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

describe("snapRect (WS-098)", () => {
  it("rounds a rect measured mid-slide to whole layout units", () => {
    expect(snapRect(rect(251.99997, 239.99996018066406, 238.00002, 86))).toEqual(
      rect(252, 240, 238, 86),
    );
    expect(snapRect(rect(252, 333.00003, 238, 85.99999))).toEqual(rect(252, 333, 238, 86));
  });

  it("leaves exact rects unchanged, half and quarter pixels included", () => {
    expect(snapRect(rect(514.5, 240.25, 238, 82.5))).toEqual(rect(514.5, 240.25, 238, 82.5));
    expect(snapRect(rect(0.015625, 10, 1, 1))).toEqual(rect(0.015625, 10, 1, 1));
  });

  it("gives a right and bottom that follow the rounded edges and size", () => {
    const snapped = snapRect({
      left: 10.00001,
      top: 20.00001,
      width: 30,
      height: 40,
      right: 40.00004,
      bottom: 60.00004,
    });
    expect(snapped.right).toBe(snapped.left + snapped.width);
    expect(snapped.bottom).toBe(snapped.top + snapped.height);
    expect(snapped).toEqual(rect(10, 20, 30, 40));
  });
});
