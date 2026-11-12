import type { z } from "zod";

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

export type ResponseContract = JsonResponseContract | ProblemResponseContract;

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
 * The single description of one API operation. The OpenAPI document is generated from
 * these, and a test checks that each one has a matching route handler.
 */
export interface EndpointContract {
  method: HttpMethod;
  /** Full path as OpenAPI writes it, e.g. `/api/v1/tasks/{taskId}`. */
  path: `/api/v1/${string}`;
  summary: string;
  description?: string;
  /** True only for endpoints a work-spec explicitly declares public (AGENTS.md rule 6). */
  public: boolean;
  request?: RequestContract;
  /**
   * Keyed by HTTP status code. `401` and `403` are added to every non-public operation
   * automatically; list them only to give a more specific description.
   */
  responses: Readonly<Record<number, ResponseContract>>;
}
