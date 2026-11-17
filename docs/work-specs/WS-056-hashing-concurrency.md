# WS-056 — Password hashing cannot starve the server

- Status: Done (approved by the owner on 2026-11-17, questions 1 to 4 as proposed)
- Work-item: [WI-056](../work-items/WI-056-hashing-concurrency.md)
- Canonical docs: [0004](../canonical/0004-api-conventions.md) section 4 (status codes and
  error codes); [WS-047](WS-047-events-endpoint.md) (`429 too_many_streams`, the precedent
  for a server-capacity limit); [WS-015](WS-015-sign-in-and-authentication.md) and
  [WS-022](WS-022-sign-in-hardening.md) (sign-in limiter); audit of 2026-11-17, finding A03

## Approach

### 1. Where things stand (checked on 2026-11-17)

- `hashPassword` and `verifyPassword` in `src/server/auth/password.ts` wrap `hash` and
  `verify` of `@node-rs/argon2` 2.2.2, with the OWASP profile (19 MiB, 2 passes, 1 lane).
  Every caller uses them: sign-in (`sign-in.ts`, the dummy verification for an unknown or
  deactivated account), Better Auth's sign-in (`auth.ts` passes them as `password.hash` and
  `password.verify`), first-run setup, accepting a link, and changing one's password.
- The binding runs each operation as napi async work, on libuv's threadpool. With the
  default 4 threads, at most 4 run at once, so memory is already bounded (about 76 MiB),
  but **the queue is not**, and file reads, `dns.lookup` (new database connections by host
  name) and zlib wait in that same queue.
- Measured with the installed binding, default pool: one hash 24 ms; 4 in parallel 50 ms;
  64 queued 987 ms, and a `readFile` started just after them waited 980 ms.
- Sign-in is limited per email (10 per 15 minutes) and, only when `CLIENT_IP_HEADER` is
  set, per address. A caller who varies the email is not limited without it.
- Setup hashes only on an empty install with the right token (WI-043, WI-055); accepting a
  link only for a valid link (WI-040); changing a password needs a session and is limited
  per account. Sign-in is the open path; the gate covers all of them anyway, because it
  sits in the one module they share.

### 2. The gate

A small semaphore in a new module, `src/server/auth/hash-gate.ts`:

```ts
export interface HashGate {
  /** Runs `task` when a place is free; throws `serverBusy()` at once if the queue is full. */
  run<T>(task: () => Promise<T>): Promise<T>;
}

export function createHashGate(options: { maxRunning: number; maxWaiting: number }): HashGate;

/** The process-wide gate: 2 running, 32 waiting. */
export const hashGate: HashGate;
```

- Places are taken in arrival order and released in a `finally`, so a rejected or throwing
  task always frees its place.
- When `maxWaiting` tasks already wait, `run` returns a promise rejected with `serverBusy()` at once, without calling the task. Nothing is hashed.
- No timer and no polling: a waiting task starts when a running one settles.
- Plain TypeScript, no dependency.

`password.ts` wraps both functions:

```ts
export function hashPassword(password: string): Promise<string> {
  return hashGate.run(() => hash(password, OPTIONS));
}
```

`verifyPassword` does the same inside its existing `try`; a `server_busy` error is
re-thrown, not turned into `false` (a busy server must not look like a wrong password).

**Why 2 and 32.** 2 of the 4 pool threads stay free for file reads and DNS. 2 at once gives
about 80 hashes a second on the measured machine, far above any human sign-in rate. 32
waiting is at most about 0.4 s of queue, so a legitimate burst (a team signing in together)
waits instead of being refused. They are constants in `hash-gate.ts`, not environment
variables (question 2).

### 3. The answer

New error helper in `src/server/http/errors.ts`:

```ts
export function serverBusy(): ApiError;
// 429, title "Too Many Requests", code "server_busy",
// detail "The server is busy. Try again in a moment.", Retry-After: 1
```

`server_busy` joins `PROBLEM_CODES` and the rule on specific codes in doc 0004 section 4,
next to `too_many_streams`. It is `429`, not `503`: doc 0004 reserves `503` for the health
endpoint, and WS-047 already answers a server-capacity limit with `429` and its own code
(question 1).

It reaches the client through the routes' existing `ApiError` handling. Better Auth: its
`signInEmail` calls our `verifyPassword`; `signIn()` already re-throws any error that is not
Better Auth's own `APIError`, so the `ApiError` passes through. A test proves this rather
than assuming it (test 6). Nothing is audited for a busy refusal: the server did not
evaluate the attempt.

The sign-in limiter's counters are consumed before the password is checked (WS-015), so a
busy refusal still counts as an attempt for that email. That is unchanged and harmless.

### 4. Contracts and forms

- `429` is added to, or its description extended in, the contracts of
  `POST /api/v1/auth/sign-in`, `POST /api/v1/setup`, `POST /api/v1/account-links/accept` and
  `POST /api/v1/me/password`: "...or the server is busy hashing passwords (code
  `server_busy`). See Retry-After." The OpenAPI document is regenerated.
- `SetupForm` gains the `429` branch the other three forms already have (the wait message
  from `Retry-After`). No other form changes.

### Considered and not chosen

- **A larger threadpool** (`UV_THREADPOOL_SIZE`): more parallel hashes, but still an
  unbounded queue, and more memory. Not a limit.
- **Hashing on a worker thread pool of our own** (`piscina`): isolates the libuv pool, but
  adds a dependency (a canonical stack change) and still needs a queue bound. The gate gives
  the bound without it.
- **A per-install sign-in limiter**: one caller could lock every person out (the audit
  warns against it).
- **A link-acceptance limiter without a client address**: an unknown or used link is
  refused before any hash (WI-040), so it costs a SHA-256 and a query, not Argon2id.

## Files

| Path                                                      | Change                                                |
| --------------------------------------------------------- | ----------------------------------------------------- |
| `src/server/auth/hash-gate.ts` (+ `hash-gate.test.ts`)    | create (unit, tests first)                            |
| `src/server/auth/password.ts` (+ `password.test.ts`)      | modify: both functions through the gate (tests first) |
| `src/server/http/errors.ts` (+ `errors.test.ts`)          | modify: `serverBusy()`                                |
| `src/lib/schemas/problem.ts` (+ `problem.test.ts`)        | modify: `server_busy`                                 |
| `src/lib/schemas/auth.ts` (+ `auth.test.ts`)              | modify: the `429` of four contracts                   |
| `src/app/api/v1/auth/sign-in/route.integration.test.ts`   | modify: busy → `429 server_busy` with `Retry-After`   |
| `src/components/setup-form.tsx` (+ `setup-form.test.tsx`) | modify: the `429` message (tests first)               |
| `docs/api/openapi.json`                                   | regenerated                                           |
| `docs/canonical/0004-api-conventions.md`                  | modify: the new code                                  |
| `docs/README.md`, WI-056, WS-056                          | modify: statuses                                      |

No new dependency, no migration, no environment variable.

## Data model changes

None.

## API contract

A new `429` code, `server_busy`, with `Retry-After: 1`, on the four operations that hash or
verify a password. For sign-in, accepting a link and changing a password, `429` is already
documented (limiter); its description gains the new case. For setup it is new. Additive
only.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                                                                                                 | Covers criterion |
| --- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit        | gate (with controllable promises): never more than `maxRunning` tasks started at once; waiting tasks start in arrival order as running ones settle                                                                                                                   | 2 running, order |
| 2   | unit        | gate: with `maxWaiting` tasks waiting, the next `run` rejects with `429 server_busy` and its task is never called; once one settles, a new `run` is accepted                                                                                                         | 32 waiting       |
| 3   | unit        | gate: a task that rejects, and one that throws synchronously, both free their place (the next waiting task starts)                                                                                                                                                   | release          |
| 4   | unit        | `password.ts`: `hashPassword` and `verifyPassword` still hash and verify for real; with the process gate's queue full (a test-only gate injected through a module mock), both reject with `server_busy`, and `verifyPassword` does not return `false`                | wiring           |
| 5   | unit        | `PROBLEM_CODES` holds `server_busy`; `serverBusy()` is a `429` with that code and `retryAfterSeconds` 1; the four contracts' `429` descriptions mention it                                                                                                           | code, contract   |
| 6   | integration | route `POST /api/v1/auth/sign-in` for an **existing** account (so Better Auth's verify runs) and for an unknown email (the dummy verify), with the gate full: `429`, code `server_busy`, `Retry-After: 1`, the request id; no `auth.sign_in` audit entry, no session | through routes   |
| 7   | unit        | `SetupForm`: a `429` with `Retry-After: 1` shows the wait message and keeps the values                                                                                                                                                                               | form             |
| 8   | measure     | the 2026-11-17 script, rerun through `hashPassword`: 64 hashes, then a `readFile`; record its wait with and without the gate in the implementation record                                                                                                            | measured         |
| 9   | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm openapi:generate` changes only the four `429`s and the `Problem` code list; `pnpm db:generate` leaves no diff                                                                                         | gate             |

## Risks and open questions

For the owner:

1. **`429 server_busy`, not `503`.** `503` would need doc 0004's status table changed (it
   reserves `503` for health); `429` follows WS-047, and every form already handles `429`
   with `Retry-After`. **Recommend: `429`.**
2. **Constants, not configuration.** 2 running and 32 waiting suit the default threadpool
   and a small team. Making them environment variables belongs with the deployment track,
   once real hardware is known. **Recommend: constants now.**
3. **Per process.** Several server processes each have their own gate; that matches the
   per-process threadpool it protects. **Recommend: as proposed.**
4. **A legitimate burst** of more than 34 hashes within about half a second gets `429` and
   retries after a second. **Recommend: accept; it is far beyond a small team's sign-in
   rate.**

## Deviations from the approved spec

1. **The setup form's message for a `429` is "The server is busy. Try again in a moment."**,
   not the minutes-based "Too many attempts" message of the other forms (section 4): setup
   has no limiter, so its only `429` is `server_busy`, and `Retry-After: 1` would read as
   "try again in 1 minute". The other forms are unchanged, as specified.

## Implementation record

- Red (run before any code changed): 9 tests failed for the right reason, and two files
  could not load (`hash-gate.ts` and `serverBusy` did not exist). The sign-in route
  answered `200` while the gate was full; `hashPassword` resolved; the four contracts did
  not mention `server_busy`; the setup form showed no message.
- Green: `src/server/auth/hash-gate.ts` (2 running, 32 waiting, places passed straight from
  a finishing task to the next waiting one, released in a `finally`); `hashPassword` and
  `verifyPassword` run through it, `verifyPassword`'s `false` for a bad hash now inside the
  gated task, so `server_busy` is not swallowed. Better Auth's `signInEmail` lets the
  `ApiError` through unchanged (test 6, existing account).
- One test of mine was wrong at first: it resolved a waiting task before it had started, so
  the test hung. Fixed by settling each task only after it starts; the gate was not changed.
- Test 8, three runs each of 64 hashes then a `readFile`, default threadpool:

  | Path                         | File-read wait | Refused |
  | ---------------------------- | -------------- | ------- |
  | raw Argon2id, no gate        | 872 to 1130 ms | 0       |
  | `hashPassword`, through gate | 2 to 4 ms      | 30      |

  30 refused is exactly 64 − 2 running − 32 waiting.

- `pnpm openapi:generate`: the four `429` descriptions (the setup one new) and
  `server_busy` in the `Problem` code list, nothing else. `pnpm db:generate`: no change.
- Gate on 2026-11-17: typecheck, lint and Prettier on the changed files pass; Vitest 1134 of
  1134; `pnpm test:e2e` 68 of 68 with `--retries=0`. Windows, Node 24, pnpm 10.28.0, Compose PostgreSQL on port 5433.
