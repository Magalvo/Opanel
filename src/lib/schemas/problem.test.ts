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

  it("knows the base codes of canonical doc 0004", () => {
    expect([...PROBLEM_CODES].sort()).toEqual([
      "conflict",
      "forbidden",
      "internal_error",
      "invalid_request",
      "not_found",
      "rate_limited",
      "unauthenticated",
      "unsupported_media_type",
    ]);
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
