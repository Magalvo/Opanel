# WS-058 — A session change and its audit entry stand or fall together

- Status: Approved (by the owner on 2026-11-17, questions 1 to 4 as proposed)
- Work-item: [WI-058](../work-items/WI-058-session-audit-atomicity.md)
- Canonical docs: [0001](../canonical/0001-ai-qa-agents-and-triage.md) (the audit log);
  [WS-015](WS-015-sign-in-and-authentication.md) (sign-in and sign-out);
  [WS-021](WS-021-own-profile.md) (changing one's password);
  [WS-022](WS-022-sign-in-hardening.md) (sign-in failures);
  [WS-040](WS-040-account-link-hardening.md) (the per-account lock);
  [WS-042](WS-042-safe-error-logging.md) (safe logging);
  [WS-057](WS-057-committed-password-recovery.md) (`signInAfterCommit`); audit of
  2026-11-17, finding A07; `AGENTS.md` hard rule 8

## Approach

### 1. Where things stand (checked on 2026-11-17, Better Auth 1.7.22)

- `signIn()` (`src/server/services/sign-in.ts`) calls `getAuth().api.signInEmail`, which
  verifies the password and inserts the session row through the Drizzle adapter, outside
  any transaction of ours. Then a separate transaction writes `last_seen_at` and
  `auth.sign_in`. A failure there propagates as `500`, and the session row stays.
- `signOut()` calls `getAuth().api.signOut`, then `recordAudit(auth.sign_out)`. Better
  Auth's sign-out catches and only logs a failed `deleteSession`, then clears the cookie:
  the response can be `204` and audited while the session row survives.
- Better Auth can run its own writes in a transaction (`drizzleAdapter(..., { transaction:
true })` and `runWithTransaction` from `@better-auth/core/context`), but only its own
  adapter's: the transaction object is internal, so our `recordAudit` cannot join it
  without depending on undocumented internals. `signInEmail` does not use one, and its
  `session.create.after` hooks run after the insert, queued "after transaction". **Sharing
  one transaction with Better Auth is not taken** (see "Considered and not chosen").
- Password changes take different locks: `acceptLink()` takes `lockAccount(tx, id)` (the
  per-account advisory lock of WS-040); `changePassword()` (`profile.ts`) takes none. Both
  delete the account's sessions in their transaction.
- `authenticate()` re-reads the account on every request and refuses a deactivated one; the
  role comes from that row.

### 2. Sign-in: write, then confirm under the account lock

1. Before calling Better Auth, read the account's credential hash (`credentials.password_hash`,
   provider `credential`). It is the hash the password will be checked against unless a
   change commits in between.
2. Call `signInEmail` as today. Keep its body's `token` (the session token, returned next
   to the cookie headers).
3. One transaction: `lockAccount(tx, account.id)`; re-read the account and its credential
   hash; then
   - if the account was deactivated or the hash differs from step 1: delete the session
     row by its token, record `auth.sign_in_failed` (reason `bad_credentials`, through the
     existing budget) and throw `401` "Invalid email or password.", as for a wrong
     password;
   - else write `last_seen_at` and `auth.sign_in`, as today.
4. If that transaction throws anything other than the `401` above, delete the session row
   by its token in a new statement, then rethrow (the route answers `500`, without
   cookies). If that delete fails too, log "A session may remain after a failed sign-in
   audit: " + `describeError(error)` (WS-042: no message) and rethrow the first error.

Why the lock closes the race: a password change holds the same lock while it updates the
hash and deletes the sessions. If it commits before step 3 takes the lock, step 3 sees the
new hash and deletes the session. If it starts after step 3 commits, the session row
already exists and its `delete from sessions where account_id = ...` removes it.

`signInAfterCommit` (WS-057) is unchanged: it catches both errors and answers
`signedIn: false`; now no session row is left behind either.

### 3. Sign-out: one transaction, then clear the cookie

The route already has the authenticated session's id (`auth.sessionId`, WS-021).

1. One transaction: delete the session row by id; record `auth.sign_out`.
2. Then call `getAuth().api.signOut` only for the headers that clear the cookie; its delete
   finds nothing.

When the transaction fails, the route answers `500`, the session row is untouched and still
works, and nothing is audited. `signOut()` takes `{ actor, sessionId, headers }`; the route
passes `auth.sessionId`.

### 4. Changing one's own password takes the account lock

`changePassword()` takes `lockAccount(tx, actor.accountId)` as the first statement of its
transaction, as `acceptLink()` does. Nothing else in it changes.

### 5. Deactivation and role changes: no new rule

A session inserted just before a deactivation commits may survive it, but `authenticate()`
refuses every request for a deactivated account, and a reactivation is an Admin's decision
that already keeps the sessions it finds. A role change deletes sessions so the next request
re-reads the role; the role is read from the account row on every request anyway. Neither
can let a session act with rights it should not have, so neither takes the new lock here.

### 6. The guarantee, documented

Added to canonical doc 0001, after the `audit_log` line of section 7:

> Sign-in and sign-out are audited atomically with what the API answers: a `2xx` sign-in has
> its `auth.sign_in` entry, and a sign-out's session delete and `auth.sign_out` entry are
> one transaction. Better Auth inserts a session in its own statement, so a process that
> stops between that insert and the audit transaction can leave an unaudited session whose
> cookie was never sent; it expires with the session lifetime (7 days). A sign-in made
> while the account's password changes does not survive the change (WS-058).

### Considered and not chosen

- **One transaction shared with Better Auth** (its adapter's `transaction: true` plus
  `runWithTransaction`): the transaction object is internal to Better Auth, and our audit
  would have to be written through its adapter or reach into its context, which changes
  between versions.
- **Audit first, then create the session**: a failed session insert would leave an
  `auth.sign_in` entry for a sign-in that did not happen.
- **Creating sessions ourselves**: Better Auth owns the cookie format and signing; doing it
  ourselves duplicates security-sensitive code.
- **A durable outbox or reconciliation job**: much more machinery for a window that is one
  process crash wide, and the orphan session it leaves is never handed to anyone.

## Files

| Path                                                                 | Change                                           |
| -------------------------------------------------------------------- | ------------------------------------------------ |
| `src/server/services/sign-in.ts` (+ `sign-in.integration.test.ts`)   | modify: sections 2 and 3 (tests first)           |
| `src/app/api/v1/auth/sign-in/route.integration.test.ts`              | modify: the failing audit through the route      |
| `src/app/api/v1/auth/sign-out/route.ts` (+ integration test)         | modify: pass `sessionId` (tests first)           |
| `src/server/services/profile.ts` (+ integration test)                | modify: take the account lock (tests first)      |
| `src/server/db/fail-writes.ts` (new test helper, used only by tests) | create: a trigger that fails one account's audit |
| `docs/canonical/0001-ai-qa-agents-and-triage.md`                     | modify: section 7: the guarantee                 |
| `docs/README.md`, WI-058, WS-058                                     | modify: statuses                                 |

No migration, no new dependency, no API contract change, no new error code.

## Data model changes

None. The test helper creates and drops a trigger in the test database only.

## API contract

None. Sign-in can already answer `401` and `500`; sign-out `500`.

## Test plan (written first, in this order)

Faults are injected in the real database: a test-only trigger raises on an `audit_log`
insert (or a `sessions` delete) whose account is the test's own, so parallel test files are
not affected. The database is never mocked.

| #   | Level       | Test                                                                                                                                                                                                                                                                                    | Covers criterion |
| --- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | integration | `signIn` with the `auth.sign_in` insert failing: throws, no session row for the account, `last_seen_at` unchanged                                                                                                                                                                       | 1                |
| 2   | integration | the same with the `sessions` delete also failing: throws the first error; one log line, without the trigger's message, says a session may remain                                                                                                                                        | 2                |
| 3   | integration | route `sign-in` with the audit failing: `500`, no `Set-Cookie`                                                                                                                                                                                                                          | 1                |
| 4   | integration | `signIn` racing a password change: a test transaction holds `lockAccount`, sets a new hash and deletes the sessions; `signIn` with the old password is started and waits on the lock; the test commits; `signIn` throws `401`, no session row remains, `auth.sign_in_failed` is written | 4                |
| 5   | integration | `signIn` committing before a password change: the change's transaction then deletes that session (the existing deletion, now under the shared lock)                                                                                                                                     | 4                |
| 6   | integration | `changePassword` takes the account lock: while a test transaction holds `lockAccount`, it waits, and finishes once the lock is released                                                                                                                                                 | 5                |
| 7   | integration | `signOut` with the `auth.sign_out` insert failing: throws; the session row exists and `authenticate` still accepts the cookie                                                                                                                                                           | 3                |
| 8   | integration | route `sign-out`: `204`, row gone, cookie cleared, `auth.sign_out` audited (existing test kept); with the audit failing, `500` and `/me` still answers `200` with the old cookie                                                                                                        | 3                |
| 9   | integration | existing sign-in, sign-out, accept-link and setup tests stay green unchanged                                                                                                                                                                                                            | unchanged        |
| 10  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm openapi:generate` and `pnpm db:generate` change nothing                                                                                                                                                                  | 7                |

## Risks and open questions

For the owner:

1. **Compensate, not share Better Auth's transaction.** The remaining window is a process
   crash between two statements, and the session it leaves was never sent to anyone.
   **Recommend: as proposed, with the guarantee written in doc 0001.**
2. **A sign-in that meets a password change is answered `401`**, like a wrong password, and
   audited as `bad_credentials`. A person who typed the new password in that same instant
   is refused once and signs in again. **Recommend: as proposed.**
3. **Deactivation and role changes keep their locks** (section 5). **Recommend: as
   proposed.**
4. **Canonical doc 0001 gets the guarantee paragraph** (section 6), so it is a canonical
   change approved with this spec. **Recommend: approve with this spec.**
