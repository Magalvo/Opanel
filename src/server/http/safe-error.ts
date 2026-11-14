/**
 * What a log line may say about an unexpected error (WS-042).
 *
 * The message of an error is free text written by a library, and the installed Drizzle puts
 * the SQL and its parameters into it (`Failed query: ... params: ...`). So no log line is
 * built from `message`, `stack`, `detail` or `cause` text. A line is built only from values
 * that match a strict pattern, and anything else is left out.
 */

const CLASS_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
// A PostgreSQL SQLSTATE such as 23505, or a Node system code such as ECONNREFUSED.
const ERROR_CODE = /^(?:[0-9A-Z]{5}|E[A-Z0-9_]{2,20})$/;
// A schema identifier, never row data.
const CONSTRAINT = /^[a-z0-9_]{1,63}$/;
const MAX_CAUSE_DEPTH = 5;

function matching(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === "string" && pattern.test(value) ? value : undefined;
}

/** `Error.name` is "Error" for classes that do not set it (Drizzle's), so look at the class. */
function classNameOf(error: Error): string {
  const named = matching(error.name, CLASS_NAME);
  if (named !== undefined && named !== "Error") {
    return named;
  }
  return matching(error.constructor.name, CLASS_NAME) ?? named ?? "Error";
}

/** The first allowed code and constraint on the error or down its `cause` chain. */
function databaseDetails(error: Error): { code?: string; constraint?: string } {
  const seen = new Set<unknown>();
  let code: string | undefined;
  let constraint: string | undefined;

  let current: unknown = error;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth += 1) {
    if (!(current instanceof Error) || seen.has(current)) {
      break;
    }
    seen.add(current);
    code ??= matching((current as { code?: unknown }).code, ERROR_CODE);
    constraint ??= matching((current as { constraint_name?: unknown }).constraint_name, CONSTRAINT);
    current = current.cause;
  }

  return {
    ...(code === undefined ? {} : { code }),
    ...(constraint === undefined ? {} : { constraint }),
  };
}

/** For example `DrizzleQueryError code=23505 constraint=accounts_email_unique`. */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "unknown error";
  }

  const { code, constraint } = databaseDetails(error);
  return [
    classNameOf(error),
    ...(code === undefined ? [] : [`code=${code}`]),
    ...(constraint === undefined ? [] : [`constraint=${constraint}`]),
  ].join(" ");
}
