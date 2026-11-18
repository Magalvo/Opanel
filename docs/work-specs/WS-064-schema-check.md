# WS-064 — The app refuses to start on a schema it does not match

- Status: Done (approved by the owner on 2026-11-18, questions 1 to 4 as proposed)
- Work-item: [WI-064](../work-items/WI-064-schema-check.md)
- Canonical docs: [0006](../canonical/0006-operations.md) (section 6);
  [WS-003](WS-003-validated-env.md) (the start-up check in `instrumentation.ts`);
  [WS-042](WS-042-safe-error-logging.md) (safe error logging);
  [WS-062](WS-062-production-image.md), [WS-063](WS-063-database-roles.md)

## Approach

### 1. Where things stand (checked on 2026-11-18, drizzle-orm 0.45.4)

- The installed migrator (`drizzle-orm/pg-core/dialect.js`, `migrate`) keeps
  `drizzle.__drizzle_migrations(id, hash, created_at)`. `created_at` is the journal entry's
  `when` (milliseconds). A migration counts as applied when its `when` is not later than
  the latest `created_at`; all pending migrations run in one transaction.
- The journal, `src/server/db/migrations/meta/_journal.json`, lists each migration's `tag`
  and `when`. `tsconfig.json` has `resolveJsonModule`.
- `src/instrumentation.ts` validates the environment when the server starts and exits on a
  bad one.
- `opanel_app` has no right on the `drizzle` schema (WS-063 left it to this item).

### 2. The check

`src/server/db/schema-version.ts`:

- `KNOWN` = the journal, imported as JSON, so the built app carries the list it was built
  with; no file is read at run time.
- `appliedSchemaVersion(db)`: `select max(created_at) from drizzle.__drizzle_migrations`;
  `null` when the table does not exist (`42P01`) or is empty.
- `compareSchema(known, applied)`, pure:
  - `{ kind: "match" }` when `applied` equals the last entry's `when`;
  - `{ kind: "behind", last: <tag of applied, or null>, needed: <last tag> }` when
    `applied` is `null` or earlier;
  - `{ kind: "ahead", last: <last tag>, appliedAt: <ISO time of applied> }` when later.
- `schemaMismatchMessage(result)`, the operator's message:
  - behind: "The database schema is behind this version of Opanel: its last migration is
    0013_one_unused_link (or: no migration has been applied), this version needs
    0014_runtime_role. Run migrate first.";
  - ahead: "The database has a migration this version of Opanel does not know, applied at
    2026-11-20T10:00:00.000Z; this version's last is 0014_runtime_role. Run the version
    that applied it, or restore the backup taken before the upgrade."

### 3. At start-up

In `register()` (Node.js runtime), after the environment check:
`await verifySchema(getDb())`:

- reads the applied version; if the database cannot be reached, retries every 2 seconds
  for 30 seconds, logging `describeError` only (WS-042) at the first failure and the last;
- on a mismatch, logs the message and `process.exit(1)`, as for a bad environment;
- on a match, logs nothing.

It runs before the server accepts requests, as `register` does. `next build` does not call
it.

Why retry: an operator starting the app and the database together without Compose's
`depends_on`, or a database restarting, should not need a manual restart; 30 seconds
bounds a broken configuration (open question 2).

### 4. The migration's grant

`0015_runtime_role_migrations_read.sql` (custom):

```sql
GRANT USAGE ON SCHEMA drizzle TO opanel_app;
GRANT SELECT ON drizzle.__drizzle_migrations TO opanel_app;
```

Only that table, read-only. The runtime-role test (WS-063) gains: `opanel_app` reads it,
and cannot insert into it.

### 5. Tests

- **Unit** (`schema-version.test.ts`): `compareSchema` for match, behind (one missing,
  none applied), ahead; both messages, naming tags and time.
- **Integration** (`schema-version.integration.test.ts`): `appliedSchemaVersion` on the
  migrated test database equals the last `when`; on a database with the table missing
  (a fresh schema in a transaction rolled back), `null`; as the runtime role, it reads.
- **Integration** (`verifySchema`): with an injected `exit` and `log`, a match calls
  neither; a mismatch logs the message once and exits `1`; an unreachable database
  (`127.0.0.1:1`) retries, then exits `1`, with no URL in any line (a short retry window
  injected).
- **Smoke** (`scripts/smoke-production.sh`): after the checks of WS-062 and WS-063, insert
  a row with a later `created_at` into `drizzle.__drizzle_migrations` as the owner,
  restart `app`: it exits non-zero and its log has the "does not know" message; delete the
  row: it starts and is healthy again.

### Considered and not chosen

- **Compare hashes too**: catches an edited applied migration, which hard rule 5 already
  forbids; a hash differs across line endings unless every checkout is LF (now true,
  WS-060), but the migrator itself does not compare them. Not in this item.
- **Check on every request, or in the health endpoint**: the schema only changes when
  `migrate` runs; at start-up is enough, and the health endpoint stays cheap (WS-005).
- **Read the journal from disk at start-up**: the image ships the folder, but the import
  ties the check to the build, which is what "the version it was built with" means.

## Files

| Path                                                                         | Change                                    |
| ---------------------------------------------------------------------------- | ----------------------------------------- |
| `src/server/db/schema-version.ts` (+ unit and integration tests)             | create: section 2                         |
| `src/instrumentation.ts`                                                     | modify: section 3                         |
| `src/server/db/migrations/0015_runtime_role_migrations_read.sql` (+ `meta/`) | create: section 4                         |
| `src/server/db/runtime-role.integration.test.ts`                             | modify: the read of the migrations' table |
| `scripts/smoke-production.sh`                                                | modify: section 5                         |
| `docs/README.md`, WT-12, WI-064, WS-064                                      | modify: statuses                          |

## Data model changes

Migration `0015_runtime_role_migrations_read`: two grants. No table changes.

## API contract

None.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                     | Covers criterion |
| --- | ----------- | -------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit        | `compareSchema` and the messages: match, one behind, none applied, ahead                                 | 2, 3, 4          |
| 2   | integration | `appliedSchemaVersion`: the last `when` on the test database; `null` without the table                   | 1, 4             |
| 3   | integration | runtime role: reads `drizzle.__drizzle_migrations`, cannot insert into it                                | 6                |
| 4   | integration | `verifySchema`: match does nothing; mismatch logs once and exits 1; unreachable retries, exits 1, no URL | 2, 3, 5          |
| 5   | smoke       | an unknown later migration stops the app with the message; removed, the app is healthy                   | 1, 3             |
| 6   | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `db:generate` and `openapi:generate` unchanged  | 7                |

## Risks and open questions

For the owner:

1. **Compare by the latest migration's time**, as the migrator does, not by hashes
   (section 2). **Recommend: as proposed.**
2. **Retry an unreachable database for 30 seconds, then exit** (section 3), rather than
   exiting at once or waiting forever. **Recommend: as proposed.**
3. **The journal is built into the app** (section 2), so the check compares against the
   build, not against files beside it. **Recommend: as proposed.**
4. **A second grant migration (0015)** for the migrations' table, rather than editing 0014,
   which is applied. **Recommend: as proposed** (hard rule 5).

## Deviations from the approved spec

1. **"Cannot read the database's schema version"**, not "cannot be reached": `verifySchema`
   retries any error of the read, which includes a missing grant (`42501`) as well as an
   unreachable server, so the line names what failed, not a guess at why. The message
   still carries `describeError` only.
2. **The "table missing" test renames the migrations' table** inside a transaction it rolls
   back, instead of using a fresh schema: the query names `drizzle.__drizzle_migrations`
   explicitly.
3. **The smoke test restarts the app** after inserting the unknown migration, and reads its
   log for the message; with `restart: unless-stopped`, Compose keeps restarting it, which
   is what an operator would see.

## Implementation record

- Red:
  - the unit tests of `compareSchema` and the messages failed before the module existed;
  - the integration tests of `appliedSchemaVersion` and `verifySchema` failed before
    those functions existed;
  - the runtime role's read of the migrations' table failed before migration 0015.
- Green:
  - `src/server/db/schema-version.ts`, with the journal imported;
  - migration `0015_runtime_role_migrations_read.sql`;
  - the call in `src/instrumentation.ts`, after the environment check.
- Smoke (local Docker):
  - every check of WS-062 and WS-063;
  - a row with a later `created_at` stops the app with the "does not know" message;
  - once the row is removed, the app is healthy again.
- `pnpm db:generate`: nothing to migrate. `pnpm openapi:generate`: no change.
- Gate on 2026-11-18:
  - typecheck, lint and Prettier pass;
  - Vitest 1278 of 1278;
  - `pnpm test:e2e` 79 of 79, two full runs with `--retries=0`; the app under test checks
    its schema at start as the runtime role;
  - Windows, Node 24, pnpm 10.28.0, Compose PostgreSQL on port 5433.
