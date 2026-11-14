# WS-042 — Safe error logging

- Status: Done
- Work-item: [WI-042](../work-items/WI-042-safe-error-logging.md)
- Canonical docs: [0004](../canonical/0004-api-conventions.md) section 4; `AGENTS.md` hard
  rule 7; audit of 2026-11-14, finding A-04

## Approach

### Evidence

`src/server/http/route.ts` (the `catch` in `withSharedBehaviour`) and
`src/server/services/health.ts` log `` `${error.name}: ${error.message}` ``. In the
installed `drizzle-orm@0.45.4` (`node_modules/drizzle-orm/errors.js`),
`DrizzleQueryError` is built as `super(`Failed query: ${query}\nparams: ${params}`)`. The
driver's own error (`postgres-js`, the `cause`) also carries a `detail` such as
`Key (email)=(x@y.z) already exists`. So the message of a failed query can hold the
parameters of the query: the password hash on an insert into `credentials`, an email, a task
description. The response to the client is already generic; only the log leaks.

### One function decides what a log line may say

`describeError(error: unknown): string` in a new `src/server/http/safe-error.ts`. It is a
pure function and builds the text only from an allow-list, never from free text:

- the error's class name, only if it matches `^[A-Za-z][A-Za-z0-9_]{0,63}$`, else `Error`;
- from the error and its `cause` chain (at most 5 levels, cycles ignored), the first
  `code` that matches `^(?:[0-9A-Z]{5}|E[A-Z0-9_]{2,20})$` (a PostgreSQL SQLSTATE such as
  `23505`, or a Node system code such as `ECONNREFUSED`), written as `code=...`;
- the first `constraint_name` property (the name `postgres-js` gives it) matching `^[a-z0-9_]{1,63}$` (a schema identifier, not
  data), written as `constraint=...`;
- for a value that is not an `Error`, the text `unknown error`.

Result, for example: `DrizzleQueryError code=23505 constraint=accounts_email_unique`.

It never reads `message`, `stack`, `detail`, `query`, `params` or `cause.message`. The
route wrapper logs `Request <id> failed: <describeError(error)>`; the health check logs
`Health check failed: database unreachable (<describeError(error)>)`. The request id is
what lets an operator correlate the line with the client's `X-Request-Id`.

### Documentation

Canonical doc 0004, section 4, gets one more rule: unexpected errors are logged with the
request id, the class name and, when present, the database error code and constraint name,
and never with the message, query, parameters or stack. A new error type needs no change:
anything not on the allow-list is simply left out.

## Files

| Path                                             | Change                                            |
| ------------------------------------------------ | ------------------------------------------------- |
| `src/server/http/safe-error.ts`                  | create                                            |
| `src/server/http/safe-error.test.ts`             | create (unit, written first)                      |
| `src/server/http/safe-error.integration.test.ts` | create (real database, written first)             |
| `src/server/http/route.ts`                       | modify: log `describeError(error)`                |
| `src/server/http/route.test.ts`                  | modify (existing log test updated, written first) |
| `src/server/services/health.ts`                  | modify: log `describeError(error)`                |
| `src/server/services/health.integration.test.ts` | modify (new case written first)                   |
| `docs/canonical/0004-api-conventions.md`         | modify: the logging rule                          |
| `docs/README.md`, WI-042, WS-042                 | statuses                                          |

No new dependencies.

## Data model changes

None.

## API contract

None. Responses are unchanged.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                                                             | Covers criterion        |
| --- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 1   | unit        | `describeError` of a plain `Error("secret-marker")`: `Error`, no marker                                                                                                                                                          | no message              |
| 2   | unit        | a `DrizzleQueryError` built with a marker in its query and params: class name only, no marker                                                                                                                                    | no query or parameters  |
| 3   | unit        | an error whose `cause` (two levels down) has `code: "23505"` and `constraint: "x_unique"`: both appear; a `code` of `"hello world"` or `"<script>"` and a constraint with spaces are dropped                                     | allow-list              |
| 4   | unit        | a class name with spaces, a newline or over 64 characters becomes `Error`; a cyclic `cause` chain terminates; a thrown string, `null` and `undefined` give `unknown error`                                                       | allow-list, robustness  |
| 5   | integration | a **real** failure: insert into `accounts` twice with the same email whose local part is a marker; capture what `describeError` returns: it holds `code=23505` and the constraint name, and not the marker, the email or the SQL | real ORM error          |
| 6   | integration | a **real** failure of a query that holds a password-hash-shaped marker as a parameter (insert into `credentials` with a missing account): the captured text does not contain the marker                                          | hash not logged         |
| 7   | unit        | route wrapper: a handler that throws the error of test 2 logs one line with `Request <id> failed:` and the class name; the line has no marker; the response is the unchanged `500` problem with the same request id              | log line, response same |
| 8   | unit        | route wrapper: the existing tests for expected `ApiError`s (not logged) and request ids still pass                                                                                                                               | no regression           |
| 9   | integration | health check with an unreachable database: logs `database unreachable (...)` with the error code and no host name, user or message text; the response body is unchanged                                                          | health                  |
| 10  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`                                                                                                                                                                          | gate                    |

Tests 5 and 6 use the real database and the real driver error. A hand-built error with
innocent text would not show what the ORM really puts in the message, which is the point of
the audit's finding.

## Risks and open questions

1. **Less detail in the log.** The message and stack are gone from the log. The error code,
   constraint and request id locate most database failures. **Owner: acceptable, or do you
   want an opt-in debug mode, for development only, that logs the full error?** The
   recommendation is no: that is how a secret reaches a production log.
2. **Other writers to the log.** This spec covers the two places in `src` that log errors
   (`route.ts` and `health.ts`). Better Auth and Next.js write their own logs; whether they
   can include request data was not examined. Recorded as a follow-up for the production
   work-track (log access and retention).

## Deviations from the approved spec

- The driver is `postgres-js`, not node-postgres, so the constraint is read from its
  `constraint_name` property. The spec text was corrected before any code.
- `DrizzleQueryError` does not set `name`, so `error.name` is just `Error`. The class name
  is therefore taken from the constructor when `name` is the generic `Error`, still only if
  it matches the allow-list pattern.

## Implementation record

- Red: `safe-error.test.ts` and `safe-error.integration.test.ts` failed on the missing
  module; the route and health tests failed on log lines that still held the message (the
  health line contained `Failed query: select 1`, which confirmed the audit's finding on
  `drizzle-orm@0.45.4`).
- Green: 701 Vitest tests and 28 Playwright tests pass. Typecheck, lint and format pass.
- One assertion of mine wrongly required that the constraint name `accounts_email_unique`
  not contain `accounts`; it was removed. The SQL itself is still asserted absent.
- Locally the database was PostgreSQL 16 started in the sandbox (no Docker); CI runs the
  PostgreSQL 18 of `compose.yaml`.
- Better Auth's and Next.js's own logs were not examined (open question 2); recorded below.
