import { describe, expect, it } from "vitest";

import { isPositionKey, positionBetween, positionsBetween } from "./position";

/** Keys compare by UTF-16 code unit, never with localeCompare (WT-03 amendment A2). */
function inOrder(keys: readonly string[]): boolean {
  return keys.every((key, index) => index === 0 || (keys[index - 1] ?? "") < key);
}

/** A small seeded generator (mulberry32), so the random test is the same on every run. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("positionBetween", () => {
  it("starts at a0, counts up after a key and down before one", () => {
    expect(positionBetween(null, null)).toBe("a0");
    expect(positionBetween("a0", null)).toBe("a1");
    expect(positionBetween("az", null)).toBe("b00");
    expect(positionBetween(null, "a0")).toBe("Zz");
  });

  it.each([
    ["two integers far apart", "a0", "a5"],
    ["adjacent integers", "a0", "a1"],
    ["an integer and a fraction", "a0", "a0V"],
    ["a fraction and an integer", "a0V", "a1"],
    ["two fractions", "a0G", "a0V"],
    ["fractions that share a prefix", "a0V1", "a0V2"],
    ["integers of different lengths", "az", "b00"],
    ["a negative and a positive integer", "Zz", "a0"],
  ])("returns a key strictly between %s", (_case, before, after) => {
    const key = positionBetween(before, after);

    expect(before < key && key < after, `${before} < ${key} < ${after}`).toBe(true);
    expect(isPositionKey(key)).toBe(true);
  });

  it("orders keys that differ only by case by code unit, not by language", () => {
    const keys = positionsBetween(null, null, 40);
    const upper = keys.find((key) => key === "aZ");
    const lower = keys.find((key) => key === "aa");

    expect(upper).toBe("aZ");
    expect(lower).toBe("aa");
    expect("aZ" < "aa").toBe(true);
    // An English collation would order them the other way round: never use it on keys.
    expect("aZ".localeCompare("aa", "en")).toBeGreaterThan(0);
    expect(keys.indexOf("aZ")).toBeLessThan(keys.indexOf("aa"));
  });

  it("refuses malformed keys and keys that are not in order", () => {
    for (const bad of ["", "a", "a00", "a!", "b0", "a0 ", "é0"]) {
      expect(() => positionBetween(bad, null), bad).toThrow();
      expect(() => positionBetween(null, bad), bad).toThrow();
    }
    expect(() => positionBetween("a1", "a0")).toThrow();
    expect(() => positionBetween("a1", "a1")).toThrow();
  });
});

describe("growth of keys", () => {
  it("keeps keys short over 10 000 appends and 10 000 prepends", () => {
    const appended: string[] = [];
    let last: string | null = null;
    for (let i = 0; i < 10_000; i += 1) {
      last = positionBetween(last, null);
      appended.push(last);
    }
    const prepended: string[] = [];
    let first: string | null = null;
    for (let i = 0; i < 10_000; i += 1) {
      first = positionBetween(null, first);
      prepended.unshift(first);
    }

    expect(inOrder(appended)).toBe(true);
    expect(inOrder(prepended)).toBe(true);
    expect(Math.max(...appended.map((key) => key.length))).toBeLessThanOrEqual(4);
    expect(Math.max(...prepended.map((key) => key.length))).toBeLessThanOrEqual(4);
  });

  it("grows by about one character per six inserts into the same gap", () => {
    let before = "a0";
    const after = "a1";
    const keys = [before];
    for (let i = 0; i < 1_000; i += 1) {
      // Always insert right after the same card: the worst case for key length.
      const key = positionBetween(before, after);
      keys.push(key);
      before = key;
    }
    let low = "a0";
    let high = "a1";
    const narrowing: string[] = [];
    for (let i = 0; i < 1_000; i += 1) {
      const key = positionBetween(low, high);
      narrowing.push(key);
      if (i % 2 === 0) low = key;
      else high = key;
    }

    expect(inOrder(keys)).toBe(true);
    expect(Math.max(...keys.map((key) => key.length))).toBeLessThanOrEqual(200);
    expect(Math.max(...narrowing.map((key) => key.length))).toBeLessThanOrEqual(200);
  });

  it("stays strictly ordered over 5 000 random inserts", () => {
    const random = seeded(2026);
    const list: string[] = [];
    for (let i = 0; i < 5_000; i += 1) {
      const at = Math.floor(random() * (list.length + 1));
      const key = positionBetween(list[at - 1] ?? null, list[at] ?? null);
      list.splice(at, 0, key);
    }

    expect(inOrder(list)).toBe(true);
    expect(list.every(isPositionKey)).toBe(true);
    expect(new Set(list).size).toBe(list.length);
  });
});

describe("positionsBetween", () => {
  it("gives a0, a1, a2 for the three default columns of a project", () => {
    expect(positionsBetween(null, null, 3)).toEqual(["a0", "a1", "a2"]);
  });

  it("gives ordered keys inside any gap, and none for a count of 0", () => {
    for (const [before, after] of [
      ["a0", "a1"],
      [null, "a0"],
      ["a5", null],
      ["a0V", "a0W"],
    ] as const) {
      const keys = positionsBetween(before, after, 7);
      expect(keys).toHaveLength(7);
      expect(
        inOrder([
          ...(before === null ? [] : [before]),
          ...keys,
          ...(after === null ? [] : [after]),
        ]),
      ).toBe(true);
    }
    expect(positionsBetween("a0", "a1", 0)).toEqual([]);
  });

  it("refuses a negative or fractional count", () => {
    expect(() => positionsBetween(null, null, -1)).toThrow();
    expect(() => positionsBetween(null, null, 1.5)).toThrow();
  });
});

describe("isPositionKey", () => {
  it("accepts generated keys and refuses everything else", () => {
    for (const key of ["a0", "a1", "b00", "Zz", "a0V", "zzzzzzzzzzzzzzzzzzzzzzzzzzz"]) {
      expect(isPositionKey(key), key).toBe(true);
    }
    for (const key of ["", "a", "a00", "a!", "b0", "0", "a0 "]) {
      expect(isPositionKey(key), key).toBe(false);
    }
  });
});
