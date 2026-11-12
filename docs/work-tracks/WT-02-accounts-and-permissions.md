# WT-02 — Accounts, human sign-in, roles and the permission layer

- Status: In progress (approved by the owner on 2026-11-12)
- Canonical docs: [0001](../canonical/0001-ai-qa-agents-and-triage.md) (sections 3, 4),
  [0003](../canonical/0003-task-management.md) (section 3),
  [0004](../canonical/0004-api-conventions.md)

## Goal

A person can sign in to Opanel with email and password, and every API request is resolved
to an `Actor` whose permissions are checked by one mechanism. An Admin can bring people
in, change their role and deactivate them, and each of those actions is in the audit log.

## In scope

- The shared API foundations from doc 0004: error format, validation helpers, request id.
- The `accounts` table (humans now; agents reuse it in WT-05), credentials and sessions,
  as the first Drizzle migration.
- Better Auth, used as a library for password hashing (Argon2id) and session handling.
- The permission catalogue of doc 0003 section 3, the four human roles as fixed bundles,
  and the `Actor` type every service function takes.
- The audit log table and the function that writes to it.
- Sign-in, sign-out and "who am I" endpoints, and request authentication for all others.
- Creating the first Admin on a fresh install.
- Account management by Admins: invite, change role, deactivate, reactivate.
- Changing one's own name and password.
- The UI for all of the above: sign-in page, protected app shell, account menu, an
  Admin "People" page.

## Out of scope

- Agent accounts, scopes and API tokens (WT-05). The `Actor` type and the request
  authentication are built so that WT-05 adds a second way to obtain an `Actor` without
  changing services.
- Teams and team membership (WT-03).
- Email of any kind: verification, invitations by email, "forgot password" by email.
  Notifications are out of v1.
- OAuth/SSO, two-factor authentication, per-project roles.
- Enforcement of the board permissions in doc 0003 section 3. They are defined in the
  catalogue here and enforced by the work-track that builds each feature.

## Design decisions

These are choices the canonical docs leave open. Each is detailed in the work-spec of the
item that implements it. The owner approved all of them on 2026-11-12.

1. **Better Auth is used server-side only.** Opanel defines its own endpoints under
   `/api/v1/auth/...` with Zod schemas, which call Better Auth's server API. Better Auth's
   own HTTP handler (`/api/auth/*`) is not mounted. Reason: `AGENTS.md` requires one API,
   described by OpenAPI generated from Zod, with the error format of doc 0004. Mounting
   Better Auth's handler would add a second, differently shaped API.
2. **Table names.** Better Auth's models are mapped onto Opanel's vocabulary: its `user`
   is our `accounts` table, its `session` is `sessions`, and its `account` (which holds
   the password hash per sign-in method) is `credentials`. The password hash therefore
   lives in `credentials`, not in a `password_hash` column on `accounts` as sketched in
   doc 0001 section 7. That sketch is explicitly "not a final schema"; doc 0001 will be
   updated to match when the spec is approved.
3. **Open sign-up is disabled.** Accounts come into existence only through the first-run
   setup or an Admin's invitation.
4. **First Admin: a first-run setup page.** While the install has no accounts, `/setup`
   asks for name, email and password and creates the first Admin. As soon as one account
   exists the page and its endpoint return `404`. The alternative is a command-line
   script; the page is friendlier for a self-hosted product and needs no shell access.
5. **Invitations without email: a link the Admin copies.** The Admin enters name, email
   and role; Opanel shows a single-use link, valid for 7 days, exactly once. The invited
   person opens it and chooses a password. The token is stored hashed, like API tokens.
6. **Forgotten password: the same mechanism.** An Admin generates a single-use reset link
   for an account. There is no self-service reset because there is no email.
7. **Password rules:** 12 to 128 characters, no composition rules. Changing a password
   signs out the account's other sessions.
8. **Sessions** last 7 days and are extended while in use. Deactivating an account, or
   changing its role, ends its sessions immediately.
9. **The last Admin is protected:** the only active Admin cannot be deactivated or
   demoted, by themselves or anyone else.
10. **Sign-in is rate limited** per IP address and per email, to slow password guessing.
    The limiter is stored in PostgreSQL (no new infrastructure).

## Work-items

Each item leaves the repository green and is one branch/PR.

| Item                                                       | Title                                                                        | Status   | Depends on     |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------- | -------- | -------------- |
| [WI-011](../work-items/WI-011-api-foundations.md)          | API foundations: problem-details errors, validation helpers, request id      | Done     | doc 0004       |
| [WI-012](../work-items/WI-012-permissions-and-actor.md)    | Permission catalogue, human roles and the `Actor` type (pure logic)          | Done     | none           |
| [WI-013](../work-items/WI-013-accounts-and-better-auth.md) | Accounts, credentials and sessions schema; Better Auth installed; auth env   | Proposed | WI-012         |
| WI-014                                                     | Audit log table and writer                                                   | Draft    | WI-013         |
| WI-015                                                     | Sign-in, sign-out, `GET /api/v1/me`; request authentication; sign-in limiter | Draft    | WI-011, WI-014 |
| WI-016                                                     | First-run setup: create the first Admin (API and page)                       | Draft    | WI-015         |
| WI-017                                                     | Sign-in page, protected app shell, account menu with sign-out                | Draft    | WI-015         |
| WI-018                                                     | Account management API: list, invite, change role, deactivate, reactivate    | Draft    | WI-015         |
| WI-019                                                     | Accepting an invitation or reset link: set a password (API and page)         | Draft    | WI-018         |
| WI-020                                                     | Admin "People" page                                                          | Draft    | WI-017, WI-018 |
| WI-021                                                     | Own profile: change name and password                                        | Draft    | WI-017         |

As in WT-01, each item gets its work-item and work-spec files just before it is started.

## Exit criteria

- On a fresh install, the first visitor creates the Admin account and lands in the app.
- An unauthenticated visitor to any app page is sent to the sign-in page; an
  unauthenticated API call gets the `401` problem body of doc 0004.
- An Admin can invite a person, who can then sign in with the role they were given.
- A Viewer, Member and Manager calling an Admin-only endpoint get `403`; this is covered
  by tests for every endpoint added in this track.
- Deactivating an account ends its sessions and prevents sign-in.
- Every state-changing action of this track appears in the audit log with its actor.
- No password, password hash, session token or invitation token appears in any API
  response (other than the one-time invitation link), log line or audit entry.
- The full quality gate passes on `main`.

## Notes for the implementer

Facts established while preparing this track, recorded so they are not rediscovered.

- **How an endpoint is written since WI-011.** Wrap the handler with `route()` from
  `src/server/http/route.ts`; read input with `readJson`, `readQuery` and `readParams`;
  report expected failures by throwing the constructors in `src/server/http/errors.ts`
  (services may throw them too); return `json()` or `noContent()`. Add the endpoint's
  contract, with its `request` schemas, to `src/lib/openapi/contracts.ts` and run
  `pnpm openapi:generate`. A test fails if a route has no contract or the reverse.
- **A new error code** (for example `version_conflict`) is added to `PROBLEM_CODES` in
  `src/lib/schemas/problem.ts` by the work-spec that needs it.
- **Better Auth, checked on 2026-11-12 against the published 1.7.22 type definitions**
  (not yet installed; re-check against the installed version, hard rule 13). Its peer
  ranges accept the installed Next.js, Drizzle ORM, drizzle-kit and Zod. The options this
  track relies on exist: per-model `modelName` and `additionalFields` (table and column
  mapping, extra columns such as `kind` and `role`), `emailAndPassword.disableSignUp`,
  `emailAndPassword.password.hash` / `verify` (for Argon2id), `minPasswordLength` /
  `maxPasswordLength`, `session.expiresIn` / `updateAge`, and
  `advanced.database.generateId` (`"uuid"` makes PostgreSQL generate the id).
- **Running the database-backed tests without Docker** (for example in a cloud sandbox):
  any local PostgreSQL works if it has a role `opanel` with password `opanel` and the
  three databases of `docker/postgres/init/01-create-test-db.sql`. CI remains the
  reference, on the PostgreSQL version of `compose.yaml`.

## Risks and open questions

1. **New dependencies.** `better-auth` (1.7.x is current; it supports the installed
   Next.js 16, Drizzle 0.45 and Zod 4) and an Argon2id implementation, because Better
   Auth's built-in password hash is scrypt and doc 0001 requires Argon2id. Exact packages
   and versions are pinned in WS-013 after reading the documentation of the version
   installed.
2. **Agents share the `accounts` table but have no email** (doc 0001), while Better Auth
   expects every row of its user model to have one. Proposed: `email` is nullable with a
   unique index, plus a database check that human accounts always have one. Better Auth
   only ever creates and reads human rows. To be confirmed against the installed version
   in WS-013.
3. **Resolved:** the owner approved all ten design decisions above as proposed on
   2026-11-12.
