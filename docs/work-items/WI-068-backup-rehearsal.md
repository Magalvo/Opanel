# WI-068 — Backup and restore, rehearsed in CI

- Status: Done
- Work-track: [WT-12](../work-tracks/WT-12-operations.md) (item G)
- Depends on: WI-063 (the two database roles), WI-064 (the schema check at start-up)
- Work-spec: [WS-068](../work-specs/WS-068-backup-rehearsal.md)

## Outcome

Doc 0006 section 8 decided how an install is backed up (`pg_dump --format=custom` with the
owner role) and restored (`pg_restore` into an empty database, then `migrate`, then the
app), and that CI rehearses it. Nothing does yet: no backup of an Opanel database has ever
been restored, so nobody knows whether the restored database keeps the runtime role's
rights, the append-only rules or the migration journal the app checks at start-up.

After this item, `scripts/rehearse-backup.sh` runs the example install, seeds it through
the API, backs it up with the commands the operations guide (item H) will give, destroys
the install, restores the backup into a new one, and checks that the app starts on it and
serves the seeded data with the same rights as before. The image workflow runs it weekly
and on every change to migrations, the image or the example install.

## Acceptance criteria

- [x] The backup is taken with `pg_dump --format=custom` as the owner role, from the
      running install, while the app is up.
- [x] The original install, its volume included, is removed before the restore: only the
      backup file and the env file carry over.
- [x] The backup is restored into the empty database of a new install with `pg_restore`,
      then `migrate` runs and exits `0` with nothing to apply, then the app starts and
      answers healthy (the schema check of WI-064 passes).
- [x] Every application table has the same number of rows after the restore as when the
      backup was taken, `audit_log`, `task_events` and `comments` included.
- [x] The seeded Admin signs in with their password on the restored install and reads the
      seeded project, its tasks and a task's comments as they were.
- [x] On the restored install the app still connects as the runtime role, can create a
      task, and cannot `TRUNCATE` `audit_log` or `DELETE` from `task_events`.
- [x] `.github/workflows/image.yml` runs the rehearsal; it runs locally with Docker too.
- [x] No application code or API contract change. The full quality gate passes.

## Notes

- Rehearsing an upgrade from the previous release (a WT-12 exit criterion) is not part of
  this item: there is no release yet to upgrade from. See WS-068, question 4.
