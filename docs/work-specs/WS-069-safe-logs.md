# WS-069 — No request data in the logs when a query fails

- Status: Done (approved by the owner on 2026-11-19, questions 1 to 6 as proposed)
- Work-item: [WI-069](../work-items/WI-069-safe-logs.md)
- Canonical docs: [0006](../canonical/0006-operations.md) (section 10: logs);
  [WS-042](WS-042-safe-error-logging.md) (`describeError`, question 2);
  [WS-062](WS-062-production-image.md) (the smoke test); AGENTS.md hard rule 7

## Approach

### 1. What was found (2026-11-19, Next.js 16.4.6, Better Auth 1.7.22, Drizzle 0.45.4)

The probe described in WI-069 (example install, `REVOKE ALL ON sessions FROM opanel_app`,
then a page, `GET /api/v1/me` and a sign-in with a session cookie) put the session token
in the log six times, by two writers:

- **Better Auth**: its endpoint wrapper's `onError` (`better-auth/dist/api/index.mjs`) logs
  an `INTERNAL_SERVER_ERROR` as `logger.error(e.status, e)`, and any other error as
  `logger.error(e.name, e)`; when an error's message contains `column`, `relation`,
  `table` or `does not exist`, it logs the message itself. Its default logger writes the
  arguments to the console, so the whole `DrizzleQueryError` is printed, `params:`
  included. A configured `onAPIError.onError` replaces all of that logging (same file).
- **Next.js**: an error thrown while rendering a page is printed by its logger
  (`next/dist/build/output/log.js`), which calls `console.error(prefix, ...args)` with the
  `Error` object; Node prints its message and its `cause` chain. Next.js has no setting to
  print less (installed docs, `instrumentation.md`: `onRequestError` reports errors, it does
  not replace the log).
- **Opanel**: `describeError` named the sign-in's error `sh`: in the production build the
  server bundle is minified, and the fallback to `error.constructor.name` for a
  `DrizzleQueryError` (whose `name` is `"Error"`) reads the minified name.

### 2. Better Auth: one safe line per error

`src/server/auth/auth.ts` gives `betterAuth()`:

```ts
onAPIError: {
  onError: (error) => {
    logError(`Better Auth: ${describeError(error)}`);
  },
},
```

`logError` defaults to `console.error` and is a parameter of `createAuth` for the tests.
Better Auth's response to the request is unchanged (the hook replaces only its logging),
and every Opanel caller already turns a failure into its own problem response.

### 3. The production console: errors as `describeError`

`src/server/safe-console.ts`, two functions:

- `safeConsoleArgs(args: unknown[]): unknown[]`: each argument that is an `Error` becomes
  `describeError(argument)`; every other value is kept as it is. Pure.
- `installSafeConsole(target = console)`: replaces `error`, `warn`, `log`, `info` and
  `debug` on `target` with wrappers that pass `safeConsoleArgs(args)` to the original.
  Installing twice does not wrap twice.

`src/instrumentation.ts` calls `installSafeConsole()` first thing in `register()`, on the
Node.js runtime, **only when `NODE_ENV` is `production`** (open question 2): developers
keep stacks, and the tests keep full failures.

This covers every writer in the server process, including the ones found in section 1 and
any future library that prints an `Error`. Free text is not filtered: a library that copies
a query's message into a string would still leak it. Section 2 covers the one such path
found (Better Auth's `logger.error(e.message)`), and the smoke test (section 5) is the
check that no other path is used by the failures it provokes.

### 4. `describeError`: a stable name for a failed query

In `src/server/http/safe-error.ts`, the class name becomes:

- `DrizzleQueryError` when `error instanceof DrizzleQueryError` (imported from
  `drizzle-orm/errors`);
- otherwise `error.name` when it matches the pattern, else `Error`.

The `constructor.name` fallback goes: it is what minification changes.

### 5. The smoke test

`scripts/smoke-production.sh` gains a check after the `recover-admin` one, where the Admin
exists:

1. sign in as the Admin (a session cookie; its token is the cookie's value before the
   `.`);
2. as the owner: `REVOKE ALL ON sessions FROM opanel_app`;
3. with the cookie: `GET /projects` (a page), `GET /api/v1/me`, and a sign-in;
4. the app's log since step 2 must not contain the token, nor `params:`, nor
   `Failed query`; it must contain `DrizzleQueryError code=42501`;
5. as the owner: `GRANT SELECT, INSERT, UPDATE, DELETE ON sessions TO opanel_app` (the
   rights of migration 0014); `GET /api/v1/me` with the cookie answers `200`.

### Considered and not chosen

- **`onRequestError` in `instrumentation.ts`**: it reports errors to a service, it does not
  stop Next.js from printing them.
- **Catching every error in the pages and layouts**: each page would need it, and Better
  Auth's own logging would remain.
- **Better Auth's `logger: { disabled: true }`**: silences its warnings too (for example a
  missing client address), and section 3 already makes its errors safe; the hook is
  explicit.
- **Making query errors carry no parameters**, by wrapping the database driver: Drizzle
  builds the message itself, after the driver returns; there is no supported hook.
- **Filtering text for `params:`**: a guess at one library's format, easy to bypass and
  hard to test exhaustively.

## Files

| Path                                                     | Change                                          |
| -------------------------------------------------------- | ----------------------------------------------- |
| `src/server/safe-console.ts` (+ test)                    | create: section 3                               |
| `src/instrumentation.ts` (+ test)                        | modify: install it in production                |
| `src/server/auth/auth.ts` (+ test)                       | modify: `onAPIError.onError` (section 2)        |
| `src/server/http/safe-error.ts` (+ tests)                | modify: the class name (section 4)              |
| `scripts/smoke-production.sh`                            | modify: section 5                               |
| `docs/README.md`, WT-12, WI-069, WS-069, WS-042 (1 line) | modify: statuses; the Follow-up's logs question |

## Data model changes

None.

## API contract

None.

## Test plan (written first, in this order)

| #   | Level | Test                                                                                                                          | Covers criterion |
| --- | ----- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | smoke | section 5 added to `smoke-production.sh` before any fix: fails on the token in the log (red, recorded)                        | 5                |
| 2   | unit  | `safeConsoleArgs`: an `Error` whose message holds a marker becomes its `describeError`; strings, numbers and objects are kept | 2                |
| 3   | unit  | `installSafeConsole`: each of the five methods passes safe arguments to the original; a second install does not wrap again    | 2                |
| 4   | unit  | `register()`: installs it when `NODE_ENV` is `production`, not in development or test                                         | 2, 3             |
| 5   | unit  | `createAuth`: `onAPIError.onError` with a `DrizzleQueryError` holding a marker logs one line without the marker               | 1                |
| 6   | unit  | `describeError`: a `DrizzleQueryError` whose constructor is renamed (as minification does) is still `DrizzleQueryError`       | 4                |
| 7   | smoke | after the fixes: `smoke-production.sh` passes, section 5 included; `smoke-proxy.sh` and `rehearse-backup.sh` still pass       | 4, 5             |
| 8   | gate  | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`                                                                       | 6                |

## Risks and open questions

For the owner:

1. **The console wrapper, for the whole server process** (section 3), rather than fixing
   each writer found. It covers writers not yet known; it changes what `next start`
   prints for every error to one line. **Recommend: as proposed.**
2. **Only in production** (section 3). Development servers and tests keep full errors,
   which hold data from the developer's own machine only. **Recommend: as proposed.**
3. **Better Auth's hook as well** (section 2), although the wrapper alone would catch its
   `Error` arguments: its message-only path passes a string, which the wrapper does not
   filter. **Recommend: as proposed.**
4. **The `describeError` name fix in this item** (section 4): the same log lines, and
   without it a failed query is logged as a meaningless minified name.
   **Recommend: as proposed.**
5. **The smoke check takes the runtime role's rights away for a moment** (section 5), in
   the throwaway install of the smoke test only. **Recommend: as proposed.**
6. **The WT-12 outline gains an item:** this one is H, and the operations guide becomes
   WI-070 (item I), which can then state what the logs contain. **Recommend: as
   proposed.**

## Deviations from the approved spec

1. **`installSafeConsole` takes `nodeEnv` and is tested directly** (test 4): `register()`
   only calls it with the validated environment, inside the `try` that already stops the
   server on a bad configuration, so the call needs no module mocks to test. That the
   production build installs it is checked by the smoke test, whose log check fails
   without it.
2. **The Better Auth hook's unit test calls it without its context argument**: the type of
   `auth.options` is the configuration given, whose `onError` takes only the error.

## Implementation record

- Red:
  - the log check of `smoke-production.sh`, built from the code before any fix, failed on
    `the session token is in the app's log`;
  - the unit tests of `safeConsoleArgs` and `installSafeConsole` failed (no module); the
    hook's test failed (`logError` called 0 times); `describeError` named the renamed
    classes `sh`, as the production build had.
- Green:
  - `src/server/safe-console.ts`, installed by `register()` in production;
  - `onAPIError.onError` in `createAuth`, with a `logError` option;
  - `describeError` recognises `DrizzleQueryError` by its class and no longer reads
    constructor names;
  - the three Docker scripts pass: `smoke-production.sh` with the new check (neither the
    token, nor `params:`, nor `Failed query` in the log; `DrizzleQueryError code=42501`
    there; `200` with the rights back), `smoke-proxy.sh`, `rehearse-backup.sh`.
- Gate on 2026-11-19:
  - typecheck, lint and Prettier pass;
  - Vitest 1312 of 1312;
  - `pnpm test:e2e` 79 of 79 with `--retries=0`; an earlier run had one unrelated
    failure in `people.spec.ts` (a row shown twice after "Load more"), recorded as a
    follow-up in `docs/README.md`;
  - Windows, Node 24, pnpm 10.28.0, Docker 29.9.1, Compose PostgreSQL on port 5433.
