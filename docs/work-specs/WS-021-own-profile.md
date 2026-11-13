# WS-021 — Own profile: change name and password

- Status: Done (approved by the owner on 2026-11-13, all open questions accepted as proposed)
- Work-item: [WI-021](../work-items/WI-021-own-profile.md)
- Canonical docs: [0004](../canonical/0004-api-conventions.md) sections 3, 4, 7;
  [WT-02](../work-tracks/WT-02-accounts-and-permissions.md) decisions 7, 8;
  [WS-015](WS-015-sign-in-and-authentication.md), [WS-019](WS-019-accept-invitation-or-reset-link.md),
  [WS-022](WS-022-sign-in-hardening.md), [WS-023](WS-023-api-guard-rails.md);
  `AGENTS.md` hard rules 4 to 9

## Approach

### 1. Endpoints

Both act only on the caller's own account, so, like `GET /me` and `sign-out` (WS-015
question 3), they need a session and **no permission** from the catalogue. This spec adds
them to `AUTHENTICATION_ONLY_OPERATIONS` in `src/lib/openapi/routes.test.ts`, and that test's
expected list is updated to the four operations. Every handler calls `assertSameOrigin`
first, then `authenticate`, then reads the body.

| Operation                  | Body (strict)                      | Success    | Errors                            |
| -------------------------- | ---------------------------------- | ---------- | --------------------------------- |
| `PATCH /api/v1/me`         | `{ name }`                         | `200` `Me` | `400`, `401`, `403`, `415`        |
| `POST /api/v1/me/password` | `{ currentPassword, newPassword }` | `204`      | `400`, `401`, `403`, `415`, `429` |

- `name`: trimmed, 1 to 100 characters, the rule of `inviteRequestSchema` (one shared
  `accountNameSchema` is extracted into `src/lib/schemas/accounts.ts` and used by invite,
  setup and this endpoint).
- `currentPassword`: 1 to 128 characters (like sign-in: the 12-character minimum is not
  applied to an existing password). `newPassword`: `passwordSchema`.
- A wrong current password is **`400 invalid_request`** with
  `errors: [{ path: "currentPassword", message: "Is not your current password." }]`. Not
  `401`: the shell treats `401` as "your session is gone" and would send the person to the
  sign-in page. No new problem code is needed.
- A new password equal to the current one is accepted (no rule forbids it; see question 3).

### 2. Session id from `authenticate`

`Authenticated` gains `sessionId: string`, taken from `response.session.id` of Better Auth's
`getSession` (the installed 1.7.22 types declare it). The password service needs it to keep
the caller's session while it deletes the others. Nothing else changes in `authenticate`.

### 3. Services (`src/server/services/profile.ts`)

`renameSelf(actor, name, db = getDb())`: in one transaction, update `accounts.name` and
`updated_at` of `actor.accountId` and, only if the trimmed name differs from the stored one,
write `account.name_changed` (entity the account, no `data`: the name is not repeated in the
append-only log). Returns the account row, which the route turns into the `Me` body exactly
as `GET /me` does (`summarize` plus sorted permissions).

`changeOwnPassword(actor, { sessionId, currentPassword, newPassword }, db = getDb())`:

1. Consume `password:account:<accountId>` with `CHANGE_PASSWORD_RULE` (10 attempts per 15
   minutes, added to `rate-limit.ts` and to `LONGEST_WINDOW_SECONDS`). Over the limit:
   `rateLimited`, no audit row. Per account, not per address: the threat is someone holding a
   stolen session cookie who wants to learn the password, and they control their address.
   The key count is bounded by the number of accounts.
2. Read the account's `credential` row. Verify `currentPassword` with `verifyPassword`. No
   row, or a mismatch: throw `invalidRequest` with the field error above. No audit row.
3. Hash `newPassword` (`hashPassword`) before the transaction, as WS-019 does.
4. In one transaction: update the credential's `password_hash` and `updated_at`; delete the
   account's `sessions` **except** `sessionId`; delete the account's unused reset links (an
   Admin-issued reset is moot once the person chose a password); write
   `account.password_changed` with `data: { via: "self" }`.

The current session is kept, so no new cookie is issued and the person stays where they are.
The check on the current password is outside the transaction; two simultaneous changes both
succeed in turn, and the last one wins, which is what the person asked for twice.

### 4. Page (`/profile`)

- `src/app/(app)/profile/page.tsx`: server component, `requireAccount()`, no permission
  (every role has a profile). Renders `ProfilePage` with the account's name and email.
- `src/components/profile/profile-page.tsx` (client): two cards.
  - **Name**: one field, prefilled; "Save" sends `PATCH /api/v1/me`; on `200` shows "Saved."
    and calls `router.refresh()` so the shell's account menu shows the new name. The email is
    shown read-only with the note that it cannot be changed.
  - **Password**: current, new, confirm. A mismatching confirmation is reported in the
    browser and nothing is sent. On `204` the fields are cleared and it says "Password
    changed. You were signed out on your other devices." `400` shows the field errors, `429`
    the wait, anything else a generic message. Buttons are disabled while sending.
  - Native labels, the existing `Input`, `Button` and `Card`-like markup of the People page.
- `AccountMenu` gets a "Profile" item, above "Sign out", linking to `/profile`.

### 5. Existing code touched

`src/server/auth/authenticate.ts` (`sessionId`), `src/lib/schemas/auth.ts` (request schemas
and two contracts, next to `meContract`), `src/lib/schemas/accounts.ts` (`accountNameSchema`),
`src/lib/openapi/contracts.ts`, `src/server/services/rate-limit.ts` (one rule),
`src/lib/openapi/routes.test.ts` (the authentication-only list), `src/app/api/v1/me/route.ts`
(adds `PATCH`), `src/components/app-shell/account-menu.tsx`. No change to
`AUDIT_ACTIONS`: `account.name_changed` and `account.password_changed` already exist.

## Files

| Path                                                                      | Change                         |
| ------------------------------------------------------------------------- | ------------------------------ |
| `src/server/services/profile.ts`, `profile.integration.test.ts`           | create (tests first)           |
| `src/app/api/v1/me/route.ts`, `route.integration.test.ts`                 | modify: `PATCH` (tests first)  |
| `src/app/api/v1/me/password/route.ts`, `route.integration.test.ts`        | create (tests first)           |
| `src/server/auth/authenticate.ts`, `authenticate.integration.test.ts`     | modify: `sessionId`            |
| `src/lib/schemas/auth.ts`, `auth.test.ts`                                 | modify: schemas and contracts  |
| `src/lib/schemas/accounts.ts`, `accounts.test.ts`                         | modify: `accountNameSchema`    |
| `src/server/services/rate-limit.ts`, `rate-limit.integration.test.ts`     | modify: `CHANGE_PASSWORD_RULE` |
| `src/lib/openapi/contracts.ts`, `routes.test.ts`, `docs/api/openapi.json` | modify / regenerate            |
| `src/app/(app)/profile/page.tsx`, `page.integration.test.ts`              | create (tests first)           |
| `src/components/profile/profile-page.tsx`, `profile-page.test.tsx`        | create (tests first)           |
| `src/components/app-shell/account-menu.tsx`, `account-menu.test.tsx`      | modify: "Profile" item         |
| `tests/e2e/profile.spec.ts`                                               | create                         |
| `docs/README.md`, WT-02, WI-021, WS-021                                   | modify: statuses               |

No new dependency and no migration.

## Data model changes

None. `accounts.name`, `credentials.password_hash`, `sessions` and `account_tokens` exist.

## API contract

See section 1. Both operations are `public: false` and authentication-only; their contracts
document every status in the table, and `PATCH /me` reuses `meResponseSchema`.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                         | Criterion      |
| --- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 1   | unit        | schemas: `{ name }` strict, trimmed, 1 to 100; `{ currentPassword, newPassword }` strict, current 1 to 128, new 12 to 128; unknown fields fail; messages never contain the value             | input rules    |
| 2   | unit        | contracts: both authentication-only, statuses documented; the routes test lists exactly the four authentication-only operations and the guard-rail check passes for the new handlers         | OpenAPI        |
| 3   | unit        | `AccountMenu` has a "Profile" link to `/profile`                                                                                                                                             | page           |
| 4   | unit        | `ProfilePage` name form: prefilled; sends `{ name }` only; `200` shows "Saved." and refreshes; `400` shows the field error; disabled while sending                                           | page           |
| 5   | unit        | `ProfilePage` password form: mismatching confirmation sends nothing; a valid submit sends `{ currentPassword, newPassword }` only; `204` clears and confirms; `400`, `429` show messages     | page           |
| 6   | integration | `authenticate` returns the id of the session that the cookie belongs to                                                                                                                      | session id     |
| 7   | integration | `CHANGE_PASSWORD_RULE`: the 11th attempt for one account is refused with a retry delay; another account is unaffected; counters are purged with the others                                   | limiter        |
| 8   | integration | `renameSelf`: name updated and trimmed; `account.name_changed` with the caller as actor; the same name writes no audit row                                                                   | rename         |
| 9   | integration | `changeOwnPassword`: the new password signs in, the old fails; other sessions gone, the caller's kept; unused reset links gone; `account.password_changed` `{ via: "self" }`                 | password       |
| 10  | integration | wrong current password: `400` on `currentPassword`, nothing changed, no audit row                                                                                                            | wrong password |
| 11  | integration | a trigger that fails the audit insert leaves the old password and every session intact                                                                                                       | atomic         |
| 12  | integration | routes: `PATCH /me` `200` with the `Me` body for a Viewer; `POST /me/password` `204`; `401` without a session; `403` foreign `Origin` before the body is read; `415`; `400` per field; `429` | routes         |
| 13  | integration | no response, log line or audit entry contains either password, the hash or the session token                                                                                                 | secrets        |
| 14  | integration | `/profile` page renders for a Viewer and redirects without a session                                                                                                                         | page           |
| 15  | e2e         | a Member renames themselves and sees it in the menu; changes their password; a second browser context is signed out; the old password fails at sign-in and the new one works                 | end to end     |
| 16  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm db:generate` and `pnpm openapi:generate` leave no diff                                                                        | gate           |

## Risks and open questions

For the owner:

1. **Our own transaction, not Better Auth's `changePassword`.** Better Auth 1.7.22 has a
   `changePassword` with `revokeOtherSessions`, but its writes cannot join Opanel's
   transaction, so the audit entry could be lost after the password changed. WS-019 already
   writes the credential directly with the same Argon2id hash; I do the same here. Agree?
2. **Wrong current password is `400`, not `401` or `403`.** It is a field error of the form,
   and `401` means "no session" to every client. Agree?
3. **No "must differ from the current password" rule.** WT-02 decision 7 has no composition
   rules; reusing the same password just ends the other sessions. Agree?
4. **Rate limit per account, 10 per 15 minutes.** Not per address (the attacker holding a
   stolen cookie controls it). A legitimate person who mistypes 10 times waits up to 15
   minutes. Agree?
5. **Name changes are audited without the old or new name** in `data`, to keep personal data
   out of the append-only log. The alternative is `{ from, to }`, which helps an Admin see
   who someone was. I recommend no names. Agree?

Technical, settled by the tests:

6. **`response.session.id`** is declared by the installed Better Auth types; test 6 proves it
   is the id of the row in `sessions`. If not, I stop and report.
7. **The shell after a rename.** The layout reads the account on the server, so
   `router.refresh()` must re-render it with the new name; test 15 checks it in a browser.

## Deviations from the approved spec

1. **Canonical doc 0004 section 7 now lists the authentication-only operations.** It said
   that every non-public endpoint checks a permission, which was already not true of `me`
   and `sign-out` (WS-015). The list, now four operations, is written there.
2. **`renameSelf` reads the old name `FOR UPDATE`** in its transaction, so two renames at the
   same moment each compare against the name they replace and audit correctly.
3. **The `/profile` page reads the caller's own account from `requireAccount()`** and does no
   permission check: it shows nothing but the caller's own name and email, which the shell
   already shows. This is the case doc 0004 section 7 allows ("needs no permission from the
   catalogue") for the page as for the API.
4. **One of my own tests was fixed after the Red run**, without weakening it: the "never
   echoes a rejected password" schema test used a 12-character value, which is a valid
   password, so the schema rightly accepted it. It now uses an 11-character one.

## Implementation record

- Red: schema, contract, route-list, menu, profile component, page, limiter, `authenticate`,
  service and route tests failed on missing modules and behaviour (committed before any
  code). The `sessionId` test failed with `expected undefined`.
- Green: 497 Vitest tests (up from 457) and 27 Playwright tests pass. `pnpm db:generate` and
  `pnpm openapi:generate` leave no diff; typecheck, lint and format pass.
- Question 6: `response.session.id` of Better Auth 1.7.22's `getSession` is the id of the
  row in `sessions` (test 6). Question 7: `router.refresh()` re-renders the shell with the
  new name (browser test).
- Locally the database was PostgreSQL 16 (no Docker in the sandbox); CI runs the
  PostgreSQL 18 of `compose.yaml`.
