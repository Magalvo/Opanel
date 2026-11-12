# WS-004 — PostgreSQL, Drizzle and the integration test harness

- Status: Proposed (must be `Approved` by the owner before any code is written)
- Work-item: [WI-004](../work-items/WI-004-database.md)
- Canonical docs: `AGENTS.md` sections 2, 3, 5 and hard rule 5; [0002](../canonical/0002-realtime-sync.md) (driver choice)

## Approach

### Database: PostgreSQL 18 in Docker Compose

`compose.yaml` runs `postgres:18-alpine` (18.6 today) with a named volume, a health check,
and port 5432 published on localhost only. An init script creates two databases owned by
one local user: `opanel` for development and `opanel_test` for integration tests.

Compose is for local development and CI only. The credentials in it (`opanel`/`opanel`)
are local defaults, not secrets.

### Driver: postgres.js

`postgres` (postgres.js) rather than `pg`. Both are supported by Drizzle; postgres.js has
first-class `LISTEN/NOTIFY` support, which canonical doc 0002 needs for live sync, and
needs no separate type package.

### Client module

`src/server/db/client.ts` exports `getDb()`. It creates the postgres.js pool and the
Drizzle instance on first call, from `getEnv().DATABASE_URL`, and reuses them afterwards
(stored on `globalThis` in development so hot reload does not leak connections). Importing
the module opens nothing, so `next build` needs no database.

### Schema and migrations

- `src/server/db/schema/index.ts` is the schema entry point. **It is empty in this item.**
  Inventing a placeholder table only to have something to migrate would be throwaway
  schema; the first real tables come with WT-02.
- `drizzle.config.ts` points drizzle-kit at the schema and at `src/server/db/migrations`.
- `pnpm db:generate` runs `drizzle-kit generate`. Generated SQL files are committed.
- `pnpm db:migrate` runs `scripts/migrate.ts`, which applies pending migrations with
  Drizzle's migrator. `drizzle-kit push` is not used anywhere (hard rule 5).

Consequence: the migration commands are wired and run, but the first time a real
migration flows through them is WT-02. The harness itself is proven here with a temporary
table created inside a test.

### Integration test harness

- Vitest gets two projects: `unit` (everything except integration tests, no database) and
  `integration` (`src/**/*.integration.test.ts`, Node environment, files run one at a
  time).
- The integration project's global setup loads `.env.test`, verifies the database name
  ends in `_test`, checks the database is reachable (failing with "run `docker compose up
-d`" if not), and applies migrations.
- Isolation: a `resetDatabase()` helper truncates every table in the `public` schema and
  is called before each integration test. Truncation is chosen over wrapping each test in
  a rolled-back transaction because services will open their own transactions, and
  `NOTIFY` (doc 0002) is only delivered on a real commit.
- `.env.test` is committed. It contains only the local test database URL, which is the
  same non-secret default as in `compose.yaml`. `.gitignore` gets an exception for it.

## Versions

| Package / image  | Version     | Kind                                      |
| ---------------- | ----------- | ----------------------------------------- |
| `postgres` image | `18-alpine` | Compose                                   |
| `drizzle-orm`    | 0.45.4      | dependency                                |
| `postgres`       | 4.1.1       | dependency                                |
| `drizzle-kit`    | 0.31.11     | dev                                       |
| `tsx`            | latest      | dev (runs `scripts/migrate.ts`)           |
| `@next/env`      | 16.4.6      | dev (loads `.env*` files outside Next.js) |

Drizzle 1.0 is in beta; the stable 0.45 line is used.

## Files

| Path                                         | Change                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `compose.yaml`                               | create                                                                                     |
| `docker/postgres/init/01-create-test-db.sql` | create: `CREATE DATABASE opanel_test`                                                      |
| `.env.test`                                  | create; `.gitignore` exception added                                                       |
| `.env.example`                               | unchanged (already has the development URL)                                                |
| `package.json`, lockfile                     | modify: dependencies; scripts `db:generate`, `db:migrate`, `test:unit`, `test:integration` |
| `drizzle.config.ts`                          | create                                                                                     |
| `scripts/migrate.ts`                         | create                                                                                     |
| `src/server/db/client.ts`                    | create: `getDb()`, `closeDb()`                                                             |
| `src/server/db/schema/index.ts`              | create (empty export)                                                                      |
| `src/server/db/migrations/`                  | created by `db:generate` (journal only)                                                    |
| `src/server/db/testing.ts`                   | create: `resetDatabase()`, test-database guard                                             |
| `src/server/db/testing.test.ts`              | create: unit tests for the guard (written first)                                           |
| `src/server/db/client.integration.test.ts`   | create: integration tests (written first)                                                  |
| `vitest.config.ts`                           | modify: `unit` and `integration` projects                                                  |
| `vitest.integration.setup.ts`                | create: global setup                                                                       |
| `eslint.config.mjs`                          | modify: allow `process.env` in `scripts/` and config files if needed                       |

## Data model changes

None (no tables). Two databases are created by Compose.

## API contract

None.

## Test plan (written first, in this order)

| #   | Level        | Test                                                                                                        | Covers criterion                     |
| --- | ------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 1   | unit         | the guard accepts a URL whose database name ends in `_test` and rejects any other, without echoing the URL  | cannot hit dev database              |
| 2   | integration  | `getDb()` runs `select 1` and returns `1`                                                                   | real query                           |
| 3   | integration  | `getDb()` returns the same instance on repeated calls                                                       | single client                        |
| 4   | integration  | a row inserted into a table created in the test is gone after `resetDatabase()`                             | isolation                            |
| 5   | integration  | a query inside `db.transaction` that throws leaves no row behind                                            | transactions work through the client |
| 6   | manual, once | stop the database; `pnpm test:integration` fails with the "start it" message; `pnpm test:unit` still passes | clear failure, unit independence     |
| 7   | manual, once | `pnpm db:generate` and `pnpm db:migrate` succeed with an empty schema                                       | commands wired                       |
| 8   | manual, once | `docker compose up -d` from a clean volume reports healthy with both databases present                      | compose                              |
| 9   | gate         | `typecheck`, `lint`, `format:check`, `test`, `build` (build with the database stopped)                      | gate; no DB at build                 |

## Risks and open questions

1. **PostgreSQL version.** 18 is proposed: it is the newest image I could pull and run
   here. Whether a `postgres:19` image exists could not be checked (the registry
   rate-limited the request). **Owner: is 18 fine?**
2. **Empty schema.** As explained above, no placeholder table. **Owner: agree, or would
   you rather see one real migration in this item?**
3. **Committed `.env.test`.** It holds only a localhost URL with the default local
   password. **Owner: acceptable, given hard rule 7 is about real secrets?**
4. drizzle-kit and the Drizzle migrator may reject an empty migrations folder. If so, the
   migrate script treats "no migrations folder" as nothing to do, recorded here.
5. Port 5432 may already be in use on a developer's machine. The Compose port is made
   overridable with an environment variable (`OPANEL_DB_PORT`, default 5432).
