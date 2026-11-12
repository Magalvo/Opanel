import { describe, expect, it } from "vitest";

import { ApiError } from "./errors";
import { decodeCursor, encodeCursor } from "./pagination";

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
