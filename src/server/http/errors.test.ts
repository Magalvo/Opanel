import { describe, expect, it } from "vitest";

import {
  ApiError,
  conflict,
  forbidden,
  internalError,
  invalidRequest,
  notFound,
  rateLimited,
  unauthenticated,
  unsupportedMediaType,
} from "./errors";

describe("ApiError constructors", () => {
  it.each([
    ["invalidRequest", invalidRequest(), 400, "Bad Request", "invalid_request"],
    ["unauthenticated", unauthenticated(), 401, "Unauthorized", "unauthenticated"],
    ["forbidden", forbidden(), 403, "Forbidden", "forbidden"],
    ["notFound", notFound(), 404, "Not Found", "not_found"],
    ["conflict", conflict("Already exists."), 409, "Conflict", "conflict"],
    [
      "unsupportedMediaType",
      unsupportedMediaType(),
      415,
      "Unsupported Media Type",
      "unsupported_media_type",
    ],
    ["rateLimited", rateLimited(30), 429, "Too Many Requests", "rate_limited"],
    ["internalError", internalError(), 500, "Internal Server Error", "internal_error"],
  ])("%s carries the status and code of doc 0004", (_name, error, status, title, code) => {
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(status);
    expect(error.title).toBe(title);
    expect(error.code).toBe(code);
    expect(error.detail.length).toBeGreaterThan(0);
  });

  it("keeps the per-field errors of an invalid request", () => {
    const errors = [{ path: "title", message: "Required" }];

    expect(invalidRequest(errors).errors).toEqual(errors);
    expect(invalidRequest().errors).toBeUndefined();
  });

  it("keeps a custom detail", () => {
    expect(conflict("Already exists.").detail).toBe("Already exists.");
    expect(notFound("No such project.").detail).toBe("No such project.");
  });

  it("keeps the wait of a rate limit, in whole seconds", () => {
    expect(rateLimited(30).retryAfterSeconds).toBe(30);
    expect(rateLimited(0.2).retryAfterSeconds).toBe(1);
  });
});
