# WS-068 — Backup and restore, rehearsed in CI

- Status: Done (approved by the owner on 2026-11-19, questions 1 to 5 as proposed)
- Work-item: [WI-068](../work-items/WI-068-backup-rehearsal.md)
- Canonical docs: [0006](../canonical/0006-operations.md) (section 5: the roles; section 6:
  migrations; section 8: backup, restore, rehearsal); [WS-062](WS-062-production-image.md)
  (the example install, the smoke test), [WS-063](WS-063-database-roles.md) (the runtime
  role, its grants), [WS-064](WS-064-schema-check.md) (the schema check)

## Approach

### 1. Where things stand (checked on 2026-11-19)

- The example install (`compose.production.yaml`) runs PostgreSQL 18 as `db`, with the
  owner role `opanel` (`POSTGRES_USER`); its init script creates the login role
  `opanel_app` on a new volume, and migration 0014 grants it the app's rights, with default
  privileges for later tables and `UPDATE`/`DELETE` revoked on `audit_log`, `task_events`
  and `comments`.
- Roles are global to the PostgreSQL server, not part of a database: `pg_dump` saves the
  grants to `opanel_app` but not the role. A restore into a server where the role does not
  exist fails on those grants. On the example install the init script creates it, so a new
  install is ready for a restore.
- The app checks the migration journal (`drizzle.__drizzle_migrations`) at start-up
  (WS-064); `pg_dump` of the whole database includes that schema.
- `.github/workflows/image.yml` already runs weekly and on changes to `src/**` (the
  migrations included), `docker/**`, the Dockerfile and the example install, and runs
  `smoke-production.sh` then `smoke-proxy.sh`.

### 2. The procedure being rehearsed

These are the commands item H puts in `docs/operations.md`, run from the directory of the
Compose file. The script runs exactly these, with its own project name and env file.

```bash
# Back up, while the app runs: the database server's own pg_dump, as the owner.
docker compose -f compose.production.yaml exec -T db \
  pg_dump -U opanel -d opanel --format=custom >opanel-backup.dump

# Restore, into a new install with an empty database (the init script has created
# opanel_app), using the same env file as the original install.
docker compose -f compose.production.yaml up -d db
docker compose -f compose.production.yaml exec -T db \
  pg_restore -U opanel -d opanel --exit-on-error <opanel-backup.dump
docker compose -f compose.production.yaml up -d   # migrate, then the app
```

- The server's own `pg_dump` and `pg_restore`, inside the `db` container: their version is
  the server's, so the dump format always matches.
- `--format=custom` (doc 0006); `--exit-on-error`, so a restore that does not apply cleanly
  stops at the first error instead of leaving a partial database that looks fine.
- Ownership and grants are restored as they were (no `--no-owner`, no `--no-privileges`):
  they are what keeps the runtime role least-privileged.
- The env file is part of what an operator must keep with the backup: it holds the
  database passwords and `BETTER_AUTH_SECRET`. The rehearsal reuses it; the guide says so.

### 3. `scripts/rehearse-backup.sh`

Same style as the two smoke tests: `set -euo pipefail`, its own Compose project
(`opanel-rehearsal`), a throwaway env file (`.env.rehearsal`, ignored by git), port 3997,
the backup file in a `mktemp` directory, everything removed at the end by a `trap`.

1. **Install and seed, through the API** (the setup token, then a session cookie): the
   Admin; a project; three tasks; one task moved to another column and its title changed
   (task history); two comments on it.
2. **Record**: the row count of every table in the `public` schema and of the migration
   journal (one `psql` query as the owner, sorted `table count` lines); the JSON of
   `GET /projects/{key}`, `GET /projects/{key}/tasks` and `GET /tasks/{id}/comments`,
   reduced with `jq` to stable fields (ids, keys, titles, columns, versions, comment
   bodies).
3. **Back up**, with the app running (section 2). Check the file is non-empty and starts
   with `PGDMP` (the custom format's signature).
4. **Destroy** the install: `down -v`. Only the backup file and the env file remain.
5. **Restore** into a new install of the same project name (a new, empty volume): `db`
   alone, wait for it to be healthy, `pg_restore`, then `up -d`.
6. **Check**:
   - `migrate` exited `0`; the app answers `200` on `/api/v1/health` and its container is
     `healthy`;
   - the row counts of step 2 are identical (the comparison prints the differing lines);
   - the Admin signs in with their password (a new cookie: the sessions table was
     restored, but the rehearsal does not rely on it), and the three reduced JSON
     documents are identical to step 2;
   - the app's connections use `opanel_app` (as `smoke-production.sh` checks);
   - as `opanel_app`: `TRUNCATE audit_log` and `DELETE FROM task_events` are refused with
     `permission denied`;
   - a new task can be created through the API (the runtime role's `INSERT` and sequence
     rights survived).

The checks use `jq`, which the GitHub runner has; the script checks for it at the start
and says so if it is missing.

### 4. CI

A third step in the existing job of `.github/workflows/image.yml`, after the two smoke
tests: it reuses the image layers they built, so the cost is one install and one restore
(about two minutes). The workflow's paths already cover migrations and the operations
files; the job's timeout goes from 20 to 30 minutes.

### Considered and not chosen

- **A separate job**: runs in parallel but builds the image a second time; the three
  scripts together stay well inside the timeout.
- **Restore into a second database on the same server** (`createdb opanel_restored`):
  cheaper, but it keeps the original's roles and volume, so it cannot show that the backup
  alone is enough. The rehearsal destroys the original instead.
- **Plain SQL dumps** (`pg_dump` without `--format`): doc 0006 chose the custom format
  (compressed, selective restore).
- **A `backup` command or a scheduled backup service in the example**: doc 0006 section 11
  puts automatic backups run by Opanel out of scope; the guide gives the commands and the
  operator schedules them.
- **Comparing a full dump of both databases**: the dumps differ in volatile ways (order of
  data in a table, the restored session rows); row counts plus the API's own view of the
  data check what matters without being brittle.

## Files

| Path                                    | Change                                                |
| --------------------------------------- | ----------------------------------------------------- |
| `scripts/rehearse-backup.sh`            | create: section 3                                     |
| `.github/workflows/image.yml`           | modify: the third step, the timeout (section 4)       |
| `.gitignore`                            | modify: `.env.rehearsal`                              |
| `README.md`                             | modify: one sentence naming the rehearsal             |
| `docs/README.md`, WT-12, WI-068, WS-068 | modify: statuses; WT-12 exit criterion "CI restores…" |

## Data model changes

None.

## API contract

None.

## Test plan (written first, in this order)

This item adds no application code: the script is the test. Red is the script run against
a deliberately broken procedure, so each check is seen to fail for the right reason.

| #   | Level | Test                                                                                                      | Covers criterion |
| --- | ----- | --------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | smoke | the script with the restore step skipped (the new install only migrated): the row counts differ, it fails | 3, 4             |
| 2   | smoke | the script restoring with `--no-privileges`: the app cannot read its tables; health or the checks fail    | 3, 6             |
| 3   | smoke | the script restoring with `--exit-on-error` into the non-empty original database: `pg_restore` fails      | 3                |
| 4   | smoke | the script as written: every check of section 3 passes, locally                                           | 1–6              |
| 5   | CI    | the image workflow runs it after the two smoke tests                                                      | 7                |
| 6   | gate  | `typecheck`, `lint`, `format:check`, `test`, `test:e2e` (unchanged: no application code)                  | 8                |

Rows 1 to 3 are temporary edits, run once, recorded in the implementation record and not
committed.

## Risks and open questions

For the owner:

1. **The rehearsal destroys the original install before restoring** (section 3, step 4),
   rather than restoring into a second database beside it. Closer to a real disaster
   recovery; costs one more start-up. **Recommend: as proposed.**
2. **Grants and ownership are restored as they were**, which needs `opanel_app` to exist
   first (section 1). The example install's init script creates it; the guide (item H)
   tells operators with their own PostgreSQL to create it before restoring.
   **Recommend: as proposed.**
3. **The backup is taken while the app is running.** `pg_dump` takes a consistent
   snapshot, so the app need not stop; the rehearsal checks that this snapshot restores.
   The upgrade procedure still stops the app before migrating (doc 0006 section 6).
   **Recommend: as proposed.**
4. **No upgrade rehearsal from a previous release in this item.** There is no release yet
   (no tags) to upgrade from, so WT-12's exit criterion "Upgrading from the previous
   release by the guide keeps all data" can only be checked once one exists. Proposal:
   item H documents the upgrade procedure and WT-12 records that criterion as covered by
   today's checks (each migration tested against a database built by the earlier ones,
   WS-063 and WS-064), with a follow-up to rehearse a real upgrade after the first tagged
   release. **Recommend: as proposed.**
5. **A third step in the existing image job**, timeout 30 minutes (section 4).
   **Recommend: as proposed.**

## Deviations from the approved spec

1. **Node.js reads the API's JSON, not `jq`** (section 3). `jq` is on the GitHub runner but
   not on every developer machine, and Node.js is already required to work on Opanel; two
   small shell functions (`field`, `reduce`) do what `jq` would have.
2. **`.gitignore` is unchanged**: its `.env*` rule already ignores `.env.rehearsal`.
3. **The new install's database is waited for over TCP** (`pg_isready -h 127.0.0.1`): on a
   new volume the image's entrypoint first runs a socket-only server for the init scripts,
   and a restore started then would race the creation of `opanel_app`.
4. **The workflow's header comment** now names all three scripts.

## Implementation record

- Red, each a temporary copy of the script, run once and not committed:
  1. the restore skipped (the new install only migrated): `the row counts differ`, with
     every table at 0 rows against the seeded counts (for example `task_events` 7 → 0);
  2. `pg_restore --no-privileges`: the app's schema check got `42501` (insufficient
     privilege) reading the migration journal and never became healthy;
  3. the original install not destroyed, the backup restored into its database:
     `pg_restore` stopped at `schema "drizzle" already exists`.
- Green: `scripts/rehearse-backup.sh` passed every check locally in 139 s (image layers
  cached): migrate and health on the restored install, identical row counts for every
  table and the migration journal, the Admin's sign-in, identical project, tasks and
  comments through the API, `opanel_app` connections, `TRUNCATE audit_log` and
  `DELETE FROM task_events` refused, a task created after the restore.
- `.github/workflows/image.yml`: the third step; timeout 30 minutes. README: the backup
  command, and that CI rehearses the restore.
- Gate on 2026-11-19:
  - typecheck, lint and Prettier pass;
  - Vitest 1303 of 1303;
  - `pnpm test:e2e` 79 of 79 with `--retries=0`;
  - Windows, Node 24, pnpm 10.28.0, Docker 29.9.1, Compose PostgreSQL on port 5433.
