import { describe, expect, it } from "vitest";
import { z } from "zod";

import { pageSchema, paginationQuerySchema } from "./pagination";

describe("paginationQuerySchema", () => {
  it("defaults to 50 and accepts 1 to 100, as the strings a query string gives", () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(paginationQuerySchema.parse({ limit: "1" }).limit).toBe(1);
    expect(paginationQuerySchema.parse({ limit: "100", cursor: "abc" })).toEqual({
      limit: 100,
      cursor: "abc",
    });
  });

  it("rejects 0, 101, text, a fraction, an empty or over-long cursor and unknown parameters", () => {
    for (const query of [
      { limit: "0" },
      { limit: "101" },
      { limit: "abc" },
      { limit: "1.5" },
      { cursor: "" },
      { cursor: "x".repeat(513) },
      { sort: "name" },
    ]) {
      expect(paginationQuerySchema.safeParse(query).success).toBe(false);
    }
  });
});

describe("pageSchema", () => {
  const schema = pageSchema(z.object({ id: z.string() }));

  it("is a list of items and a cursor that is null on the last page", () => {
    expect(schema.parse({ items: [{ id: "a" }], nextCursor: null })).toEqual({
      items: [{ id: "a" }],
      nextCursor: null,
    });
    expect(schema.parse({ items: [], nextCursor: "abc" }).nextCursor).toBe("abc");
    expect(schema.safeParse({ items: [] }).success).toBe(false);
  });
});
