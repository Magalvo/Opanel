import { describe, expect, it } from "vitest";

import { ApiError } from "./errors";
import {
  decodeBoardCursor,
  decodeCursor,
  decodeNameCursor,
  encodeBoardCursor,
  encodeCursor,
  encodeNameCursor,
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

  it("are opaque URL-safe text", () => {
    expect(encodeNameCursor(nameCursor)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("refuse a creation-time cursor, garbage or a wrong shape with a 400 naming cursor", () => {
    const tooLong = Buffer.from(JSON.stringify({ n: "x".repeat(101), i: nameCursor.id })).toString(
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
