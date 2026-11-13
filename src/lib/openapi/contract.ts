import type { z } from "zod";

import type { Permission } from "@/lib/schemas/permissions";

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

export type ResponseContract =
  JsonResponseContract | ProblemResponseContract | NoContentResponseContract;

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
   * automatically; list them only to give a more specific description.
   */
  responses: Readonly<Record<number, ResponseContract>>;
}
