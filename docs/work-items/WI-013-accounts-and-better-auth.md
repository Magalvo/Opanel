# WI-013 — Accounts, credentials and sessions schema; Better Auth installed; auth env

- Status: Done (approved by the owner on 2026-11-12)
- Work-track: [WT-02](../work-tracks/WT-02-accounts-and-permissions.md)
- Depends on: [WI-012](WI-012-permissions-and-actor.md)
- Work-spec: [WS-013](../work-specs/WS-013-accounts-and-better-auth.md)

## Outcome

The database knows about accounts, and Better Auth is installed and configured on top of
it, so that WI-015 can build sign-in endpoints without touching schema or configuration.
Concretely: the first Drizzle migration (`accounts`, `credentials`, `sessions`), Better
Auth used server-side only with Opanel's table names, Argon2id password hashing, the
password rules of WT-02 decision 7, and two new validated environment variables.

No endpoint, page or UI is added. Better Auth's own HTTP handler is not mounted.

## Acceptance criteria

- [x] Migrations create `accounts`, `credentials`, `sessions` and the `verification` table Better Auth requires, committed with the
      schema; `drizzle-kit generate` reports nothing left to generate.
- [x] A human account must have an email and one of the four human roles; an agent
      account may have no email. Emails are unique; accounts without one may repeat.
- [x] Deleting an account deletes its credentials and sessions.
- [x] Passwords are hashed with Argon2id; a hash verifies the right password and not a
      wrong one; the same password hashes differently each time; a malformed hash is a
      failed verification, never an exception.
- [x] The password rule is one Zod schema: 12 to 128 characters, no composition rules,
      and a rejected value is never echoed.
- [x] `BETTER_AUTH_SECRET` and `APP_URL` are validated at startup; a missing or weak
      value stops the server with a message that names the variable and never shows it.
- [x] With the real database, Better Auth signs in an account created with our hash,
      creates a session row that lasts 7 days, returns the account's `kind` and `role`,
      and deletes the row on sign-out. A wrong password creates no session.
- [x] Open sign-up is disabled: Better Auth's sign-up creates no account.
- [x] Better Auth telemetry is off.
- [x] Doc 0001's data sketch matches the tables.
- [x] The full quality gate passes.

## Notes

Not in this item: the audit log (WI-014), sign-in and sign-out endpoints, request
authentication, deactivated-account and sign-in-limiter handling (WI-015), invitations and
reset links (WI-018, WI-019). The `verification` table Better Auth uses for email flows is
not created: there is no email in v1, and our invitation tokens are our own (WT-02
decision 5).
