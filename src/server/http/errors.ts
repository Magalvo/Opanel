import type { FieldError, ProblemCode } from "@/lib/schemas/problem";

interface ApiErrorInit {
  status: number;
  title: string;
  code: ProblemCode;
  detail: string;
  errors?: readonly FieldError[] | undefined;
  retryAfterSeconds?: number | undefined;
}

/**
 * An expected failure of an API call (canonical doc 0004, section 4). Route handlers and
 * services throw it; the route wrapper turns it into a problem-details response. Nothing
 * in it may be secret: `detail` and `errors` are sent to the client as they are.
 */
export class ApiError extends Error {
  readonly status: number;
  /** The HTTP status phrase. */
  readonly title: string;
  readonly code: ProblemCode;
  readonly detail: string;
  readonly errors: readonly FieldError[] | undefined;
  /** Only on rate limits: sent as the `Retry-After` header. */
  readonly retryAfterSeconds: number | undefined;

  constructor(init: ApiErrorInit) {
    super(init.detail);
    this.name = "ApiError";
    this.status = init.status;
    this.title = init.title;
    this.code = init.code;
    this.detail = init.detail;
    this.errors = init.errors;
    this.retryAfterSeconds = init.retryAfterSeconds;
  }
}

export function invalidRequest(
  errors?: readonly FieldError[],
  detail = "The request is not valid.",
): ApiError {
  return new ApiError({
    status: 400,
    title: "Bad Request",
    code: "invalid_request",
    detail,
    errors,
  });
}

export function unauthenticated(detail = "Valid credentials are required."): ApiError {
  return new ApiError({ status: 401, title: "Unauthorized", code: "unauthenticated", detail });
}

export function forbidden(detail = "You are not allowed to do this."): ApiError {
  return new ApiError({ status: 403, title: "Forbidden", code: "forbidden", detail });
}

export function notFound(detail = "The resource does not exist."): ApiError {
  return new ApiError({ status: 404, title: "Not Found", code: "not_found", detail });
}

export function conflict(detail: string): ApiError {
  return new ApiError({ status: 409, title: "Conflict", code: "conflict", detail });
}

export function unsupportedMediaType(
  detail = "The request body must be sent as application/json.",
): ApiError {
  return new ApiError({
    status: 415,
    title: "Unsupported Media Type",
    code: "unsupported_media_type",
    detail,
  });
}

export function rateLimited(retryAfterSeconds: number): ApiError {
  return new ApiError({
    status: 429,
    title: "Too Many Requests",
    code: "rate_limited",
    detail: "Too many requests. Try again later.",
    retryAfterSeconds: Math.max(1, Math.ceil(retryAfterSeconds)),
  });
}

export function internalError(): ApiError {
  return new ApiError({
    status: 500,
    title: "Internal Server Error",
    code: "internal_error",
    detail: "An unexpected error occurred.",
  });
}
