import { describe, expect, it } from "vitest";

import { accountNameSchema } from "@/lib/schemas/accounts";
import { agentNameSchema } from "@/lib/schemas/agents";
import { epicTitleSchema } from "@/lib/schemas/epics";
import { projectNameSchema } from "@/lib/schemas/projects";
import { teamNameSchema } from "@/lib/schemas/teams";

import { ApiError } from "./errors";
import {
  decodeBoardCursor,
  decodeCursor,
  decodeNameCursor,
  encodeBoardCursor,
  encodeCursor,
  encodeNameCursor,
  NAME_CURSOR_MAX_LENGTH,
} from "./pagination";

const cursor = {
  createdAt: "2026-11-12T10:00:00.123456Z",
  id: "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f",
};

function failure(value: string): ApiError {
  try {
    decodeCursor(value);
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected a failure");
}

describe("cursors", () => {
  it("round-trip, keeping microseconds", () => {
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("are opaque URL-safe text", () => {
    expect(encodeCursor(cursor)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("that are garbage, the wrong shape or tampered are a 400 naming the field cursor", () => {
    const wrongShape = Buffer.from(JSON.stringify({ t: "yesterday", i: "x" })).toString(
      "base64url",
    );
    for (const value of [
      "not a cursor!",
      "e30",
      wrongShape,
      Buffer.from("[]").toString("base64url"),
    ]) {
      const error = failure(value);
      expect(error.status).toBe(400);
      expect(error.code).toBe("invalid_request");
      expect(error.errors).toEqual([{ path: "cursor", message: "Invalid cursor." }]);
    }
  });

  function raw(t: string, i: string = cursor.id): string {
    return Buffer.from(JSON.stringify({ t, i })).toString("base64url");
  }

  it("whose time is no real instant PostgreSQL accepts are a 400 (WS-051)", () => {
    for (const t of [
      "2026-99-99T25:61:61.000000Z",
      "2026-13-01T10:00:00.000000Z",
      "2026-11-32T10:00:00.000000Z",
      "2026-02-29T10:00:00.000000Z",
      "2026-02-30T10:00:00.000000Z",
      "2026-11-12T24:00:00.000000Z",
      "2026-11-12T10:60:00.000000Z",
      "2026-11-12T10:00:60.000000Z",
      "0000-01-01T00:00:00.000000Z",
    ]) {
      const error = failure(raw(t));
      expect(error.status, t).toBe(400);
      expect(error.errors, t).toEqual([{ path: "cursor", message: "Invalid cursor." }]);
    }
    expect(failure(raw(cursor.createdAt, "0f8b6c1e-3a52-4d7b-9a51")).status).toBe(400);
  });

  it("whose time is not six fractional digits and Z are still a 400 (WS-051)", () => {
    for (const t of [
      "2026-11-12T10:00:00.123Z",
      "2026-11-12T10:00:00.123456789Z",
      "2026-11-12T10:00:00Z",
      "2026-11-12T10:00:00.123456+00:00",
      "2026-11-12T10:00:00.123456z",
    ]) {
      expect(failure(raw(t)).status, t).toBe(400);
    }
  });

  it("keep the text of every valid time, leap days and bounds included (WS-051)", () => {
    for (const t of [
      "2024-02-29T23:59:59.999999Z",
      "0001-01-01T00:00:00.000000Z",
      "9999-12-31T23:59:59.999999Z",
    ]) {
      expect(decodeCursor(raw(t))).toEqual({ createdAt: t, id: cursor.id });
    }
  });
});

describe("name cursors (WS-026)", () => {
  const nameCursor = { name: "Ada Lovelace", id: "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f" };

  function nameFailure(value: string): ApiError {
    try {
      decodeNameCursor(value);
    } catch (error) {
      if (error instanceof ApiError) return error;
      throw error;
    }
    throw new Error("expected a failure");
  }

  it("round-trip, including names with any characters", () => {
    expect(decodeNameCursor(encodeNameCursor(nameCursor))).toEqual(nameCursor);
    const odd = { name: 'Zoë "Q" % _ 名前', id: nameCursor.id };
    expect(decodeNameCursor(encodeNameCursor(odd))).toEqual(odd);
  });

  it.each([
    ["ASCII", "x"],
    ["CJK", "名"],
  ])("round-trip a 200-character %s name, the longest an epic title may be (WS-081)", (_, char) => {
    const long = { name: char.repeat(200), id: nameCursor.id };

    expect(decodeNameCursor(encodeNameCursor(long))).toEqual(long);
  });

  it("bound the name by the longest name a paged list carries (WS-081)", () => {
    const names = {
      accountNameSchema,
      agentNameSchema,
      projectNameSchema,
      teamNameSchema,
      epicTitleSchema,
    };
    for (const [name, schema] of Object.entries(names)) {
      expect(schema.maxLength, name).toBeTypeOf("number");
      expect(schema.maxLength ?? Infinity, name).toBeLessThanOrEqual(NAME_CURSOR_MAX_LENGTH);
    }
    expect(NAME_CURSOR_MAX_LENGTH).toBe(200);
  });

  it("are opaque URL-safe text", () => {
    expect(encodeNameCursor(nameCursor)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("refuse a creation-time cursor, garbage or a wrong shape with a 400 naming cursor", () => {
    const tooLong = Buffer.from(JSON.stringify({ n: "x".repeat(201), i: nameCursor.id })).toString(
      "base64url",
    );
    for (const value of [encodeCursor(cursor), "not a cursor!", "e30", tooLong]) {
      const error = nameFailure(value);
      expect(error.status).toBe(400);
      expect(error.errors).toEqual([{ path: "cursor", message: "Invalid cursor." }]);
    }
  });

  it("are not accepted where a creation-time cursor is expected", () => {
    expect(failure(encodeNameCursor(nameCursor)).status).toBe(400);
  });
});

describe("board cursors (WS-030)", () => {
  const board = {
    columnPosition: "a1",
    position: "a0V",
    id: "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f",
  };

  it("round-trip and are URL-safe", () => {
    expect(decodeBoardCursor(encodeBoardCursor(board))).toEqual(board);
    expect(encodeBoardCursor(board)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("refuse other cursors and garbage with a 400 naming cursor", () => {
    for (const value of [
      encodeCursor(cursor),
      encodeNameCursor({ name: "A", id: board.id }),
      "x!",
    ]) {
      let error: unknown;
      try {
        decodeBoardCursor(value);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).errors).toEqual([{ path: "cursor", message: "Invalid cursor." }]);
    }
  });
});
