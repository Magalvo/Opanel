import { describe, expect, it } from "vitest";

import { PROBLEM_CODES, problemSchema } from "./problem";

const minimal = {
  type: "about:blank",
  title: "Not Found",
  status: 404,
  code: "not_found",
  detail: "The resource does not exist.",
  requestId: "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f",
};

describe("problemSchema", () => {
  it("accepts a minimal problem", () => {
    expect(problemSchema.parse(minimal)).toEqual(minimal);
  });

  it("accepts a validation problem with per-field errors", () => {
    const problem = {
      ...minimal,
      title: "Bad Request",
      status: 400,
      code: "invalid_request",
      errors: [{ path: "evidence.http.status", message: "Must be a whole number" }],
    };

    expect(problemSchema.parse(problem)).toEqual(problem);
  });

  it("knows the base codes of canonical doc 0004 and the specific ones of work-specs", () => {
    expect([...PROBLEM_CODES].sort()).toEqual([
      "account_inactive",
      "column_not_empty",
      "conflict",
      "forbidden",
      "internal_error",
      "invalid_link",
      "invalid_request",
      "last_admin",
      "last_done_column",
      "not_found",
      "project_archived",
      "project_key_taken",
      "rate_limited",
      "team_in_use",
      "team_name_taken",
      "unauthenticated",
      "unsupported_media_type",
      "version_conflict",
    ]);
  });

  it("accepts the current entity of a version conflict", () => {
    const problem = {
      ...minimal,
      title: "Conflict",
      status: 409,
      code: "version_conflict",
      current: { id: "x", version: 3 },
    };

    expect(problemSchema.parse(problem)).toEqual(problem);
  });

  it("rejects an unknown code", () => {
    expect(problemSchema.safeParse({ ...minimal, code: "teapot" }).success).toBe(false);
  });

  it("rejects a missing or malformed request id", () => {
    const { requestId: _requestId, ...withoutId } = minimal;

    expect(problemSchema.safeParse(withoutId).success).toBe(false);
    expect(problemSchema.safeParse({ ...minimal, requestId: "abc" }).success).toBe(false);
  });

  it("rejects a status that is not an error", () => {
    expect(problemSchema.safeParse({ ...minimal, status: 200 }).success).toBe(false);
  });

  it("rejects extra fields, at the top level and inside errors", () => {
    expect(problemSchema.safeParse({ ...minimal, stack: "at foo" }).success).toBe(false);
    expect(
      problemSchema.safeParse({
        ...minimal,
        errors: [{ path: "a", message: "b", value: "secret" }],
      }).success,
    ).toBe(false);
  });
});
