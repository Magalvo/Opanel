# WS-063 — An owner role for migrations, a least-privilege role for the app

- Status: Done (approved by the owner on 2026-11-18, questions 1 to 4 as proposed)
- Work-item: [WI-063](../work-items/WI-063-database-roles.md)
- Canonical docs: [0006](../canonical/0006-operations.md) (section 5: roles and threat
  model); [0001](../canonical/0001-ai-qa-agents-and-triage.md) (the append-only audit
  log); [WS-062](WS-062-production-image.md) (the image, `migrate`, the smoke test);
  [WS-003](WS-003-validated-env.md) (environment validation); `AGENTS.md` hard rule 5

## Approach

### 1. Where things stand (checked on 2026-11-18)

- One role everywhere: `opanel` in `compose.yaml` (the image's superuser), the same in
  `.env.test`, the end-to-end database and the example production install.
- The app issues no DDL or `TRUNCATE` at run time (searched `src`, `scripts`): only the
  test helpers do (`resetDatabase`, `failAuditFor`, `failSessionDeletes`, the end-to-end
  `prepare.ts`).
- Two identity sequences (`audit_log_id_seq`, `task_events_id_seq`); every other key is a
  UUID default. `pg_notify`, `LISTEN` and advisory locks need no grant.
- `audit_log` and `task_events` have `BEFORE UPDATE OR DELETE` triggers named
  `*_append_only` (migrations 0003, 0009).
- PostgreSQL 18: a non-owner has no `CREATE` on schema `public`.

### 2. The migration

`0014_runtime_role.sql` (a custom drizzle-kit migration), run by the migrating role (the
owner):

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'opanel_app') THEN
    CREATE ROLE opanel_app NOLOGIN;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO opanel_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO opanel_app;
REVOKE UPDATE, DELETE ON audit_log, task_events FROM opanel_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO opanel_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO opanel_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO opanel_app;
```

- **A fixed group role**, `opanel_app`, `NOLOGIN`: the operator connects the app as any
  login role that is a member of it (or makes it a login role). The name is fixed so the
  migrations can grant to it.
- **Creating it needs `CREATEROLE`** (the owner of the example and of development has it,
  being the image's superuser). Where the migrating role lacks it, the operator creates
  the role first; the migration then only grants (open question 2).
- **Default privileges** apply to tables the migrating role creates later, so a new table
  needs no grant line. An append-only table revokes `UPDATE, DELETE` in its migration.
  `CONTRIBUTING.md` says so, next to the migration rules.
- Nothing on the `drizzle` schema (the migrations' table): the app does not read it. Item
  C grants the one `SELECT` it needs.

### 3. Two connection strings

- `DATABASE_URL`: the app (and everything that is not `migrate`): the runtime role.
- `MIGRATION_DATABASE_URL`, new, optional, validated as a `postgres://` URL in
  `src/server/env.ts`: `migrate` connects with it when set, else with `DATABASE_URL`. So
  development keeps working with one URL. `migrateCommand` takes its database from a new
  `getMigrationDb()` in `src/server/db/client.ts`, closed like `getDb()`.
- `.env.example` and `.env.production.example` describe it.

### 4. The example production install

- `docker/production/init/01-runtime-role.sh`, mounted into the `db` service's
  `docker-entrypoint-initdb.d` (run once, on a new volume): creates `opanel_app` with
  `LOGIN` and the password `OPANEL_APP_DB_PASSWORD` from the env file. The migration then
  finds it and only grants.
- `.env.production`: `DATABASE_URL=postgres://opanel_app:…@db:5432/opanel` and
  `MIGRATION_DATABASE_URL=postgres://opanel:…@db:5432/opanel`.
- `scripts/smoke-production.sh` gains: after a request to the app, `pg_stat_activity` in
  `db` shows the app's connections as `opanel_app`; and, as `opanel_app`, `TRUNCATE
audit_log` is refused.

### 5. Tests

- **Integration tests keep the owner** (`.env.test`): they truncate between tests and
  create test triggers (open question 3).
- **A new integration test file**, `src/server/db/runtime-role.integration.test.ts`,
  opens a second connection as `opanel_app_test` (a login member of `opanel_app`, created
  by the global setup with a fixed local password if missing, test database only):
  - each refusal of acceptance criterion 2, by its code `42501`;
  - an insert and a read on an ordinary table, an insert into `audit_log`;
  - the catalog check of criterion 3: `has_table_privilege` for every table of `public`,
    and the append-only tables found by their `*_append_only` triggers.
- **End-to-end**: the app under test connects as the runtime role. `playwright.config.ts`
  passes `DATABASE_URL` as `opanel_app_test` and `MIGRATION_DATABASE_URL` as the owner;
  `tests/e2e/prepare.ts` migrates and truncates with the owner, and creates the test login
  role if missing. The test-side seeding (`tests/e2e/seed.ts`) keeps the owner.
- `docker/postgres/init` is unchanged: the roles are created by the migration and by the
  test setups, so existing development volumes need no reset.

### Considered and not chosen

- **Grant lines in every migration** (doc 0006 section 5 says "grants in every
  migration"): default privileges do it once and cannot be forgotten; the catalog test
  catches a gap either way. This refines the doc's wording, not its rule (open question
  1).
- **All integration tests as the runtime role**: every test helper that creates a trigger
  or truncates would need a second connection; the dedicated file and the end-to-end run
  cover the rights.
- **A role name set by the operator**: the migrations would have to read it from
  somewhere at migration time; a fixed group name with any login member is as flexible.

## Files

| Path                                                                                              | Change                                             |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `src/server/db/migrations/0014_runtime_role.sql` (+ `meta/`)                                      | create: section 2                                  |
| `src/server/env.ts` (+ test), `.env.example`                                                      | modify: `MIGRATION_DATABASE_URL`                   |
| `src/server/db/client.ts`, `migrate-command.ts`, `scripts/migrate.ts`                             | modify: the migration connection                   |
| `src/server/db/runtime-role.integration.test.ts`                                                  | create: section 5                                  |
| `vitest.integration.global.ts`                                                                    | modify: the test login role                        |
| `playwright.config.ts`, `tests/e2e/prepare.ts`, `tests/e2e/environment.ts`                        | modify: the app as the runtime role                |
| `compose.production.yaml`, `.env.production.example`, `docker/production/init/01-runtime-role.sh` | modify/create: section 4                           |
| `scripts/smoke-production.sh`                                                                     | modify: section 4                                  |
| `CONTRIBUTING.md`                                                                                 | modify: the rule for append-only tables            |
| `docs/canonical/0006-operations.md`                                                               | modify: section 5, default privileges (question 1) |
| `docs/README.md`, WT-12, WI-063, WS-063                                                           | modify: statuses                                   |

## Data model changes

Migration `0014_runtime_role`: a role, grants and default privileges. No table changes.

## API contract

None.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                            | Covers criterion |
| --- | ----------- | --------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit        | `MIGRATION_DATABASE_URL`: unset and empty mean unset; not a `postgres://` URL is refused, by name only          | 4                |
| 2   | integration | `runtime-role`: each refusal with `42501`; reads, writes and an audit insert work                               | 1, 2             |
| 3   | integration | `runtime-role`: the catalog check of every table and the append-only ones                                       | 3                |
| 4   | integration | `migrateCommand` connects with the migration URL when set (it migrates as the owner)                            | 4                |
| 5   | e2e         | the whole suite with the app as the runtime role                                                                | 6                |
| 6   | smoke       | `pg_stat_activity` shows `opanel_app`; `TRUNCATE` refused for it; every WS-062 check still passes               | 5                |
| 7   | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm db:generate` changes nothing after the migration | 8                |

## Risks and open questions

For the owner:

1. **Default privileges instead of a grant line in each migration** (section 2). Doc 0006
   section 5 says "every migration that creates a table grants the runtime role what it
   needs"; this item would amend it to "default privileges grant it; an append-only table
   revokes in its migration; a test checks both". **Recommend: amend doc 0006.**
2. **The migration creates `opanel_app` when it is missing**, which needs `CREATEROLE`; a
   migrating role without it needs the operator to create the role first, and the
   migration then fails with PostgreSQL's message until they do. **Recommend: as
   proposed.**
3. **Integration tests stay on the owner**, with one file and the end-to-end run proving
   the runtime role's rights (section 5). **Recommend: as proposed.**
4. **A fixed group role name, `opanel_app`**, with any login member. **Recommend: as
   proposed.**

## Deviations from the approved spec

1. **`comments` is append-only too.** Section 1 named `audit_log` and `task_events`; the
   catalog test found the `comments_append_only` trigger of migration 0012. Migration 0014
   revokes `UPDATE` and `DELETE` on all three, and the runtime-role test covers
   `comments`. The migration was corrected before it was committed or applied anywhere but
   the local test database, which was dropped and recreated so 0014 ran from scratch.
2. **The test login role is `opanel_app_test`**, created by `ensureRuntimeTestRole()` in
   `src/server/db/testing.ts` (integration global setup and end-to-end `prepare.ts`), only
   once `opanel_app` exists. The end-to-end app URL is `E2E_APP_DATABASE_URL` in
   `tests/e2e/environment.ts`.
3. **`migrationDatabaseUrl(env)`** in `src/server/env.ts` holds the fallback rule, unit
   tested; `getMigrationDb()` and `closeMigrationDb()` in `client.ts` use it.
4. **One end-to-end timeout raised.** "A card someone else moved is refreshed" blocks its
   page's events stream, so its board loads after the 3-second fallback (WS-048). Under
   four workers that load passed the default 5 seconds in 2 of 8 repeats: the screenshot
   showed "Loading the board…", not an error. The first card now has 15 seconds; 8 of 8
   passed. A timing margin, not a weaker check.
5. **The smoke test's wrong-password check** now overrides `MIGRATION_DATABASE_URL`, since
   that is what `migrate` connects with.

## Implementation record

- Red:
  - the `MIGRATION_DATABASE_URL` tests and the fallback test failed before the code
    existed;
  - the runtime-role test failed before migration 0014, on authentication (`28P01`): the
    role did not exist;
  - its catalog check then failed on `comments` (deviation 1).
- Green:
  - migration `0014_runtime_role.sql`;
  - `MIGRATION_DATABASE_URL`, `migrationDatabaseUrl`, `getMigrationDb`, and `migrate` on
    the migration connection;
  - the test role in both test setups, and the end-to-end app on it;
  - `docker/production/init/01-runtime-role.sh`, the two URLs in the example env file;
  - `CONTRIBUTING.md`, "Database roles and migrations";
  - canonical doc 0006 section 5 amended (question 1).
- `pnpm db:migrate` with `DATABASE_URL` as `opanel_app_test` and `MIGRATION_DATABASE_URL`
  as the owner: migrates.
- `scripts/smoke-production.sh` passed every check:
  - the WS-062 ones;
  - the app's connections use `opanel_app`;
  - `TRUNCATE audit_log` as `opanel_app` is refused.
- `pnpm db:generate` after the migration: nothing to migrate. `pnpm openapi:generate`: no
  change.
- Gate on 2026-11-18:
  - typecheck and lint pass; Prettier passes on the whole repository;
  - Vitest 1264 of 1264;
  - `pnpm test:e2e` 79 of 79, two full runs in a row with `--retries=0`, the app as the
    runtime role;
  - Windows, Node 24, pnpm 10.28.0, Compose PostgreSQL on port 5433.
