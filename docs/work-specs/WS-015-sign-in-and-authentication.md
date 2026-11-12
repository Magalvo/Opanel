# WS-015 — Sign-in, sign-out, `GET /api/v1/me`, request authentication, sign-in limiter

- Status: Done (approved by the owner on 2026-11-12, all open questions accepted as proposed)
- Work-item: [WI-015](../work-items/WI-015-sign-in-and-authentication.md)
- Canonical docs: [0001](../canonical/0001-ai-qa-agents-and-triage.md) section 4;
  [0004](../canonical/0004-api-conventions.md) sections 3, 4, 7;
  [WT-02](../work-tracks/WT-02-accounts-and-permissions.md) decisions 1, 7, 8, 10;
  `AGENTS.md` hard rules 4, 6, 7, 8, 9, 13

## Approach

Better Auth stays server-side only (WT-02 decision 1): the routes below call its server
API (`auth.api.signInEmail`, `getSession`, `signOut`) and shape the response themselves.
Its own rate limiter and origin checks live in its HTTP handler, which is not mounted, so
Opanel implements both.

### 1. Request authentication (`src/server/auth/authenticate.ts`)

`authenticate(request): Promise<{ actor: Actor; account: ...; responseHeaders: Headers }>`:

1. If the request has an `Authorization` header: throw `unauthenticated()`. (Agent tokens
   arrive in WT-05; a header means "token only", doc 0004 section 7, so cookies are not
   tried as a fallback.)
2. Otherwise read the session through `getAuth().api.getSession({ headers, returnHeaders:
true })`. No session: `unauthenticated()`.
3. Load the account (`services/accounts.ts`). Missing or `disabled_at` set:
   `unauthenticated()`. Build the actor with `humanActor`. A role that is not a human
   role throws (never defaults), which the route wrapper turns into `500`.
4. `responseHeaders` carries any `Set-Cookie` Better Auth produced (it extends a session
   that is being used) and is merged into the response by the route.

`401` never says why. A route calls `authenticate`, then `requirePermission` when it needs
one (WS-012). `me` and `sign-out` need only authentication: they act on the caller's own
session, which is the explicit exception to "an explicit permission check" for hard rule 6
(question 3).

### 2. Cross-site protection (`src/server/auth/origin.ts`)

`assertSameOrigin(request, appUrl)`: for methods other than `GET`/`HEAD`, on a request with
no `Authorization` header, the `Origin` header must equal the origin of `APP_URL`;
otherwise `forbidden()`. A missing `Origin` is rejected too (browsers always send it on
such requests). It applies to sign-in as well, which blocks login CSRF. It runs first in
each POST route, before the body is read.

### 3. Sign-in limiter (`src/server/services/rate-limit.ts`)

- Table `rate_limits(key text primary key, count integer not null, window_started_at
timestamptz not null)`, index on `window_started_at`. Migration `0004_rate_limits`.
- `consumeRateLimit(db, key, { max, windowSeconds })` is one SQL statement
  (`insert ... on conflict (key) do update`) that resets the window when it has elapsed,
  otherwise increments, and returns `{ allowed, retryAfterSeconds }`. One statement means
  concurrent requests cannot all slip through a stale read. Old rows (older than one day)
  are deleted opportunistically, on about one call in fifty.
- Keys: `signin:email:<sha-256 of the lower-cased email>` (the raw email is never stored)
  and, when a client address is available, `signin:ip:<address>`.
- Limits: 10 attempts per email and 50 per address, per 15 minutes. Every attempt counts,
  successful or not; a signed-in person is not locked out by this because the check
  happens before the password is verified and the counter resets with the window.
- **Client address.** A request header is only trustworthy if Opanel's own reverse proxy
  sets it, so the header's name is configuration: optional environment variable
  `CLIENT_IP_HEADER` (for example `x-forwarded-for` or `cf-connecting-ip`). When it is not
  set, the per-address limit is not applied and the per-email limit alone protects
  accounts (question 1).
- Exceeding either limit: `rateLimited(retryAfterSeconds)` (`429`, `Retry-After`), with
  the audit entry `auth.sign_in_failed`, reason `rate_limited`.

### 4. Services (`src/server/services/`)

- `accounts.ts`: `findAccountByEmail`, `findAccountById` (the only code that reads
  `accounts` for authentication), and `touchLastSeen`.
- `sign-in.ts`: `signIn(db, { email, password, clientIp })` and `signOut(...)`.
  `signIn`: consume both counters; look up the account; if it is missing or deactivated,
  run `verifyPassword` against a fixed dummy hash (so the time taken does not tell the two
  apart from a wrong password), audit `auth.sign_in_failed` with `reason`
  `bad_credentials` or `disabled` (actor `null`, `entityId` set to the account id only when
  one matched, the email never stored) and throw `unauthenticated("Invalid email or
password.")`; otherwise call `getAuth().api.signInEmail`; a failure there is the same
  `401`. On success, in one transaction: set `last_seen_at` and audit `auth.sign_in` with
  the account as actor. Returns the account summary and the `Set-Cookie` headers.
  `signOut`: delete the session through `getAuth().api.signOut` and audit `auth.sign_out`
  with the actor.
  The audit row is written after Better Auth created the session; if writing it failed the
  caller gets `500` and does not receive the cookie, leaving an unused session row that
  expires on its own. Better Auth's session write cannot join Opanel's transaction.

### 5. Routes and contracts

| Operation                    | Public | Request body                                    | Success                                                | Errors                            |
| ---------------------------- | ------ | ----------------------------------------------- | ------------------------------------------------------ | --------------------------------- |
| `POST /api/v1/auth/sign-in`  | yes    | `{ email, password }` strict; password 1 to 128 | `200` `{ id, kind, name, email, role }` + `Set-Cookie` | `400`, `401`, `403`, `415`, `429` |
| `POST /api/v1/auth/sign-out` | no     | none                                            | `204`, cookie cleared                                  | `401`, `403`                      |
| `GET /api/v1/me`             | no     | none                                            | `200` `{ id, kind, name, email, role, permissions[] }` | `401`                             |

Sign-in is declared **public** by this spec (it cannot require credentials) and exposes no
internal detail: its failures are identical. The password limit of 128 matches
`PASSWORD_MAX_LENGTH`; sign-in does not apply the 12 character minimum, so a rule change
never locks out an existing account. Schemas live in `src/lib/schemas/auth.ts`, contracts
in `src/lib/openapi/contracts.ts`, and `pnpm openapi:generate` rewrites
`docs/api/openapi.json`.

### 6. Cookie

Better Auth's cookie options are set explicitly: prefix `opanel`, `HttpOnly`,
`SameSite=Lax`, `Path=/`, `Secure` when `APP_URL` is `https`, lifetime of the session
(7 days, extended while in use, WT-02 decision 8).

## Files

| Path                                                                                 | Change                                          |
| ------------------------------------------------------------------------------------ | ----------------------------------------------- |
| `src/server/auth/authenticate.ts`, `origin.ts` (+ unit and integration tests)        | create (tests first)                            |
| `src/server/services/{accounts,sign-in,rate-limit}.ts` (+ integration tests)         | create (tests first)                            |
| `src/server/db/schema/rate-limits.ts`, `index.ts`; migration `0004_*`                | create / modify / generated                     |
| `src/app/api/v1/auth/sign-in/route.ts`, `sign-out/route.ts`, `me/route.ts` (+ tests) | create (tests first)                            |
| `src/lib/schemas/auth.ts`, `src/lib/openapi/contracts.ts`                            | modify                                          |
| `src/server/auth/auth.ts`                                                            | modify: cookie options                          |
| `src/server/env.ts`, `env.test.ts`, `.env.example`, README                           | modify: optional `CLIENT_IP_HEADER`             |
| `tests/e2e/auth.spec.ts`, `tests/e2e/seed.ts`                                        | create                                          |
| `docs/api/openapi.json`                                                              | regenerate                                      |
| `docs/canonical/0001`, `0004`                                                        | modify only if behaviour differs (none planned) |
| `docs/README.md`, WT-02, WI-015, WS-015                                              | statuses                                        |

No new dependencies.

## Data model changes

`rate_limits` as above, migration `0004_rate_limits`.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                         | Criterion       |
| --- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 1   | unit        | `assertSameOrigin`: same origin passes; other origin, `null`, missing `Origin` and a look-alike (`https://app.example.evil`) fail; `GET`/`HEAD` and requests with `Authorization` are exempt | cross-site      |
| 2   | unit        | env: `CLIENT_IP_HEADER` optional; a value that is not a header name is rejected                                                                                                              | limiter         |
| 3   | unit        | sign-in body schema: strict, email required, password 1 to 128, unknown field rejected                                                                                                       | sign-in         |
| 4   | integration | `consumeRateLimit`: allows `max`, then refuses with a `retryAfterSeconds` within the window; a new window starts after it elapses                                                            | limiter         |
| 5   | integration | 30 concurrent calls with `max` 10 allow exactly 10                                                                                                                                           | atomic          |
| 6   | integration | keys are independent; the raw email is not in any stored key                                                                                                                                 | limiter         |
| 7   | integration | sign-in service: success returns the summary and cookie headers, sets `last_seen_at`, writes `auth.sign_in` with the account as actor, in one transaction                                    | sign-in, audit  |
| 8   | integration | wrong password, unknown email and deactivated account produce the same error; each writes `auth.sign_in_failed` with actor `null`, a reason, and no email                                    | no enumeration  |
| 9   | integration | the 11th attempt for one email is `429` with `Retry-After` and is audited; another email is unaffected                                                                                       | limiter         |
| 10  | integration | `authenticate`: valid cookie gives the actor; expired session, deleted session, deactivated account, bad cookie and any `Authorization` header give `401`                                    | authenticate    |
| 11  | integration | route `POST /auth/sign-in`: `200` body shape; `Set-Cookie` has `HttpOnly`, `SameSite=Lax`, `Path=/`; no `Secure` over `http`, `Secure` over `https` (separate app URL)                       | sign-in, cookie |
| 12  | integration | route `sign-in`: `403` for a foreign `Origin` before the body is read; `415`, `400` unknown field                                                                                            | cross-site      |
| 13  | integration | route `GET /me`: `200` with role and permissions of that role; `401` without cookie                                                                                                          | me              |
| 14  | integration | route `sign-out`: `204`, session row deleted, cookie cleared, `auth.sign_out` audited; the old cookie then gets `401` on `/me`; `403` for a foreign `Origin`                                 | sign-out        |
| 15  | integration | no response body, log line or audit `data` contains the password, its hash or the session token (marker values checked across all of them)                                                   | secrets         |
| 16  | unit        | OpenAPI: the three operations exist, sign-in is public, the others document `401` and `403`; the contracts-versus-routes test passes                                                         | OpenAPI         |
| 17  | e2e         | against the production build: seed an account, sign in, `me` is `200`, sign out, `me` is `401`; a request with a foreign `Origin` gets `403`                                                 | end to end      |
| 18  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm db:generate` reports nothing to generate; `pnpm openapi:generate` leaves no diff                                              | gate            |

## Risks and open questions

For the owner:

1. **Client address for the per-address limit.** Reading `X-Forwarded-For` blindly lets any
   client choose its own address and so defeat the limit. I propose the optional
   `CLIENT_IP_HEADER` variable above: operators set it to what their proxy sets, and
   without it only the per-email limit applies. Alternative: always trust the first
   `X-Forwarded-For` value, which is simpler and weaker. Accept the proposal?
2. **Limits.** 10 attempts per email and 50 per address, per 15 minutes, counting every
   attempt. The cost of a low email limit is that someone can lock a colleague out for
   15 minutes by guessing wrongly on purpose; the cost of a high one is slower protection.
   Acceptable, or other numbers?
3. **Authentication-only endpoints.** `me` and `sign-out` need a valid session but no
   permission from the catalogue, since they act on the caller's own session. This is a
   declared exception to the "explicit permission check" of rule 6. Agree?
4. **Origin check on sign-in.** I apply it to sign-in too (against login CSRF), which
   means a human using `curl` must send `Origin: <APP_URL>`. Agents use tokens and are
   exempt. Agree?

Technical, settled by the tests rather than assumed:

5. **Timing.** The dummy password verification makes the unknown-email path cost about as
   much as a wrong password. I verify that Better Auth's own path does the same for an
   unknown user by reading the installed source (hard rule 13); no timing test is written,
   because it would be flaky in CI.
6. **Better Auth's session extension.** `getSession` may refresh the cookie; the route
   forwards any `Set-Cookie` it returns. Test 10 and test 13 cover the sessions I can
   produce; if the installed version behaves differently from its types, I stop and
   report.
7. **Playwright and the seed.** The end-to-end test creates its account directly in the
   end-to-end database with `hashPassword`, because there is no setup flow until WI-016.
   If Playwright cannot import the server modules cleanly, the seed becomes a small
   script run by `prepare.ts`.

## Deviations from the approved spec

1. **A third response kind in contracts.** `204` has no body, which the OpenAPI contract
   types could not express. `ResponseContract` gains `{ description, noContent: true }`,
   with a test written first. The old OpenAPI test schema was relaxed to allow responses
   without `content` and `application/problem+json` content, which no earlier contract had.
2. **`src/server/http/client-ip.ts`** (not in the file list): reads `CLIENT_IP_HEADER`,
   takes the **last** entry of a list (the one the trusted proxy appended, the first being
   client-controlled), and accepts only IP addresses.
3. **Services default to `getDb()`** (`signIn(input, db = getDb())`), so route files import
   no database client, as `AGENTS.md` section 3 asks.
4. **`json()` and `noContent()` take an optional `cookies` headers argument** and copy only
   its `Set-Cookie` entries, which is how the routes forward Better Auth's cookies.
5. **Question 5 (timing) resolved by reading the installed source:** Better Auth's
   `signInEmail` already hashes the password for an unknown user. Ours does the same for
   unknown and deactivated accounts before it gets there.
6. **Question 7 (Playwright seed):** `tests/e2e/seed.ts` uses its own connection to the
   end-to-end database, because the test process has no application environment. The
   end-to-end tests use a unique email per run, since that database is not emptied and the
   limiter counts per email.
7. **Test 11 (Secure cookie)** builds two Better Auth instances with `createAuth(env)`
   (now exported) for an `https` and an `http` app URL, in `auth.integration.test.ts`.
8. **Test helpers** for creating accounts, signing in and building requests are in
   `src/server/auth/testing.ts`.

## Implementation record

- Red: unit, integration and end-to-end tests failed on missing modules and behaviour
  (committed before any code); a separate Red test preceded the `noContent` contract.
- Green: 250 Vitest tests (up from 200) and 14 Playwright tests (up from 12) pass.
  `pnpm db:generate` and `pnpm openapi:generate` leave no diff.
- Locally the database was PostgreSQL 16 (no Docker in the sandbox); CI runs the
  PostgreSQL 18 of `compose.yaml`.
