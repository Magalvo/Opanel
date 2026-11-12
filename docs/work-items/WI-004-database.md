# WI-004 — PostgreSQL, Drizzle and the integration test harness

- Status: Proposed
- Work-track: [WT-01](../work-tracks/WT-01-project-boilerplate.md)
- Depends on: WI-003
- Work-spec: [WS-004](../work-specs/WS-004-database.md)

## Outcome

A developer can start PostgreSQL with one command, the app has a typed Drizzle database
client, migrations have a defined home and commands, and integration tests run against a
real, isolated test database. After this item, any feature can be built test-first down to
the SQL.

## Acceptance criteria

- [ ] `docker compose up -d` starts PostgreSQL with a development database and a separate
      test database, and reports healthy.
- [ ] Server code obtains a Drizzle client from one module, configured from the validated
      `DATABASE_URL`. No connection is opened at build time or at import time.
- [ ] `pnpm db:generate` creates SQL migration files from the schema; `pnpm db:migrate`
      applies pending migrations; both work when there are no migrations yet.
- [ ] An integration test executes a real query against the test database and passes.
- [ ] Integration tests cannot run against the development database: the harness refuses
      a database whose name does not end in `_test`.
- [ ] Data written by one integration test is not visible to the next.
- [ ] `pnpm test` runs unit and integration tests; `pnpm test:unit` runs without a
      database.
- [ ] With the database stopped, integration tests fail with a clear message saying how
      to start it.
- [ ] The full existing quality gate passes.

## Notes

No domain tables are created here. The first real schema arrives with WT-02 (accounts).
The health endpoint that uses this client is WI-005.
