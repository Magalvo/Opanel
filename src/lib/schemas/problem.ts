import { z } from "zod";

/**
 * Base error codes of the API (canonical doc 0004, section 4). Clients branch on these.
 * A work-spec may add a more specific code; codes are never renamed or reused.
 */
export const PROBLEM_CODES = [
  "invalid_request",
  "unauthenticated",
  "forbidden",
  "not_found",
  "conflict",
  "unsupported_media_type",
  "rate_limited",
  "internal_error",
] as const;

export const problemCodeSchema = z.enum(PROBLEM_CODES);

export type ProblemCode = z.infer<typeof problemCodeSchema>;

/** One failing field of an invalid request. Never contains the rejected value. */
export const fieldErrorSchema = z.strictObject({
  path: z.string().meta({
    description: "Dotted path of the field, e.g. `evidence.http.status`. Empty for the root.",
  }),
  message: z.string(),
});

export type FieldError = z.infer<typeof fieldErrorSchema>;

/** Body of every error response: RFC 9457 problem details plus `code` and `requestId`. */
export const problemSchema = z
  .strictObject({
    type: z.literal("about:blank"),
    title: z.string().meta({ description: "The HTTP status phrase." }),
    status: z.int().min(400).max(599),
    code: problemCodeSchema.meta({
      description: "Stable, machine-readable error code. This is what clients branch on.",
    }),
    detail: z.string().meta({ description: "Explanation for people. Wording may change." }),
    requestId: z.uuid().meta({ description: "Same value as the `X-Request-Id` header." }),
    errors: z
      .array(fieldErrorSchema)
      .optional()
      .meta({ description: "Present on validation failures: one entry per failing field." }),
  })
  .meta({
    id: "Problem",
    description: "An error, as RFC 9457 problem details (`application/problem+json`).",
  });

export type Problem = z.infer<typeof problemSchema>;

export const PROBLEM_CONTENT_TYPE = "application/problem+json";
