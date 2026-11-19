import type { FieldError, ProblemCode } from "@/lib/schemas/problem";

interface ApiErrorInit {
  status: number;
  title: string;
  code: ProblemCode;
  detail: string;
  errors?: readonly FieldError[] | undefined;
  retryAfterSeconds?: number | undefined;
  current?: unknown;
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
  /** Only on `version_conflict`: the entity as it is now, sent as `current` (WS-027). */
  readonly current: unknown;

  constructor(init: ApiErrorInit) {
    super(init.detail);
    this.name = "ApiError";
    this.status = init.status;
    this.title = init.title;
    this.code = init.code;
    this.detail = init.detail;
    this.errors = init.errors;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.current = init.current;
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

/** The first-run setup's token is missing or wrong (WS-050). The same for both cases. */
export function invalidSetupToken(): ApiError {
  return new ApiError({
    status: 403,
    title: "Forbidden",
    code: "invalid_setup_token",
    detail: "The setup token is missing or not correct.",
  });
}

/**
 * A production server with no `SETUP_TOKEN` refuses the first-run setup (WS-055). Says only
 * what the setup page says too; never a value.
 */
export function setupTokenNotConfigured(): ApiError {
  return new ApiError({
    status: 403,
    title: "Forbidden",
    code: "setup_token_not_configured",
    detail: "First-run setup needs SETUP_TOKEN in the server's configuration.",
  });
}

export function notFound(detail = "The resource does not exist."): ApiError {
  return new ApiError({ status: 404, title: "Not Found", code: "not_found", detail });
}

export function conflict(detail: string): ApiError {
  return new ApiError({ status: 409, title: "Conflict", code: "conflict", detail });
}

/** `409` with the specific code of WS-018: the change would leave no active Admin. */
export function lastAdmin(
  detail = "This would leave the installation without an active administrator.",
): ApiError {
  return new ApiError({ status: 409, title: "Conflict", code: "last_admin", detail });
}

/**
 * `409` with the specific code of WS-027: the change was based on an older `version`.
 * `current` is the entity as its `GET` returns it, so it holds nothing the caller cannot read.
 */
export function versionConflict(
  current: unknown,
  detail = "This was changed by someone else. Reload it and try again.",
): ApiError {
  return new ApiError({
    status: 409,
    title: "Conflict",
    code: "version_conflict",
    detail,
    current,
  });
}

/** `409` with the specific code of WS-030: a task is assigned to the team. */
export function teamInUse(
  detail = "Tasks are assigned to this team, including deleted ones. Reassign them before deleting it.",
): ApiError {
  return new ApiError({ status: 409, title: "Conflict", code: "team_in_use", detail });
}

/** `409` with the specific code of WS-030: the column holds tasks. */
export function columnNotEmpty(
  detail = "This column holds tasks. Move them before deleting it.",
): ApiError {
  return new ApiError({ status: 409, title: "Conflict", code: "column_not_empty", detail });
}

/** `409` with the specific code of WS-029: a project keeps at least one `done` column. */
export function lastDoneColumn(
  detail = "A project needs at least one done column. Add another one first.",
): ApiError {
  return new ApiError({ status: 409, title: "Conflict", code: "last_done_column", detail });
}

/** `409` with the specific code of WS-028: another project has this key. */
export function projectKeyTaken(detail = "Another project already has this key."): ApiError {
  return new ApiError({ status: 409, title: "Conflict", code: "project_key_taken", detail });
}

/** `409` with the specific code of WS-028: the project is archived, so it is read-only. */
export function projectArchived(
  detail = "This project is archived. Unarchive it to change it.",
): ApiError {
  return new ApiError({ status: 409, title: "Conflict", code: "project_archived", detail });
}

/** `409` with the specific code of WS-026: another team has this name, ignoring case. */
export function teamNameTaken(detail = "Another team already has this name."): ApiError {
  return new ApiError({ status: 409, title: "Conflict", code: "team_name_taken", detail });
}

/** `409` (WS-075): another agent has this name, ignoring case. */
export function agentNameTaken(detail = "Another agent already has this name."): ApiError {
  return new ApiError({ status: 409, title: "Conflict", code: "agent_name_taken", detail });
}

/** `409` (WS-075): the agent already holds 10 usable tokens (WT-05 decision 4). */
export function tooManyTokens(
  detail = "This agent already has 10 usable tokens. Revoke one first.",
): ApiError {
  return new ApiError({ status: 409, title: "Conflict", code: "too_many_tokens", detail });
}

/** `409` (WS-075): a disabled agent gets no new token. */
export function agentDisabled(detail = "This agent is disabled. Re-enable it first."): ApiError {
  return new ApiError({ status: 409, title: "Conflict", code: "agent_disabled", detail });
}

/** `409` with the specific code of WS-026: the account is deactivated. */
export function accountInactive(detail = "This person is deactivated."): ApiError {
  return new ApiError({ status: 409, title: "Conflict", code: "account_inactive", detail });
}

/**
 * `404` with the specific code of WS-019: the one-time link is unknown, used, expired,
 * replaced, or belongs to a deactivated account. Deliberately one answer for all of them.
 */
export function invalidLink(
  detail = "This link is no longer valid. Ask an administrator for a new one.",
): ApiError {
  return new ApiError({ status: 404, title: "Not Found", code: "invalid_link", detail });
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

/** `413` (WS-044): the JSON body is larger than the budget. The detail does not state it. */
export function payloadTooLarge(): ApiError {
  return new ApiError({
    status: 413,
    title: "Content Too Large",
    code: "payload_too_large",
    detail: "The request body is too large.",
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

/** An account already holds the most event streams a process allows (WS-047). */
export function tooManyStreams(): ApiError {
  return new ApiError({
    status: 429,
    title: "Too Many Requests",
    code: "too_many_streams",
    detail: "Too many open event streams. Close one, or try again later.",
    retryAfterSeconds: 30,
  });
}

/** The password hashing queue is full (WS-056): try again in a second. */
export function serverBusy(): ApiError {
  return new ApiError({
    status: 429,
    title: "Too Many Requests",
    code: "server_busy",
    detail: "The server is busy. Try again in a moment.",
    retryAfterSeconds: 1,
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
