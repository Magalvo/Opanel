# WI-063 — An owner role for migrations, a least-privilege role for the app

- Status: Done
- Work-track: [WT-12](../work-tracks/WT-12-operations.md) (item B)
- Depends on: WI-062 (merged: the production image and `migrate`)
- Work-spec: [WS-063](../work-specs/WS-063-database-roles.md)

## Outcome

Today the app, the migrations and the tests all connect as one role, the owner of the
schema. A bug in the app, or a compromised app process, can therefore truncate tables,
alter them, or drop the triggers that keep `audit_log` and `task_events` append-only
(doc 0006 section 5, audit of 2026-11-17 finding A12).

After this item:

- a group role `opanel_app` holds exactly what the app needs: `SELECT`, `INSERT`,
  `UPDATE`, `DELETE` on the application tables, only `SELECT` and `INSERT` on the
  append-only `audit_log`, `task_events` and `comments`, no `TRUNCATE`, no DDL, nothing in the migrations' own schema;
- tables created by later migrations get the same rights by default, and an append-only
  table takes them back in its own migration;
- `migrate` connects with `MIGRATION_DATABASE_URL` (the owner) when it is set, and the app
  with `DATABASE_URL` (the runtime role);
- the example production install, the end-to-end tests and the production smoke test run
  the app as the runtime role, so a missing right fails a test.

## Acceptance criteria

- [x] A new migration creates `opanel_app` (`NOLOGIN`) if it does not exist, grants it its
      rights on every existing table and sequence, and sets the default privileges for
      tables and sequences the migrating role creates later.
- [x] Connected as a member of `opanel_app`: `TRUNCATE`, `ALTER TABLE`, `CREATE TABLE`,
      `DROP TRIGGER` and an `UPDATE` or `DELETE` on `audit_log` or `task_events` are each
      refused with `insufficient_privilege` (`42501`); ordinary reads and writes work.
- [x] A test fails if any table in `public` lacks the app's rights, or if an append-only
      table (one with an `*_append_only` trigger) grants `UPDATE` or `DELETE`.
- [x] `migrate` uses `MIGRATION_DATABASE_URL` when set, else `DATABASE_URL`; the new
      variable is validated like the others and never logged.
- [x] `compose.production.yaml` creates a login role in `opanel_app` on a new volume; the
      app connects with it and `migrate` with the owner; the smoke test checks that the
      app's connections use the runtime role.
- [x] The end-to-end tests run the app as the runtime role; the full suite passes.
- [x] The integration tests keep running as the owner (they create test triggers).
- [x] The full quality gate and the production smoke test pass.

## Notes

The schema version check of item C will need `SELECT` on the migrations' table; that item
grants it.
