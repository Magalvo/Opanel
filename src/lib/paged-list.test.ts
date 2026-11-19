import { describe, expect, it } from "vitest";

import { mergePage } from "./paged-list";

const a = { id: "a", name: "A" };
const b = { id: "b", name: "B" };
const c = { id: "c", name: "C" };

describe("mergePage (WS-080)", () => {
  it("appends a disjoint page in order", () => {
    expect(mergePage([a, b], [c])).toEqual([a, b, c]);
  });

  it("keeps an id that is in both once, at the position the server gives it", () => {
    const moved = { id: "a", name: "A, as the server has it now" };

    expect(mergePage([a, b], [moved, c])).toEqual([b, moved, c]);
  });

  it("returns the same items for an empty page", () => {
    const current = [a, b];

    expect(mergePage(current, [])).toBe(current);
  });

  it("mutates neither input", () => {
    const current = Object.freeze([a, b]);
    const incoming = Object.freeze([b, c]);

    expect(mergePage(current, incoming)).toEqual([a, b, c]);
    expect(current).toEqual([a, b]);
    expect(incoming).toEqual([b, c]);
  });
});
