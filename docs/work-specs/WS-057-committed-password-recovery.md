# WS-057 — A set password is never reported as a failure

- Status: Done (approved by the owner on 2026-11-17, questions 1 to 4 as proposed)
- Work-item: [WI-057](../work-items/WI-057-committed-password-recovery.md)
- Canonical docs: [0004](../canonical/0004-api-conventions.md) (responses, additive
  changes); [WS-019](WS-019-accept-invitation-or-reset-link.md) (accepting a link);
  [WS-016](WS-016-first-run-setup.md) (setup); [WS-017](WS-017-sign-in-page-and-protected-shell.md) (sign-in
  page); [WS-042](WS-042-safe-error-logging.md) (safe logging);
  [WS-056](WS-056-hashing-concurrency.md) (`server_busy`); audit of 2026-11-17, finding
  A06; `AGENTS.md` hard rules 7, 8 and 9

## Approach

### 1. Where things stand

- `acceptLink()` (`src/server/services/accept-link.ts`) checks the link, hashes, then in one
  transaction sets the password, uses the link, ends the account's sessions and writes the
  audit entry. Then it calls `signIn(..., { trusted: true })`. `createFirstAdmin()`
  (`setup.ts`) does the same after creating the Admin. Both comments already say "if this
  fails the password is already set and the person can sign in normally" (WS-019).
- `signIn()` creates the session through Better Auth's `signInEmail`, which verifies the
  password again (through the hash gate since WI-056), then writes `last_seen_at` and the
  `auth.sign_in` audit entry. Any error there propagates, so the route answers it: `429
server_busy`, or `500` for anything unexpected.
- `AcceptForm` answers `404` with "This link is no longer valid. Ask an administrator for a
  new one.", and a `5xx` or network error with "Something went wrong. Please try again."
  `SetupForm` answers `404` with "This installation is already set up." Neither tells the
  person that their password may already be set.
- `/sign-in` takes only `next` from the query.

### 2. The services: commit, then try to sign in

Both services split at the commit point. A shared helper in `sign-in.ts`:

```ts
export interface AfterCommitSignIn {
  account: AccountSummary;
  /** Cookie headers; empty when `signedIn` is false. */
  headers: Headers;
  signedIn: boolean;
}

/**
 * Signs in a person whose password was just committed (WS-057). A failure is logged without
 * its message and answered as `signedIn: false`: the change stands, and the person can sign
 * in normally.
 */
export async function signInAfterCommit(
  input: SignInInput,
  account: AccountSummary,
  db: Database,
  options?: { logError?: (message: string) => void; signIn?: typeof signIn },
): Promise<AfterCommitSignIn>;
```

- It calls `signIn(input, db, { trusted: true })`. On success: `{ ...result, signedIn: true }`.
- On any error: `logError("Signing in after a committed password change failed: " +
describeError(error))` (WS-042: class, code and constraint only), and
  `{ account, headers: new Headers(), signedIn: false }`.
- `acceptLink()` and `createFirstAdmin()` return it. The account summary comes from the row
  they already hold in the transaction, so nothing else is read. The checks and the
  transaction before it do not change, so every refusal before the commit still throws as
  today.

`signIn` and `logError` are options so the service tests can make the sign-in fail without
mocking a module. The routes do not pass them.

A partial sign-in (a session made, then the `last_seen_at`/audit write fails) is finding
A07 and is not changed here: such a failure is caught like any other, so the person is
sent to sign in, and the orphan session cookie is not set on the response.

### 3. The API

Two new response schemas in `src/lib/schemas/auth.ts`, each `accountSummarySchema` plus
`signedIn: z.boolean()`, with a description: "False when the change was saved but no
session could be created; sign in with the new password."

- `AcceptLinkResponse` for the `200` of `acceptLinkContract`;
- `SetupResponse` for the `201` of `setupContract`.

Adding a field to a response is additive (hard rule 9). The descriptions of the two
success responses say "The session cookie is set when `signedIn` is true."

### 4. The forms and the sign-in page

- `AcceptForm`: on `200`, parse the body; `signedIn: false` →
  `router.push("/sign-in?notice=password-set")`, else as today. `404` → "This link is no
  longer valid. If you just set your password with it, sign in with that password;
  otherwise ask an administrator for a new one." `5xx` and network errors → "We could not
  confirm the change. Your password may already be set: try signing in with it. If that
  does not work, ask an administrator for a new link."
- `SetupForm`: on `201` with `signedIn: false` → `/sign-in?notice=admin-created`. `404` →
  "This installation is already set up. If you just created the administrator, sign in."
  `5xx` and network errors → "We could not confirm the setup. The administrator may already
  exist: try signing in."
- `/sign-in` reads `notice` through an allowlist (`src/lib/sign-in-notice.ts`):
  `password-set` → "Your password is set. Sign in with it."; `admin-created` → "The
  administrator was created. Sign in with your password."; anything else → nothing. The
  message is a `role="status"` paragraph above the form. The value never reaches the page as
  text, so nothing from the URL is rendered.

The links in the messages point to `/sign-in`; the sign-in page itself is unchanged
otherwise.

### Considered and not chosen

- **Return an error code such as `password_set_not_signed_in`**: a non-2xx for a saved
  change is what makes clients retry. A success with `signedIn: false` says it was saved.
- **A second, link-proving session path** (the audit's alternative): needs its own token
  lifetime, abuse controls and audit semantics, for a failure that is already rare and has
  a simple recovery.
- **Retrying the sign-in on the server**: a busy gate would make it wait longer, and a
  database error is unlikely to clear in milliseconds.

## Files

| Path                                                                 | Change                                          |
| -------------------------------------------------------------------- | ----------------------------------------------- |
| `src/server/services/sign-in.ts` (+ `sign-in.integration.test.ts`)   | modify: `signInAfterCommit` (tests first)       |
| `src/server/services/accept-link.ts` (+ integration test)            | modify: use it, return `signedIn` (tests first) |
| `src/server/services/setup.ts` (+ integration test)                  | modify: use it, return `signedIn` (tests first) |
| `src/lib/schemas/auth.ts` (+ `auth.test.ts`)                         | modify: the two response schemas and contracts  |
| `src/app/api/v1/account-links/accept/route.ts` (+ integration test)  | modify: send `signedIn`                         |
| `src/app/api/v1/setup/route.ts` (+ integration test)                 | modify: send `signedIn`                         |
| `src/lib/sign-in-notice.ts` (+ `sign-in-notice.test.ts`)             | create: the allowlist                           |
| `src/app/sign-in/page.tsx` (+ `page.integration.test.ts`)            | modify: the notice                              |
| `src/components/accept-form.tsx` (+ test), `setup-form.tsx` (+ test) | modify: `signedIn: false` and the messages      |
| `docs/api/openapi.json`                                              | regenerated                                     |
| `docs/README.md`, WI-057, WS-057                                     | modify: statuses                                |

No new dependency, no migration, no new error code.

## Data model changes

None.

## API contract

- `POST /api/v1/account-links/accept` `200` and `POST /api/v1/setup` `201`: the body gains
  `signedIn: boolean`. When it is `false` no session cookie is set. Every other answer is
  unchanged.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                                                                                                | Covers criterion |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | integration | `signInAfterCommit`: a working sign-in gives `signedIn: true` and cookies; an injected sign-in that throws `serverBusy()`, and one that throws an error whose message holds a sentinel, give `signedIn: false`, empty headers, one log line without the sentinel    | helper           |
| 2   | integration | `acceptLink`, sign-in failing (injected): returns `signedIn: false`; the password is the new one (a normal sign-in with it works), the link is used, the old sessions are gone, `account.password_changed` (or `invitation_accepted`) is audited, no `auth.sign_in` | accept           |
| 3   | integration | `createFirstAdmin`, sign-in failing (injected): returns `signedIn: false`; the Admin and credential exist, `setup.first_admin_created` is audited, no session                                                                                                       | setup            |
| 4   | integration | both, sign-in working: `signedIn: true`, as today (existing tests kept)                                                                                                                                                                                             | unchanged        |
| 5   | integration | both, refused before the commit (`404` link, `403` token, `429` of the limiter): still thrown, nothing committed (existing tests kept)                                                                                                                              | refusals         |
| 6   | integration | routes, with the hash gate full only after the commit (gate mock that lets the first run through and refuses the next): accept `200` and setup `201` with `signedIn: false` and no `Set-Cookie`                                                                     | through routes   |
| 7   | unit        | `auth.ts`: the two response schemas require `signedIn`; the contracts use them                                                                                                                                                                                      | contract         |
| 8   | unit        | `sign-in-notice`: the two known values map to their messages; an unknown value, an array and `undefined` map to none                                                                                                                                                | allowlist        |
| 9   | integration | `/sign-in` page: each notice shows its message; an unknown one shows none and renders nothing from the URL                                                                                                                                                          | page             |
| 10  | unit        | `AcceptForm`: `200` with `signedIn: false` goes to `/sign-in?notice=password-set`; `signedIn: true` goes to `/`; the new `404` and network-error messages                                                                                                           | accept form      |
| 11  | unit        | `SetupForm`: the same with `admin-created`, and its `404` and network-error messages                                                                                                                                                                                | setup form       |
| 12  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm openapi:generate` changes only the two success responses and their new schemas                                                                                                                       | gate             |

## Risks and open questions

For the owner:

1. **Success with `signedIn: false`, not an error.** A saved change answered with a non-2xx
   invites a retry that can only fail. **Recommend: as proposed.**
2. **A lost response cannot be fixed on the server.** The forms' messages are the
   recovery: they tell the person to try signing in. **Recommend: as proposed.**
3. **The notice allowlist** keeps the URL from putting arbitrary text on the sign-in page.
   **Recommend: as proposed.**
4. **The branch is stacked on WI-056**, which is committed but has no pull request yet.
   **Recommend: open WI-056's pull request first; this one follows.**

## Deviations from the approved spec

None. Two existing tests were changed to the approved behaviour, not weakened: the accept
and setup route tests parse the success body with the new response schemas (the strict
`AccountSummary` refuses `signedIn`), and the forms' `404` tests expect the new messages.
The end-to-end test `accept-link.spec.ts` checked the old `404` text of the accept form and
failed on the first run; it now expects the new text (`people.spec.ts` matches only its
unchanged start).

## Implementation record

- Red (run before any code changed): 24 tests failed for the right reason (no
  `signInAfterCommit`, no response schemas, no `signedIn`, no notice, the old form
  messages); `sign-in-notice.test.ts` could not load.
- Green: `signInAfterCommit()` in `sign-in.ts`; `acceptLink()` and `createFirstAdmin()`
  return it with the summary of the row their transaction wrote; the routes send
  `{ ...account, signedIn }`; `AcceptLinkResponse` and `SetupResponse` in `auth.ts`;
  `src/lib/sign-in-notice.ts` and the notice on `/sign-in`; both forms.
- A mistake caught by an existing test: the first version showed the "may already be set"
  message for every unexpected status, so a `403` (foreign origin, refused before anything
  is saved) got it too. Now only `5xx` and network errors do, as section 4 says; other
  statuses keep "Something went wrong. Please try again."
- The route tests use a hash gate that lets the first operation through (the service's
  hash, before the commit) and refuses the next (Better Auth's verification, after it): the
  real failure WI-056 made possible.
- `pnpm openapi:generate`: the two success responses now reference `AcceptLinkResponse` and
  `SetupResponse`, which are new; nothing else. `pnpm db:generate`: no change.
- Gate on 2026-11-17: typecheck, lint and Prettier on the changed files pass; Vitest 1158 of
  1158; `pnpm test:e2e` 68 of 68 with `--retries=0`. Windows, Node 24, pnpm 10.28.0, Compose PostgreSQL on port 5433.
