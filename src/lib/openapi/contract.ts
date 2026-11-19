import type { z } from "zod";

import type { Permission } from "@/lib/schemas/permissions";
import type { ProblemCode } from "@/lib/schemas/problem";

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

/** A response with a JSON body. */
export interface JsonResponseContract {
  description: string;
  /** JSON body of the response. */
  schema: z.ZodType;
}

/** An error response: problem details, as `application/problem+json` (doc 0004). */
export interface ProblemResponseContract {
  description: string;
  problem: true;
}

/** A successful response with no body, e.g. `204`. */
export interface NoContentResponseContract {
  description: string;
  noContent: true;
}

/**
 * `409 version_conflict` for an entity (WS-027): a problem body whose `current` is the
 * entity. Write it with `versionConflictResponse(entitySchema, otherCodes)`. The entity
 * schema needs a `meta({ id })`, which names the conflict schema `<id>VersionConflict`.
 * `otherCodes` are the other `409`s the operation can answer (WS-083), plain problems; the
 * document then offers both schemas.
 */
export interface VersionConflictResponseContract {
  description: string;
  conflictOf: z.ZodType;
  otherCodes: readonly ProblemCode[];
}

/**
 * A Server-Sent Events stream (WS-047): `text/event-stream`, each event's `data` one value
 * of `eventStream`.
 */
export interface EventStreamResponseContract {
  description: string;
  eventStream: z.ZodType;
}

export type ResponseContract =
  | JsonResponseContract
  | EventStreamResponseContract
  | ProblemResponseContract
  | NoContentResponseContract
  | VersionConflictResponseContract;

/** What the operation accepts. Each part is the strict Zod schema the handler validates with. */
export interface RequestContract {
  /** Path parameters, e.g. `z.strictObject({ taskId: z.uuid() })`. */
  params?: z.ZodObject;
  /** Query string parameters. */
  query?: z.ZodObject;
  /** JSON request body. */
  body?: z.ZodType;
}

/**
 * Who may call an operation (AGENTS.md hard rule 6, canonical doc 0004 section 7). The
 * `route()` wrapper enforces it before the handler runs (WS-025).
 */
export type Access =
  /** Anyone. Only for operations a work-spec explicitly declares public. */
  | { kind: "public" }
  /** Any signed-in account; for operations on the caller's own session or account only. */
  | { kind: "authenticated" }
  /**
   * A person's own signed-in session: an API token is refused with `403` (WS-072). For the
   * operations on the caller's own profile, password or session.
   */
  | { kind: "session" }
  /** A signed-in account holding this one permission from the catalogue. */
  | { kind: "permission"; permission: Permission };

/**
 * The single description of one API operation. The OpenAPI document is generated from
 * these, and a test checks that each one has a matching route handler.
 */
export interface EndpointContract {
  method: HttpMethod;
  /** Full path as OpenAPI writes it, e.g. `/api/v1/tasks/{taskId}`. */
  path: `/api/v1/${string}`;
  summary: string;
  description?: string;
  /** Who may call it. Enforced by `route()`, documented in OpenAPI, checked by a test. */
  access: Access;
  request?: RequestContract;
  /**
   * Keyed by HTTP status code. `401` and `403` are added to every non-public operation
   * automatically, and `429 rate_limited` to every operation a token may call (WS-083);
   * list them only to give a more specific description. An operation's own `429` keeps
   * its description, and the token's sentence is added to it.
   */
  responses: Readonly<Record<number, ResponseContract>>;
}
