import type { z } from "zod";

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

export interface ResponseContract {
  description: string;
  /** JSON body of the response. */
  schema: z.ZodType;
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
  /** Keyed by HTTP status code. */
  responses: Readonly<Record<number, ResponseContract>>;
}
