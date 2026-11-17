# WS-050 — Optional setup token for the first-run setup

- Status: Done (approved by the owner on 2026-11-17, questions 1 to 5 as proposed)
- Work-item: [WI-050](../work-items/WI-050-setup-token.md)
- Canonical docs: [0004](../canonical/0004-api-conventions.md) section 4 (error codes);
  [WT-04](../work-tracks/WT-04-realtime-board-sync.md) decision 13 (amendment A1, the
  approved behaviour); [WS-016](WS-016-first-run-setup.md) (first-run setup, question 1);
  [WS-043](WS-043-setup-refuses-before-hashing.md) (refuse before hashing);
  [WS-003](WS-003-validated-env.md) (validated environment); `AGENTS.md` hard rules 4, 7
  and 9

## Approach

### 1. Where things stand

- `POST /api/v1/setup` (`src/app/api/v1/setup/route.ts`) is public. `createFirstAdmin()`
  in `src/server/services/setup.ts` answers `404` on an installed server (WI-043), then
  hashes the password, then creates the Admin under an advisory lock.
- `src/app/setup/page.tsx` asks the service whether setup is needed and renders
  `SetupForm` (`src/components/setup-form.tsx`), which posts name, email and password.
- `src/server/env.ts` validates every variable with Zod; `CLIENT_IP_HEADER` shows how an
  optional variable treats an empty value as unset. Messages never contain the value.
  `src/instrumentation.ts` stops the server on an invalid environment.
- `PROBLEM_CODES` in `src/lib/schemas/problem.ts` and the table of doc 0004 section 4 list
  the error codes.

### 2. The environment variable

`SETUP_TOKEN` joins `envSchema`:

- optional; an empty string is the same as unset (as `CLIENT_IP_HEADER`);
- when set, 32 to 256 characters, else the error `"must be 32 to 256 characters"`, which
  never contains the value;
- no character rule: whatever the operator generates is accepted, as for
  `BETTER_AUTH_SECRET`.

`.env.example` gains a commented entry: what it does, that it matters only until the first
Admin exists, and `openssl rand -hex 32` to generate one. `README.md` ("Getting started")
gains two sentences: on an install that other people can reach before you finish setup,
set `SETUP_TOKEN`; the setup page then asks for it.

No start-up warning when it is unset (question 2).

### 3. Comparing the token

A new pure module `src/server/auth/setup-token.ts`:

```ts
/** True when `given` equals `expected`, in time that does not depend on where they differ. */
export function setupTokenMatches(expected: string, given: string | undefined): boolean;
```

Both values are hashed with SHA-256 (`node:crypto`) and compared with
`crypto.timingSafeEqual`, so values of different lengths never throw and never return
early. `undefined` and `""` never match. It lives in `src/server/auth/` with the other
credential checks.

### 4. The API contract

`setupRequestSchema` gains `setupToken: z.string().max(256).optional()`, with a description
saying it is required when the server has a setup token configured. It is an additive,
optional field, so it is not a breaking change (hard rule 9). Its value is never echoed:
the route's `400` field errors name the field, not its content (as today for passwords).

`setupContract` gains, under `403`, the new case: `"The request does not come from the app's
own origin (code forbidden), or the setup token is missing or wrong (code
invalid_setup_token)."`

New error helper in `src/server/http/errors.ts`:

```ts
export function invalidSetupToken(): ApiError; // 403, title "Forbidden", code "invalid_setup_token",
// detail "The setup token is missing or not correct."
```

`invalid_setup_token` joins `PROBLEM_CODES` and the rules of doc 0004 section 4, next to
`invalid_link`.

### 5. The service

`createFirstAdmin(input, db, options)` gains `input.setupToken?: string` and
`options.expectedSetupToken`, which defaults to `getEnv().SETUP_TOKEN`. The option lets the
integration tests run with and without a token without touching the process environment.
Order of checks:

1. `isSetupNeeded()` false → `404` (WI-043, unchanged).
2. A token is expected and `setupTokenMatches()` is false → `invalidSetupToken()`.
3. Hash the password, then the transaction under the lock, unchanged.

Nothing is written for a refused token: no account, no audit entry (question 3). A token is
looked at only on an empty install, so after setup the endpoint stays a plain `404` whether
or not one is sent.

A second exported function, `isSetupTokenRequired(env = getEnv()): boolean`, tells the page
whether to show the field. It only says whether a token is configured, which the field
itself reveals anyway; never the token.

The route passes `body.setupToken` through, unchanged otherwise.

### 6. The page and the form

- `src/app/setup/page.tsx` renders `<SetupForm tokenRequired={isSetupTokenRequired()} />`.
  The help line under the heading gains, when required: "Enter the setup token from the
  server's configuration."
- `SetupForm` gains the prop. When true, a first field "Setup token" (`type="password"`,
  `autoComplete="off"`, required) is shown and sent as `setupToken`; when false, nothing is
  shown or sent.
- On `403` with code `invalid_setup_token`, the form shows "The setup token is not
  correct." under the field and keeps the other values. Any other `403` (the origin check)
  keeps today's generic message.

### 7. Documentation

- Doc 0004 section 4: `invalid_setup_token` in the rule on specific codes.
- WS-016 question 1: one line pointing to WS-050, as WS-043 does for its own change.
- `docs/README.md`: the `SETUP_TOKEN` planning gap is removed when this item is done, and
  the statuses updated.

## Files

| Path                                                                                  | Change                                          |
| ------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `src/server/env.ts` (+ `env.test.ts`)                                                 | modify: `SETUP_TOKEN` (tests first)             |
| `src/server/auth/setup-token.ts`                                                      | create                                          |
| `src/server/auth/setup-token.test.ts`                                                 | create (unit, tests first)                      |
| `src/lib/schemas/problem.ts` (+ `problem.test.ts`)                                    | modify: `invalid_setup_token`                   |
| `src/server/http/errors.ts` (+ `errors.test.ts`)                                      | modify: `invalidSetupToken()`                   |
| `src/lib/schemas/auth.ts` (+ `auth.test.ts`)                                          | modify: `setupToken`, the `403` of the contract |
| `src/server/services/setup.ts` (+ `setup.integration.test.ts`)                        | modify: the token check (tests first)           |
| `src/app/api/v1/setup/route.ts` (+ `route.integration.test.ts`)                       | modify: pass `setupToken` (tests first)         |
| `src/app/setup/page.tsx` (+ `page.integration.test.ts`)                               | modify: `tokenRequired` (tests first)           |
| `src/components/setup-form.tsx` (+ `setup-form.test.tsx`)                             | modify: the field and the `403` (tests first)   |
| `docs/api/openapi.json`                                                               | regenerated                                     |
| `.env.example`, `README.md`                                                           | modify: operator instructions                   |
| `docs/canonical/0004-api-conventions.md`, `docs/work-specs/WS-016-first-run-setup.md` | modify: the new code; a pointer to WS-050       |
| `docs/README.md`, `docs/work-tracks/WT-04-realtime-board-sync.md`, WI-050, WS-050     | modify: statuses                                |

No new dependency, no migration.

## Data model changes

None.

## API contract

`POST /api/v1/setup`, public as before:

- request body `SetupRequest`: `name`, `email`, `password` as before, and optional
  `setupToken` (string, at most 256 characters);
- `403 invalid_setup_token` when the server has a token configured and the body's is
  missing or wrong; `403 forbidden` for the origin check, as before;
- every other response unchanged: `201`, `400`, `404`, `413`, `415`.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                                                               | Covers criterion |
| --- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit        | env: `SETUP_TOKEN` unset and empty both give `undefined`; 32 and 256 characters are accepted; 31 and 257 are refused with a message that names the variable and does not contain the value                                         | variable         |
| 2   | unit        | `setupTokenMatches`: equal values match; a different value of the same length, a prefix, a longer value, `""` and `undefined` do not; none throws                                                                                  | comparison       |
| 3   | unit        | `PROBLEM_CODES` holds `invalid_setup_token`; `invalidSetupToken()` is a `403` problem with that code and a detail that holds no token                                                                                              | code             |
| 4   | unit        | `setupRequestSchema` accepts a body without `setupToken` and with one; refuses one over 256 characters; the `403` of `setupContract` is documented                                                                                 | contract         |
| 5   | integration | service, token expected: missing and wrong token each throw `invalid_setup_token`; no hash is computed (spy on `hashPassword`, as the WI-043 tests do), no account and no audit entry exist                                        | refusal          |
| 6   | integration | service, token expected: the right token creates the Admin and signs them in                                                                                                                                                       | success          |
| 7   | integration | service, token expected, install already has an account: a wrong token gets `404`, not `403`                                                                                                                                       | order            |
| 8   | integration | service, no token expected: setup works without `setupToken` and with any `setupToken` sent                                                                                                                                        | unchanged        |
| 9   | integration | route, with the service's token taken from a mocked `getEnv`: `403` problem with `invalid_setup_token` and the request id; the response body and the logged lines (spy on `console`) do not contain the sent or the expected token | no leak          |
| 10  | integration | page: `tokenRequired` is passed as `true` with a token configured and `false` without                                                                                                                                              | page             |
| 11  | unit        | form: with `tokenRequired` the "Setup token" field is shown and its value sent as `setupToken`; without it, neither; a `403 invalid_setup_token` shows the message under the field and keeps the other values                      | form             |
| 12  | unit        | form: a `403 forbidden` still shows the generic message                                                                                                                                                                            | no regression    |
| 13  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm db:generate` leaves no diff; `pnpm openapi:generate` changes only the setup operation and the `SetupRequest` schema                                                 | gate             |

No new end-to-end test (question 4): the Playwright server runs without a token, and the
existing first-run test (`tests/e2e/setup.spec.ts`) keeps proving the unchanged path.

## Risks and open questions

For the owner:

1. **Where the page learns that a token is required.** From the service, through the
   environment, the same way it learns whether setup is needed (WS-016, question 2). The
   field's presence tells a visitor a token is configured, which is harmless: they still
   need its value. **Recommend: as proposed.**
2. **No start-up warning when `SETUP_TOKEN` is unset in production.** The existing
   `productionWarnings()` sees only the environment, not whether the install has accounts,
   so it would keep warning forever after setup, when the token no longer matters.
   Checking the database at start-up adds a query and a failure mode to start-up.
   **Recommend: no warning; the README and `.env.example` explain it.**
3. **Refused tokens are not audited.** The caller is anonymous and could fill the audit
   log at will; the sign-in limiter of WI-022 exists for the same reason on sign-in. A
   refused token changes nothing. **Recommend: not audited, and no rate limiter (WT-04
   decision 13: a 32-character random token cannot be guessed, and a refusal costs a
   SHA-256, not an Argon2id hash).**
4. **No end-to-end test with a token.** It would need a second Playwright web server with
   a different environment, for a path the integration and form tests already cover from
   the route to the rendered message. **Recommend: no new end-to-end test.**
5. **Length bounds 32 to 256.** 32 matches `BETTER_AUTH_SECRET`; 256 keeps the field and
   the body bounded. **Recommend: as proposed.**

## Deviations from the approved spec

- **`src/app/api/v1/setup/route.ts` is unchanged.** It already spreads the validated body
  into the service's input, so `setupToken` reaches the service with no edit. Its
  integration test was extended as planned (test 9), with `getEnv` mocked to configure a
  token.
- **Two test expressions were rewritten after the Red commit** because the linter refused
  them (`no-base-to-string` on the request body, and a needless template literal). What
  they check did not change.
- **A `400` field error on `setupToken`** (a value over 256 characters) is shown under the
  field, like the errors of the other fields. The spec did not mention it.
- **The page test finds the form's props in the rendered element tree**, since the page
  is a server component that is called, not rendered, in the integration project (as in
  WS-016).

## Implementation record

- Red: 11 unit tests (variable, comparison, code, schema, form) and 7 integration tests
  (service, route, page) failed on the missing module, code, field and behaviour
  (committed before any code).
- Green: 1023 Vitest tests (up from 992) and 62 Playwright tests pass. Typecheck, lint and
  format pass; `pnpm db:generate` leaves no diff; `pnpm openapi:generate` changed only the
  setup operation's `403`, the `SetupRequest` schema and the list of codes.
- Locally the database was PostgreSQL 16 (no Docker in the sandbox); CI runs the
  PostgreSQL 18 of `compose.yaml`.
