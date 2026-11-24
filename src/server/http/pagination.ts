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
  // A real instant (WS-051): the query casts it to timestamptz, so an impossible date would
  // fail there. Zod checks the calendar; PostgreSQL also refuses year 0000, which Zod allows.
  t: z.iso.datetime({ precision: 6 }).refine((value) => !value.startsWith("0000-")),
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

/**
 * The longest name a name cursor carries: an epic title (WS-081). A test checks every name
 * schema paged by a name cursor against it, so the two cannot drift apart.
 */
export const NAME_CURSOR_MAX_LENGTH = 200;

const nameCursorSchema = z.strictObject({
  n: z.string().max(NAME_CURSOR_MAX_LENGTH),
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

/**
 * Where a page in board order ended (WS-030): the last task's column position, its own
 * position and its id. Positions compare byte by byte (WT-03 amendment A2).
 */
export interface BoardCursor {
  columnPosition: string;
  position: string;
  id: string;
}

const boardCursorSchema = z.strictObject({
  c: z.string().min(1).max(2000),
  p: z.string().min(1).max(2000),
  i: z.uuid(),
});

export function encodeBoardCursor(cursor: BoardCursor): string {
  return Buffer.from(
    JSON.stringify({ c: cursor.columnPosition, p: cursor.position, i: cursor.id }),
  ).toString("base64url");
}

/** Throws `400` naming the field `cursor` if the value is not a board cursor of this API. */
export function decodeBoardCursor(value: string): BoardCursor {
  const invalid = invalidRequest([{ path: "cursor", message: "Invalid cursor." }]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw invalid;
  }
  const result = boardCursorSchema.safeParse(parsed);
  if (!result.success) {
    throw invalid;
  }
  return { columnPosition: result.data.c, position: result.data.p, id: result.data.i };
}

/**
 * Where a page of the backlog ended (WS-101): the last task's position and its id.
 * Positions compare byte by byte (WT-03 amendment A2).
 */
export interface BacklogCursor {
  position: string;
  id: string;
}

const backlogCursorSchema = z.strictObject({
  p: z.string().min(1).max(2000),
  i: z.uuid(),
});

export function encodeBacklogCursor(cursor: BacklogCursor): string {
  return Buffer.from(JSON.stringify({ p: cursor.position, i: cursor.id })).toString("base64url");
}

/** Throws `400` naming the field `cursor` if the value is not a backlog cursor of this API. */
export function decodeBacklogCursor(value: string): BacklogCursor {
  const invalid = invalidRequest([{ path: "cursor", message: "Invalid cursor." }]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw invalid;
  }
  const result = backlogCursorSchema.safeParse(parsed);
  if (!result.success) {
    throw invalid;
  }
  return { position: result.data.p, id: result.data.i };
}

/**
 * Where a page of a task's activity ended (WS-117): the last item's time with microseconds,
 * its kind and its id as text, the order of the list.
 */
export interface ActivityCursor {
  createdAt: string;
  kind: "comment" | "event";
  id: string;
}

const activityCursorSchema = z.strictObject({
  t: z.iso.datetime({ precision: 6 }).refine((value) => !value.startsWith("0000-")),
  k: z.enum(["comment", "event"]),
  i: z
    .string()
    .regex(/^(?:\d{1,19}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/),
});

export function encodeActivityCursor(cursor: ActivityCursor): string {
  return Buffer.from(
    JSON.stringify({ t: cursor.createdAt, k: cursor.kind, i: cursor.id }),
  ).toString("base64url");
}

/** Throws `400` naming the field `cursor` if the value is not an activity cursor of this API. */
export function decodeActivityCursor(value: string): ActivityCursor {
  const invalid = invalidRequest([{ path: "cursor", message: "Invalid cursor." }]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw invalid;
  }
  const result = activityCursorSchema.safeParse(parsed);
  if (!result.success) {
    throw invalid;
  }
  return { createdAt: result.data.t, kind: result.data.k, id: result.data.i };
}

/**
 * Where a page of the list across projects ended (WS-118): its sort, the last task's sort
 * values as text, and its id. A cursor of another sort is refused.
 */
export interface TaskListCursor {
  sort: string;
  values: string[];
  id: string;
}

const taskListCursorSchema = z.strictObject({
  s: z.string().min(1).max(20),
  v: z.array(z.string().max(2000)).min(1).max(2),
  i: z.uuid(),
});

export function encodeTaskListCursor(cursor: TaskListCursor): string {
  return Buffer.from(JSON.stringify({ s: cursor.sort, v: cursor.values, i: cursor.id })).toString(
    "base64url",
  );
}

/** Throws `400` naming `cursor` unless the value is a task list cursor for `sort`. */
export function decodeTaskListCursor(value: string, sort: string, length: number): TaskListCursor {
  const invalid = invalidRequest([{ path: "cursor", message: "Invalid cursor." }]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw invalid;
  }
  const result = taskListCursorSchema.safeParse(parsed);
  if (!result.success || result.data.s !== sort || result.data.v.length !== length) {
    throw invalid;
  }
  return { sort: result.data.s, values: result.data.v, id: result.data.i };
}
