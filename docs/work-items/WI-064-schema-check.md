# WI-064 — The app refuses to start on a schema it does not match

- Status: Done
- Work-track: [WT-12](../work-tracks/WT-12-operations.md) (item C)
- Depends on: WI-062, WI-063 (merged)
- Work-spec: [WS-064](../work-specs/WS-064-schema-check.md)

## Outcome

Today the app starts against any database. Started before `migrate`, it runs on an old
schema and fails on the first query that needs a new column; started against a database a
newer version migrated (after a rollback of the app without restoring the backup), it may
write rows the newer schema does not expect. Doc 0006 section 6 decided that the app
refuses to start in both cases, naming both versions.

After this item, when the server starts it compares the migrations it was built with to
the ones the database has applied, and:

- if they match, it starts as today;
- if the database lacks some, it stops with a message naming the database's last
  migration and the one it needs, and saying to run `migrate`;
- if the database has one it does not know, it stops with a message naming its own last
  migration and when the unknown one was applied, and saying to run the newer version or
  restore a backup;
- if the database cannot be reached, it retries for a while, then stops with a message.

## Acceptance criteria

- [x] Against a fully migrated database the server starts; `GET /api/v1/health` is `200`.
- [x] Against a database missing the latest migration, the server exits non-zero before
      serving, with a message naming the database's last migration and the one needed.
- [x] Against a database with a migration newer than the app's, the server exits non-zero
      with a message naming the app's last migration and the unknown one's time.
- [x] Against an empty database, the message says no migration has been applied.
- [x] An unreachable database is retried for 30 seconds before the server exits; no
      message contains the connection string.
- [x] The runtime role can read the migrations' table, and only that, in the `drizzle`
      schema (a migration grants it).
- [x] No API contract change. The full quality gate and the production smoke test pass.
