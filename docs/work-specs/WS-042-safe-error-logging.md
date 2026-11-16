# WS-042 — Safe error logging

- Status: Approved (approved by the owner on 2026-11-16, questions 1 to 4 as proposed)
- Work-item: [WI-042](../work-items/WI-042-safe-error-logging.md)
- Canonical docs: [0004](../canonical/0004-api-conventions.md) section 4; `AGENTS.md` hard
  rules 7 and 13; [WS-011](WS-011-api-foundations.md) (the route wrapper),
  [WS-005](WS-005-health-endpoint.md) (the health check)

## Approach

### 1. Evidence, on the installed versions

- `src/server/http/route.ts` (the `catch` of the route wrapper) and
  `src/server/services/health.ts` both log `` `${error.name}: ${error.message}` ``.
- In the installed `drizzle-orm@0.45.4` (`node_modules/drizzle-orm/errors.js`),
  `DrizzleQueryError` is built with the message
  `` `Failed query: ${query}\nparams: ${params}` ``. The driver's own error (`postgres`,
  found as the `cause`) carries fields such as `detail`
  (`Key (email)=(x@y.z) already exists`).
- So a failed query can put its parameters in the log: the password hash of an insert into
  `credentials`, an email, a task description. The response is already generic; only the
  log leaks.
- The only other place in `src` that logs an error, `src/instrumentation.ts`, logs the
  message of `EnvValidationError`, which is written by hand and never includes a value
  (WS-003). It stays as it is.

### 2. One function decides what a log line may say

`describeError(error: unknown): string`, in a new `src/server/http/safe-error.ts`. It is
pure, and builds the text only from an allow-list, never from free text:

- **the class name**: `error.name`, or the constructor's name when `name` is the generic
  `Error` (the installed `DrizzleQueryError` does not set `name`), kept only if it matches
  `^[A-Za-z][A-Za-z0-9_]{0,63}$`, otherwise `Error`;
- **a code**: from the error and its `cause` chain (at most 5 levels, cycles ignored), the
  first `code` that matches `^(?:[0-9A-Z]{5}|E[A-Z0-9_]{2,20})$` (a PostgreSQL SQLSTATE such
  as `23505`, or a Node system code such as `ECONNREFUSED`), written as `code=...`;
- **a constraint**: from the same chain, the first `constraint_name` (the name the
  `postgres` driver uses) matching `^[a-z0-9_]{1,63}$`, a schema identifier rather than data,
  written as `constraint=...`;
- for anything that is not an `Error`: `unknown error`.

For example: `DrizzleQueryError code=23505 constraint=accounts_email_unique`.

It never reads `message`, `stack`, `detail`, `query`, `params` or a cause's message. A new
error type needs no change: whatever is not on the allow-list is left out.

### 3. The two log lines

- The route wrapper: `Request <id> failed: <describeError(error)>`. The request id is what
  lets an operator match the line with the `X-Request-Id` the client got.
- The health check: `Health check failed: database unreachable (<describeError(error)>)`.

Responses do not change.

### 4. Documentation

Canonical doc 0004 section 4 gains the rule: unexpected errors are logged with the request
id, the class name and, when present, the database or system error code and the constraint
name, and never with the message, query, parameters, detail or stack.

## Files

| Path                                                     | Change                                        |
| -------------------------------------------------------- | --------------------------------------------- |
| `src/server/http/safe-error.ts`                          | create                                        |
| `src/server/http/safe-error.test.ts`                     | create (unit, tests first)                    |
| `src/server/http/safe-error.integration.test.ts`         | create (real database, tests first)           |
| `src/server/http/route.ts` (+ `route.test.ts`)           | modify: log `describeError` (tests first)     |
| `src/server/services/health.ts` (+ its integration test) | modify: log `describeError` (tests first)     |
| `docs/canonical/0004-api-conventions.md`                 | modify: the logging rule                      |
| `docs/README.md`, WI-042, WS-042                         | modify: statuses, the follow-up of question 2 |

No new dependency, no migration.

## Data model changes

None.

## API contract

None. Responses are unchanged.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                                   | Covers criterion |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| 1   | unit        | `describeError(new Error("marker"))` is `Error`, with no marker                                                                                                                                        | message          |
| 2   | unit        | a `DrizzleQueryError` built with a marker in its query and parameters gives its class name only, with no marker                                                                                        | query, params    |
| 3   | unit        | a cause two levels down with `code: "23505"` and `constraint_name: "x_unique"`: both appear; a code of `"hello world"` or `"<b>"` and a constraint with spaces or capitals are left out                | allow-list       |
| 4   | unit        | a class name with spaces, a newline or over 64 characters becomes `Error`; a cyclic cause chain ends; a thrown string, `null` and `undefined` give `unknown error`                                     | robustness       |
| 5   | integration | a real failure: insert two accounts with the same email whose local part is a marker; the description has `code=23505` and the constraint name, and neither the marker, the email nor the SQL          | real error       |
| 6   | integration | a real failure of an insert into `credentials` whose password hash is a marker (an account that does not exist): the description does not contain the marker                                           | hash             |
| 7   | unit        | route wrapper: a handler that throws the error of test 2 logs one line, `Request <id> failed: DrizzleQueryError`, with no marker; the response is the unchanged `500` problem with the same request id | log line         |
| 8   | unit        | route wrapper: expected `ApiError`s are still not logged, and the existing request id tests pass                                                                                                       | no regression    |
| 9   | integration | health check with a query that fails: logs `database unreachable (...)` with no marker and no SQL; the result is unchanged                                                                             | health           |
| 10  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm db:generate` and `pnpm openapi:generate` leave no diff                                                                                  | gate             |

Tests 5 and 6 use the real database and the real driver error: a hand-built error with
harmless text would not show what the ORM really puts in its message, which is the point of
the audit's finding.

## Risks and open questions

For the owner:

1. **Less detail in the log.** The message and stack leave the log; the class name, error
   code, constraint and request id locate most failures. The alternative, a development-only
   switch that logs the full error, is how a secret ends up in a production log by mistake.
   **Recommend: no such switch.**
2. **Other writers to the log.** This item covers the two places in `src` that log errors.
   Better Auth and Next.js write their own logs, and whether those can include request data
   was not examined. **Recommend: record it as a follow-up for the production deployment
   work, which also decides log access and retention.**
3. **This branch is stacked on WI-044** (`claude/wi-044-request-body-limit-v2`, PR #37),
   because both change `src/server/http/route.ts` and the status lines of `docs/README.md`.
   Its pull request is opened once #37 is merged, so it shows WI-042 alone.
   **Recommend: as proposed.**
4. **The older branch** `claude/wi-042-safe-error-logging` (2026-11-15) implemented a first
   version on code that has since changed. This spec reuses its findings, checked again on
   the installed versions, and replaces it. **Recommend: the branch can be deleted.**
