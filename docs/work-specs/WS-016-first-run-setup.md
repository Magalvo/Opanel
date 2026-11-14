# WS-016 — First-run setup: create the first Admin (API and page)

- Status: Done (approved by the owner on 2026-11-12, all open questions accepted as proposed)
- Work-item: [WI-016](../work-items/WI-016-first-run-setup.md)
- Canonical docs: [0004](../canonical/0004-api-conventions.md) sections 3, 4, 7;
  [WT-02](../work-tracks/WT-02-accounts-and-permissions.md) decisions 3, 4, 7;
  [WS-015](WS-015-sign-in-and-authentication.md); `AGENTS.md` hard rules 4, 6, 7, 8

## Approach

### 1. Service (`src/server/services/setup.ts`)

- `isSetupNeeded(db = getDb())`: true when the `accounts` table is empty.
- `createFirstAdmin(input, db = getDb())`, `input` being the validated body plus the
  request's `clientIp` and `headers`:
  1. Hash the password (`hashPassword`) **before** opening the transaction: hashing is slow
     and must not hold the lock.
  2. In one transaction: take a transaction-scoped advisory lock
     (`pg_advisory_xact_lock` on a constant key), then check that `accounts` is empty. If
     not, throw `notFound()`. The lock makes concurrent requests queue, so exactly one sees
     an empty table. Insert the account (`kind` human, `role` admin, name trimmed, email
     lower-cased), its `credentials` row (`provider_id` `credential`,
     `provider_account_id` the account id, the hash), and the audit entry
     `setup.first_admin_created` with the **new account as actor** (it exists inside the
     same transaction) and `entity_id` its id.
  3. After the transaction commits, call `signIn` (WS-015) with the same email and password
     to obtain the session cookie. It also writes the `auth.sign_in` audit entry. The
     limiter counters it touches are harmless on a fresh install.
  4. Return `{ account, headers }`.
     If step 3 failed, the Admin exists without a cookie and the caller gets `500`; the
     person can sign in once WI-017 exists. This is the one non-atomic step, because Better
     Auth creates its session outside Opanel's transaction (as in WS-015).

### 2. Route (`src/app/api/v1/setup/route.ts`)

`POST /api/v1/setup`: `assertSameOrigin`, `readJson(request, setupRequestSchema)`,
`createFirstAdmin`, `json(account, 201, headers)`. Wrapped with `route()`.

| Operation            | Public | Body                                | Success                              | Errors                     |
| -------------------- | ------ | ----------------------------------- | ------------------------------------ | -------------------------- |
| `POST /api/v1/setup` | yes    | `{ name, email, password }`, strict | `201` account summary + `Set-Cookie` | `400`, `403`, `404`, `415` |

Declared **public** by this spec: before the first account exists there is nobody to
authenticate. It exposes nothing: on an installed system it is a plain `404`, the same body
as any unknown path, so it does not even reveal that it exists. `setupRequestSchema` (in
`src/lib/schemas/auth.ts`): `name` 1 to 100 characters after trimming, `email` a valid
address, `password` `passwordSchema` (12 to 128, no composition rules). The contract is
added to `src/lib/openapi/contracts.ts` and `pnpm openapi:generate` rewrites
`docs/api/openapi.json`.

### 3. Page (`src/app/setup/page.tsx`, outside the `(app)` group so it has no app shell)

- A server component. It calls `isSetupNeeded()` (a service) and, if an account exists,
  `notFound()`. It renders a centred card with the client component below.
- `SetupForm` (`src/components/setup-form.tsx`, client): name, email, password and
  confirmation, built from the existing `Input` and `Button` components, native `<label>`s
  and no new dependency. The confirmation is compared in the browser; a mismatch shows a
  message and sends nothing. On submit it `POST`s JSON `{ name, email, password }` to
  `/api/v1/setup` (the same endpoint agents would use, `AGENTS.md` section 3). `201`:
  `router.push("/")`. `400`: the `errors` of the problem body are shown next to their
  fields. `404`: a short "this installation is already set up" message. Anything else: a
  generic failure message. The button is disabled while the request is in flight.
- The page reads a boolean through a service rather than through an endpoint: exposing
  "is this install empty" as a public endpoint would hand out information for no benefit
  (question 2).

### 4. End-to-end

The end-to-end database is not emptied between runs, but this test needs it empty of
accounts. `tests/e2e/prepare.ts` (which already refuses any database not named `*_e2e_test`)
also truncates `accounts` (cascading to credentials, sessions and the audit log) before the
app starts. In `playwright.config.ts` a `first-run` project runs `setup.spec.ts` alone, and
the `chromium` project (all other specs, which seed their own accounts) depends on it, so
the setup test always sees an empty install.

## Files

| Path                                                            | Change                                   |
| --------------------------------------------------------------- | ---------------------------------------- |
| `src/server/services/setup.ts`, `setup.integration.test.ts`     | create (tests first)                     |
| `src/app/api/v1/setup/route.ts`, `route.integration.test.ts`    | create (tests first)                     |
| `src/lib/schemas/auth.ts`, `auth.test.ts`                       | modify: `setupRequestSchema`, contract   |
| `src/lib/openapi/contracts.ts`, `docs/api/openapi.json`         | modify / regenerate                      |
| `src/app/setup/page.tsx`, `page.integration.test.tsx`           | create (tests first)                     |
| `src/components/setup-form.tsx`, `setup-form.test.tsx`          | create (tests first)                     |
| `tests/e2e/setup.spec.ts`, `prepare.ts`, `playwright.config.ts` | create / modify                          |
| `README.md`                                                     | modify: "open /setup" in Getting started |
| `docs/README.md`, WT-02, WI-016, WS-016                         | statuses                                 |

No new dependencies, no migration.

## Data model changes

None.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                    | Criterion          |
| --- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 1   | unit        | `setupRequestSchema`: valid body passes; name is trimmed and may not be blank or over 100; bad email, short password and unknown fields fail                            | input rules        |
| 2   | unit        | `SetupForm`: a mismatching confirmation shows a message and calls nothing; a valid submit posts `{ name, email, password }` without the confirmation                    | page, confirmation |
| 3   | unit        | `SetupForm`: `201` navigates to `/`; `400` shows the field errors; `404` shows the already-set-up message; the button is disabled while sending                         | page               |
| 4   | integration | `isSetupNeeded` is true on an empty database and false after an account exists                                                                                          | gate               |
| 5   | integration | `createFirstAdmin` creates an `admin` account (email lower-cased, name trimmed), a credential holding an Argon2id hash, and returns a cookie                            | creation           |
| 6   | integration | the audit log holds `setup.first_admin_created` (new account as actor) and then `auth.sign_in`                                                                          | audit              |
| 7   | integration | with any account present, even a deactivated one or an agent, it throws `404` and creates nothing                                                                       | one-time           |
| 8   | integration | 5 concurrent calls with different emails create exactly one account; the others are `404`                                                                               | race               |
| 9   | integration | a trigger that fails the audit insert (created in the test, dropped after) leaves no account and no credential                                                          | atomic             |
| 10  | integration | route: `201` with the account summary and a hardened `Set-Cookie`; the cookie then authenticates `GET /me` as `admin` with the admin permissions                        | creation, cookie   |
| 11  | integration | route: a second call is `404` with the problem body of an unknown path; nothing is created                                                                              | one-time           |
| 12  | integration | route: `400` with per-field errors and no echoed password; `403` for a foreign `Origin` before the body is read; `415` for non-JSON                                     | input rules        |
| 13  | integration | no response, log line or audit entry contains the password, its hash or the session token                                                                               | secrets            |
| 14  | integration | `SetupPage()` renders on an empty database and throws Next.js's not-found signal when an account exists                                                                 | page               |
| 15  | unit        | OpenAPI: `POST /api/v1/setup` is public and documents `404`; the contracts-versus-routes test passes                                                                    | OpenAPI            |
| 16  | e2e         | in a browser on an empty install: open `/setup`, fill the form, land on `/`, `GET /api/v1/me` is `200` as admin; `/setup` and `POST /api/v1/setup` are `404` afterwards | end to end         |
| 17  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm openapi:generate` leaves no diff                                                                         | gate               |

## Risks and open questions

For the owner:

1. **Who gets to be the first Admin.** On a freshly deployed install that is reachable from
   the internet, whoever opens `/setup` first becomes the Admin. That is inherent to
   decision 4 as approved. A cheap mitigation is an optional environment variable
   `SETUP_TOKEN`: if it is set, the form shows one more field and the endpoint requires the
   value (compared in constant time); if it is not set, nothing changes. I did **not**
   include it, to avoid adding scope you did not approve. I recommend it. Add it to this
   item, leave it as a follow-up, or leave it out?
2. **The page asks the database through a service**, not through an endpoint, to decide
   whether to show itself (see Approach 3). Everything else goes through the API. Agree?
3. **Discovery.** Until WI-017 a visitor who opens `/` on an empty install is not sent to
   `/setup`; the README tells the operator to open it. WI-017 adds the redirect together
   with the sign-in page. Agree?
4. **Signing in the new Admin.** The response sets a session cookie, so the person lands in
   the app without typing the password again. This writes a second audit entry
   (`auth.sign_in`). Agree?

Technical, settled by the tests:

5. **Not-found from a server component.** How `notFound()` surfaces when the component is
   called directly in a test, and how the `404` page renders, are taken from the Next.js 16
   documentation of the installed version (`not-found.md`) before the page and its test
   are written (hard rule 13).
6. **Playwright project dependencies** (`first-run` before `chromium`) change the shape of
   `playwright.config.ts`. If they interact badly with the single `webServer`, I stop and
   report instead of working around it.

## Deviations from the approved spec

1. **The page test is `page.integration.test.ts`**, not `.tsx`: the integration project only
   picks up `*.integration.test.ts`, and the test renders nothing, it only calls the page
   function.
2. **Two of my own tests were wrong and were corrected after the Red run**, without
   weakening what they check: the simulated `400` was not a valid problem body (it lacked
   `title`, `detail` and `requestId`, so the form rightly could not read it), and the
   "too short" password `short-secret` has exactly 12 characters, which is valid.
3. **`SubmitEvent`** is used for the form handler, because React's `FormEvent` is marked
   deprecated and the lint rule forbids it.
4. **`prepare.ts` also empties `rate_limits`**, not only `accounts`, so every end-to-end run
   starts with clean sign-in counters.
5. **Question 5 (not-found):** called directly, `notFound()` rejects with
   `digest: "NEXT_HTTP_ERROR_FALLBACK;404"`, as the installed Next.js documentation says;
   the browser test shows the 404 page.
6. **Question 6 (Playwright projects):** `first-run` before `chromium` works with the single
   `webServer`; the full suite is stable across consecutive runs.
7. **Not included, as decided with the owner:** the optional `SETUP_TOKEN`. It is recorded
   as a follow-up in `docs/README.md`.

## Implementation record

- Red: schema, form, service, route and page tests failed on missing modules and
  behaviour (committed before any code).
- Green: 272 Vitest tests (up from 250) and 15 Playwright tests (up from 14) pass.
  `pnpm db:generate` and `pnpm openapi:generate` leave no diff.
- Locally the database was PostgreSQL 16 (no Docker in the sandbox); CI runs the
  PostgreSQL 18 of `compose.yaml`.
- Later change: [WS-043](WS-043-setup-refuses-before-hashing.md) adds a cheap first look, so
  an installed server answers `404` before computing the password hash. The check inside the
  transaction still decides.
