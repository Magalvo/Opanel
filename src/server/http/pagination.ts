import { z } from "zod";

import { invalidRequest } from "./errors";

/**
 * Where a page ended: the creation time with microsecond precision, as text (a JavaScript
 * `Date` would truncate to milliseconds and repeat a row) and the id that breaks ties.
 */
export interface Cursor {
  /** ISO 8601 UTC with six fractional digits, e.g. `2026-11-12T10:00:00.123456Z`. */
  createdAt: string;
  id: string;
}

const cursorSchema = z.strictObject({
  t: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
  i: z.uuid(),
});

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify({ t: cursor.createdAt, i: cursor.id })).toString("base64url");
}

/** Throws `400` naming the field `cursor` if the value is not a cursor this API produced. */
export function decodeCursor(value: string): Cursor {
  const invalid = invalidRequest([{ path: "cursor", message: "Invalid cursor." }]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw invalid;
  }
  const result = cursorSchema.safeParse(parsed);
  if (!result.success) {
    throw invalid;
  }
  return { createdAt: result.data.t, id: result.data.i };
}

/**
 * Where a page ordered by name ended (WS-026): the last row's name and the id that breaks
 * ties. Used by lists ordered by name, such as people and teams.
 */
export interface NameCursor {
  name: string;
  id: string;
}

const nameCursorSchema = z.strictObject({
  n: z.string().max(100),
  i: z.uuid(),
});

export function encodeNameCursor(cursor: NameCursor): string {
  return Buffer.from(JSON.stringify({ n: cursor.name, i: cursor.id })).toString("base64url");
}

/** Throws `400` naming the field `cursor` if the value is not a name cursor of this API. */
export function decodeNameCursor(value: string): NameCursor {
  const invalid = invalidRequest([{ path: "cursor", message: "Invalid cursor." }]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw invalid;
  }
  const result = nameCursorSchema.safeParse(parsed);
  if (!result.success) {
    throw invalid;
  }
  return { name: result.data.n, id: result.data.i };
}
