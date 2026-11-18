# WS-065 — `recover-admin`: an operator command to get back in

- Status: Done (approved by the owner on 2026-11-18, questions 1 to 4 as proposed)
- Work-item: [WI-065](../work-items/WI-065-recover-admin.md)
- Canonical docs: [0006](../canonical/0006-operations.md) (section 7);
  [WS-018](WS-018-account-management-api.md) (`issueResetLink`);
  [WS-059](WS-059-link-lifecycle-locks.md) (the account lock, one unused link);
  [WS-062](WS-062-production-image.md) (bundled one-shot commands)

## Approach

### 1. Where things stand (checked on 2026-11-18)

- `issueResetLink(actor, accountId)` requires `accounts:manage`, takes the account lock,
  refuses a deactivated account (`409`), issues an invitation link for an account without
  a password and a reset link otherwise, and records `account.reset_link_created` with
  `data: { kind }`. The link is `<APP_URL origin>/accept#<token>`.
- `account_tokens.created_by` is `NOT NULL` and references `accounts`.
- `recordAudit` takes `actor: null` for "no authenticated actor".
- `findAccountByEmail` lowercases and trims.
- WS-062 bundles `scripts/migrate.ts` into `dist/migrate.mjs` with esbuild.

### 2. The service

`issueOperatorResetLink(email, db = getDb())` in
`src/server/services/account-management.ts`, next to `issueResetLink`, sharing its core:

1. Find the human account by email (`findAccountByEmail`). Refuse with a typed error
   (`OperatorRefusal`, carrying the reason `unknown_account`, `not_admin` or
   `deactivated`) when there is none, when it is an agent, when its role is not `admin`,
   or when it is deactivated. The operator is trusted, so the reason is said plainly.
2. In one transaction, under `lockAccount` (WS-059): check the same again (the account
   may change meanwhile), then `issueLink` with kind `invitation` or `reset` as
   `issueResetLink` decides, and `created_by` set to the Admin's own account (open
   question 1).
3. `recordAudit` with `actor: null`, `action: "account.reset_link_created"`,
   `entity: "account"`, `entityId`, `data: { kind, via: "operator" }`.
4. Return the link (`url`, `expiresAt`).

`issueResetLink` keeps its behaviour; the common part becomes one private function, so
the two cannot drift.

### 3. The command

`scripts/recover-admin.ts`:

- Arguments: `--email <address>`, parsed by `parseRecoverAdminArgs(argv)` (exported, unit
  tested) with Zod (`z.email()`); anything else prints
  `Usage: recover-admin --email <admin email>` and exits `2`.
- Loads the environment like `migrate`; connects with `DATABASE_URL` (the runtime role:
  the command only reads accounts and writes a link and an audit entry, WS-063).
- Prints, on success, to standard output:
  `Reset link for <email>, valid until <ISO time>:` then the URL alone on the next line,
  and exits `0`. Nothing else is printed with the token.
- On an `OperatorRefusal`, prints the reason in a sentence to standard error and exits
  `1`; on any other error, `describeError` only (WS-042), exit `1`.

`package.json`: `admin:recover` runs it with `tsx`. The esbuild script becomes
`build:commands`, bundling both commands into `dist/` (`migrate.mjs`,
`recover-admin.mjs`); the `Dockerfile` copies both. In the example install:

```bash
docker compose -f compose.production.yaml run --rm app \
  node dist/recover-admin.mjs --email admin@example.com
```

`README.md` gains that line under "Running in production".

### 4. Never over HTTP

The command is a script: no route, page or contract is added, and the image runs it only
when the operator does. Doc 0006 section 7 already says so.

### Considered and not chosen

- **Reset the password directly** (the command sets a password the operator types): the
  password would pass through the operator's shell and history; a link keeps the person's
  password theirs.
- **Make `created_by` nullable** (a migration) for "made by the operator": the audit entry
  already says `via: "operator"`; the column then keeps meaning "an account".
- **Allow any account**: Admins can already reset everyone else; the command exists only
  for the case no Admin can act.
- **Reactivate a deactivated Admin**: doc 0006 section 7 decided the command changes no
  status or role.

## Files

| Path                                                             | Change                                    |
| ---------------------------------------------------------------- | ----------------------------------------- |
| `src/server/services/account-management.ts` (+ integration test) | modify: section 2                         |
| `scripts/recover-admin.ts` (+ `scripts/recover-admin.test.ts`)   | create: section 3                         |
| `package.json`, `Dockerfile`                                     | modify: `admin:recover`, `build:commands` |
| `scripts/smoke-production.sh`                                    | modify: run the command                   |
| `README.md`                                                      | modify: the recovery line                 |
| `docs/README.md`, WT-12, WI-065, WS-065                          | modify: statuses; the follow-up answered  |

## Data model changes

None.

## API contract

None.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                      | Covers criterion |
| --- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit        | `parseRecoverAdminArgs`: `--email a@b.c` gives the email; missing, empty, malformed, extra arguments give the usage                       | 6                |
| 2   | integration | active Admin: a reset link; accepting it (`acceptLink`) sets the new password; the audit row has no actor and `via: "operator"`, no token | 1, 4             |
| 3   | integration | invited Admin: an invitation link; an earlier unused link no longer accepted                                                              | 2, 3             |
| 4   | integration | unknown email, a Member, a deactivated Admin: each refused with its reason; no link and no audit row written                              | 5                |
| 5   | smoke       | in the example install, after setup with the token: the command prints `<APP_URL>/accept#…` and exits 0; an unknown email exits 1         | 8                |
| 6   | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `openapi:generate` unchanged                                                     | 7                |

## Risks and open questions

For the owner:

1. **`created_by` is the Admin's own account** for a link the command creates, with the
   audit entry saying `via: "operator"` (section 2), rather than a nullable column.
   **Recommend: as proposed.**
2. **The command connects as the runtime role** (`DATABASE_URL`), not the owner: it needs
   only what the app needs. **Recommend: as proposed.**
3. **The link is printed to the terminal**, once, as the People page shows it once. An
   operator who pipes it into a log keeps it there. **Recommend: as proposed**, and the
   operations guide (item H) says to send it to the Admin and not keep it.
4. **Refusals name the reason** (unknown, not an Admin, deactivated): the command runs on
   the server, for a trusted operator. **Recommend: as proposed.**

## Deviations from the approved spec

1. **The link goes to standard output with `process.stdout.write`**, not `console.log`,
   which the lint rules forbid; the refusals and failures go to standard error.
2. **The command imports the server modules after checking its arguments**, so a usage
   error exits `2` without needing a valid environment.
3. **The esbuild script is `build:commands`** (both commands into `dist/` with `.mjs`); the
   `Dockerfile` runs it and copies both files.
4. **A failed environment check is reported by its message** (it names variables only,
   WS-003) and exits `1`.

## Implementation record

- Red:
  - the integration tests of `issueOperatorResetLink` failed before the function existed;
  - the unit tests of `parseRecoverAdminArgs` failed before the script existed.
- Green:
  - `issueAccountLink`, the core shared by `issueResetLink` and `issueOperatorResetLink`;
  - `OperatorRefusal` with its three reasons;
  - `scripts/recover-admin.ts`, `admin:recover`, `build:commands`, the `Dockerfile`, a
    README line.
- The existing account-management and accept-link integration tests pass unchanged.
- Bundled and run locally: wrong arguments exit `2` with the usage; an unknown email exits
  `1` with "No human account has this email."
- Smoke (local Docker): every earlier check, plus, after setup with the token,
  `recover-admin` in the image prints `<APP_URL>/accept#…` for the Admin and exits `1`
  for an unknown email.
- `pnpm openapi:generate`: no change.
- Gate on 2026-11-18:
  - typecheck, lint and Prettier pass;
  - Vitest 1292 of 1292;
  - `pnpm test:e2e` 79 of 79 with `--retries=0`;
  - Windows, Node 24, pnpm 10.28.0, Compose PostgreSQL on port 5433.
