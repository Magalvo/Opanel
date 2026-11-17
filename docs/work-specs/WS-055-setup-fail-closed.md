# WS-055 — Production setup requires a setup token

- Status: Done (approved by the owner on 2026-11-17, questions 1 to 5 as proposed)
- Work-item: [WI-055](../work-items/WI-055-setup-fail-closed.md)
- Canonical docs: [0004](../canonical/0004-api-conventions.md) section 4 (error codes);
  [WT-04](../work-tracks/WT-04-realtime-board-sync.md) decision 13 (amended by this spec);
  [WS-050](WS-050-setup-token.md) (the token); [WS-043](WS-043-setup-refuses-before-hashing.md)
  (refuse before hashing); [WS-016](WS-016-first-run-setup.md) (first-run setup);
  audit of 2026-11-17, finding A02; `AGENTS.md` hard rules 4, 6, 7 and 9

## Approach

### 1. Where things stand

- `SETUP_TOKEN` is optional in `src/server/env.ts` (32 to 256 characters when set).
- `createFirstAdmin()` (`src/server/services/setup.ts`) checks, in order: install already
  has accounts → `404`; a token is configured and the body's does not match → `403
invalid_setup_token`; then hashes and creates the Admin under the advisory lock.
- `isSetupTokenRequired(env)` tells `src/app/setup/page.tsx` whether `SetupForm` shows the
  "Setup token" field.
- WT-04 decision 13 and WS-050 say "when unset or empty, nothing changes". WS-050 question
  2 rejected a start-up warning, because the token stops mattering once an Admin exists.
- The end-to-end suite runs `next start`, so it runs with `NODE_ENV=production`, and sets no
  token.

### 2. Fail closed at request time, not at start-up

Making `SETUP_TOKEN` required in production at start-up would stop every installed server
that dropped the token after setup (which `.env.example` allows), and keep a secret alive
that has no use. So the check is where the danger is: **the setup request on an empty
install.**

One function in the service replaces `isSetupTokenRequired`:

```ts
export type SetupGuard = "open" | "token" | "locked";

/** How the first-run setup is protected (WS-055). Never exposes the token. */
export function setupGuard(env: Pick<Env, "NODE_ENV" | "SETUP_TOKEN"> = getEnv()): SetupGuard;
```

- `"token"` when `SETUP_TOKEN` is set, in any mode (WS-050, unchanged);
- `"locked"` when it is not set and `NODE_ENV` is `production`;
- `"open"` when it is not set in `development` or `test` (today's behaviour).

`createFirstAdmin()` keeps its order and gains one step:

1. Install already has accounts → `404` (unchanged, so an installed server never reveals
   anything about tokens).
2. Guard `"locked"` → `setupTokenNotConfigured()`: nothing hashed, nothing written, not
   audited (the caller is anonymous, as for a wrong token in WS-050 question 3).
3. Guard `"token"` and no match → `invalidSetupToken()` (unchanged).
4. Hash, lock, check again, create (unchanged).

The service's `options` take the guard's inputs (`expectedSetupToken` today, plus
`nodeEnv`), so the integration tests set each mode without touching `process.env`.

### 3. The error

New helper in `src/server/http/errors.ts`:

```ts
export function setupTokenNotConfigured(): ApiError;
// 403, title "Forbidden", code "setup_token_not_configured",
// detail "First-run setup needs SETUP_TOKEN in the server's configuration."
```

`setup_token_not_configured` joins `PROBLEM_CODES` and the rule on specific codes of doc
0004 section 4. It is `403`, like `invalid_setup_token`: the request is understood and
refused. It reveals only what the setup page shows anyway: that this empty install needs a
token in its configuration. It never contains a value.

### 4. The page

`src/app/setup/page.tsx` (still `404` once an account exists):

- `"open"` and `"token"`: as today; `tokenRequired` is `guard === "token"`.
- `"locked"`: no form. Heading "Set up Opanel", and: "This server needs a setup token
  before anyone can create the first administrator. Set `SETUP_TOKEN` in its
  configuration (see `.env.example`), restart it, and reload this page." No input, so
  nothing can be submitted.

`SetupForm` does not change.

### 5. The end-to-end suite

- `tests/e2e/environment.ts` gains `E2E_SETUP_TOKEN`, a fixed placeholder like
  `E2E_AUTH_SECRET` (not a secret: the database is a throwaway), 32 characters or more.
- `playwright.config.ts` passes `SETUP_TOKEN: E2E_SETUP_TOKEN` to the web server.
- `tests/e2e/setup.spec.ts` fills "Setup token" before the other fields. Its later checks
  are unchanged (`/setup` is `404` after setup; a second API setup is `404`, with no token
  sent, which also proves step 1 runs before the token check).

This also gives the token path its first end-to-end coverage, which WS-050 question 4 left
out only because it needed a second server configuration.

### 6. Operator documentation

- `.env.example`: `SETUP_TOKEN` is required to set up a production install; still removable
  once the first Admin exists.
- `README.md` ("Getting started"): local development needs no token; a production server
  refuses setup until `SETUP_TOKEN` is set.
- WT-04 decision 13 and WS-050 get one line each pointing here ("amended by WS-055"),
  as WS-043 did for WS-016. Their text stays as the record of what was decided then.

### Considered and not chosen

- **Required at start-up in production**: see section 2.
- **A start-up warning** instead of refusing: the audit asks to fail closed, and a warning
  in a log is the same "operator must notice" problem.
- **A local provisioning command** (`pnpm opanel create-admin` on the server): removes the
  public setup entirely, but needs a CLI entry point, its own audit semantics and
  deployment docs that do not exist yet (A12, no deployment track). The token already
  exists and is tested. Question 3.
- **An explicit opt-out** (`ALLOW_UNPROTECTED_SETUP=true`) for production: an easy way back
  to the unsafe default, for a case nobody needs (generating a token is one command).
  Question 2.

## Files

| Path                                                                                     | Change                                              |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `src/server/services/setup.ts` (+ `setup.integration.test.ts`)                           | modify: `setupGuard`, the locked step (tests first) |
| `src/server/http/errors.ts` (+ `errors.test.ts`)                                         | modify: `setupTokenNotConfigured()`                 |
| `src/lib/schemas/problem.ts` (+ `problem.test.ts`)                                       | modify: `setup_token_not_configured`                |
| `src/lib/schemas/auth.ts` (+ `auth.test.ts`)                                             | modify: the `403` description of `setupContract`    |
| `src/app/api/v1/setup/route.integration.test.ts`                                         | modify: the locked case through the route           |
| `src/app/setup/page.tsx` (+ `page.integration.test.ts`)                                  | modify: the locked explanation (tests first)        |
| `tests/e2e/environment.ts`, `playwright.config.ts`, `tests/e2e/setup.spec.ts`            | modify: the token in the end-to-end server and test |
| `docs/api/openapi.json`                                                                  | regenerated                                         |
| `.env.example`, `README.md`                                                              | modify: operator instructions                       |
| `docs/canonical/0004-api-conventions.md`                                                 | modify: the new code                                |
| `docs/work-tracks/WT-04-realtime-board-sync.md`, `docs/work-specs/WS-050-setup-token.md` | modify: one pointer line each                       |
| `docs/README.md`, WI-055, WS-055                                                         | modify: statuses                                    |

No new dependency, no migration, no change to `src/server/env.ts`.

## Data model changes

None.

## API contract

`POST /api/v1/setup`, public as before. One new `403` code, `setup_token_not_configured`:
the server runs in production with no `SETUP_TOKEN` and the install has no account yet.
Additive: every other answer is unchanged (`201`, `400`, `403 forbidden`, `403
invalid_setup_token`, `404`, `413`, `415`). The request body does not change.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                 | Covers criterion |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| 1   | unit        | `setupGuard`: token set → `"token"` in production, development and test; unset → `"locked"` in production, `"open"` in development and test                                          | guard            |
| 2   | unit        | `PROBLEM_CODES` holds `setup_token_not_configured`; `setupTokenNotConfigured()` is a `403` problem with that code; the `403` of `setupContract` mentions it                          | code, contract   |
| 3   | integration | service, production, no token, empty install: `403 setup_token_not_configured`, `hashPassword` not called (spy, as WI-043), no account, credential or audit entry                    | locked           |
| 4   | integration | service, production, no token, an account exists: `404`, not `403`                                                                                                                   | order            |
| 5   | integration | service, production, token configured: right token creates the Admin; wrong one is `403 invalid_setup_token` (existing WS-050 tests kept, now also run with `nodeEnv: "production"`) | token unchanged  |
| 6   | integration | service, development and test, no token: setup works as today (existing tests kept)                                                                                                  | open unchanged   |
| 7   | integration | route: the locked case answers the problem body with the request id, and nothing is logged                                                                                           | through route    |
| 8   | integration | page: locked → the explanation naming `SETUP_TOKEN` and no form; token → the form with the token field; open → the form without it; an account exists → `notFound()` in all three    | page             |
| 9   | unit        | `parseEnv` with `NODE_ENV=production` and no `SETUP_TOKEN` still succeeds (existing env tests kept)                                                                                  | still starts     |
| 10  | e2e         | `setup.spec.ts` with the token: fills the field, ends signed in as Admin; `/setup` and a second `POST /api/v1/setup` are then `404`                                                  | e2e              |
| 11  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm openapi:generate` changes only the setup operation's `403` text; `pnpm db:generate` leaves no diff                    | gate             |

## Risks and open questions

For the owner:

1. **This reverses part of an approved decision.** WT-04 decision 13 and WS-050 say an
   unset token changes nothing. In production, it now locks setup. **Recommend: approve the
   amendment; development and test keep the old behaviour, and installed servers are not
   affected.**
2. **No opt-out in production.** An operator who wants the old behaviour must set a token
   anyway. **Recommend: no opt-out.**
3. **A token rather than a provisioning command.** The command is the stronger design (no
   public setup at all) and fits the deployment track (A12), together with the
   last-Admin recovery command already in the follow-ups. **Recommend: this item now;
   record "first Admin through a server command" as a candidate for the deployment track.**
4. **`NODE_ENV` decides.** `next start` sets `production`; `next dev` sets `development`. A
   server deliberately run with another `NODE_ENV` in public is out of scope. **Recommend:
   as proposed.**
5. **The `403` says why.** `setup_token_not_configured` tells an anonymous caller that this
   empty install needs a token; the page says the same, and the caller still cannot set
   it. **Recommend: as proposed.**

## Deviations from the approved spec

1. **`pnpm openapi:generate` changed one more line than test 11 said:** besides the setup
   operation's `403` text, `setup_token_not_configured` joined the code list of the shared
   `Problem` schema. That list is generated from `PROBLEM_CODES`, so every new code does
   this (as `invalid_setup_token` did in WS-050).
2. **`setupGuard` is tested in the service's integration test file**, not a separate unit
   file (test 1): it lives in `src/server/services/setup.ts`, whose tests are all there. It
   takes its inputs as arguments, so the tests need no database.

## Implementation record

- Red (run before any code changed): 12 tests failed for the right reason.
  `setupTokenNotConfigured` and `setupGuard` did not exist; `PROBLEM_CODES` and the setup
  contract lacked the new code; the service created the Admin in production without a token
  ("promise resolved instead of rejecting"); the page rendered the form.
- Green: `setupGuard` replaces `isSetupTokenRequired`; `createFirstAdmin` takes `nodeEnv`
  as an option next to `expectedSetupToken` and refuses `"locked"` after the `404` check
  and before the token check; the page renders the explanation and no form when locked.
- The end-to-end server gets `E2E_SETUP_TOKEN` and `setup.spec.ts` fills "Setup token".
- `.env.example`, `README.md`, doc 0004, WT-04 decision 13 and WS-050 updated.
- Gate on 2026-11-17: typecheck and lint pass; Prettier passes on every changed file it
  can parse (`.env.example` has no parser, and the repository-wide check does not include
  it); `pnpm db:generate` reports no schema change; Vitest 1121 of 1121; `pnpm test:e2e`
  68 of 68 with `--retries=0`. Run on Windows with Node 24 and pnpm 10.28.0, against the
  Compose PostgreSQL on port 5433.
