import { describe, expect, it } from "vitest";
import { z } from "zod";

import { encodeNameCursor } from "@/server/http/pagination";

import { MAX_CURSOR_LENGTH, pageSchema, paginationQuerySchema } from "./pagination";

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
      { cursor: "x".repeat(2049) },
      { sort: "name" },
    ]) {
      expect(paginationQuerySchema.safeParse(query).success).toBe(false);
    }
  });
});

describe("the cursor parameter (WS-081)", () => {
  it("accepts the longest name cursor the API produces: 200 characters JSON escapes", () => {
    const cursor = encodeNameCursor({
      name: "\u0001".repeat(200),
      id: "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f",
    });

    expect(cursor).toHaveLength(1668);
    expect(paginationQuerySchema.parse({ cursor }).cursor).toBe(cursor);
    expect(MAX_CURSOR_LENGTH).toBe(2048);
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
