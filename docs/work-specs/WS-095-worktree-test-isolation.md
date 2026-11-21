# WS-095 — Parallel worktrees can run the quality gate at the same time

- Status: Proposed
- Work-item: [WI-095](../work-items/WI-095-worktree-test-isolation.md)
- Canonical docs: `AGENTS.md` section 5 (the quality gate); `CONTRIBUTING.md` ("Local
  database"); the development-flow review of 2026-11-20, finding D01

## Approach

### 1. Where things stand (checked on 2026-11-21, `main` at cf0ec34)

- Integration tests read `DATABASE_URL` from `.env.test` (`opanel_test`), unless the shell
  sets it; `vitest.integration.setup.ts` empties every table before every test.
- End-to-end runs use `E2E_PORT = 3100` (a constant) and `E2E_DATABASE_URL`
  (`opanel_e2e_test` unless the shell sets it); `tests/e2e/prepare.ts` truncates
  `accounts` and `rate_limits`. The PostHog add-on uses port 3200 (a constant) and the
  same database. `mcp/e2e/mcp.spec.ts` imports `E2E_BASE_URL` from
  `tests/e2e/environment.ts`.
- `docker/postgres/init/01-create-test-db.sql` creates the two databases once, when the
  volume is first initialised; no harness creates a database.
- The roles `opanel_app` (migration 0014) and `opanel_app_test` (`ensureRuntimeTestRole`)
  are cluster-wide and created with `if not exists` checks; each database gets its own
  grants from its own migrations.
- Next.js 16.4.6 already builds into a directory of its own: `next dev` writes to
  `.next/dev`, `next build` to `.next`, and the two may run at once
  (`node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`, "separate output
  directories"). Two worktrees have two `.next` directories anyway.
- In the main checkout `.git` is a directory; in a linked worktree (`git worktree add`, as
  every Claude Code session here uses) it is a file holding `gitdir: ...`. CI checks out a
  plain clone: a directory.

### 2. The worktree ID

A new module, `src/server/db/worktree.ts` (pure functions, plus one that reads the
filesystem), computes one ID per checkout:

1. `OPANEL_WORKTREE` set and not empty: that value, which must match `^[a-z0-9]{1,16}$`
   (else an error that names the variable and the rule, never the value).
2. Otherwise, if the checkout's root holds a `.git` **file** (a linked worktree): the first
   8 hex characters of the SHA-256 of the root's absolute path, normalised (resolved; on
   Windows, lower-cased, since `C:\` and `c:\` are the same folder). Example:
   `3f9a07c2`.
3. Otherwise (main checkout, CI, a copy without Git): no ID, and everything below behaves
   exactly as today.

The checkout's root is found from the module's own location
(`new URL("../../..", import.meta.url)`), not from `process.cwd()`, so a command run from
a subfolder gets the same ID. The ID changes if the worktree folder moves; the old
databases then become stale (section 5 drops them).

### 3. Database names, and creating them on demand

`worktreeDatabaseUrl(url, id)` inserts `_<id>` before the suffix of the database name and
changes nothing else in the URL (host, port, credentials, query):

| Configured name   | In worktree `3f9a07c2`     |
| ----------------- | -------------------------- |
| `opanel_test`     | `opanel_3f9a07c2_test`     |
| `opanel_e2e_test` | `opanel_3f9a07c2_e2e_test` |

The suffix is `_e2e_test` when the name ends in it, else `_test`; a name that already
holds `_<id>` before its suffix is returned unchanged, so applying it twice is harmless.
With no ID the URL is returned as is. It applies to whatever URL is configured, from
`.env.test` or from the shell, so a different port (`OPANEL_DB_PORT=5433`) still works.
Every name still ends in `_test` / `_e2e_test`, and `assertTestDatabaseUrl` and the guard
in `prepare.ts` are unchanged.

Where it is applied:

- **Integration.** `vitest.integration.global.ts` and `vitest.integration.setup.ts` call
  `useWorktreeTestDatabase()` right after `loadEnvFiles()`: it rewrites
  `process.env.DATABASE_URL` in that process, before anything calls `getEnv()`. Each
  process computes the same name, so nothing depends on how Vitest passes environment
  variables to its workers.
- **End-to-end.** `tests/e2e/environment.ts` applies it to `E2E_DATABASE_URL`, so
  `E2E_APP_DATABASE_URL`, both Playwright configs and `prepare.ts` follow.

`ensureTestDatabase(url)`, in `src/server/db/testing.ts`:

- refuses any name that does not end in `_test` (the same guard);
- connects to the same server, as the same user, to the maintenance database `postgres`
  (created by `initdb` on every PostgreSQL server; the WI suggested `opanel`, which exists
  only with our `compose.yaml`);
- runs `create database "<name>"` when `pg_database` has no such name (the owner is the
  connecting user, `opanel`), and treats `duplicate_database` (42P04) as success, for two
  processes that race;
- runs before the migrations, in `vitest.integration.global.ts` and `prepare.ts`.

So `opanel_test` and `opanel_e2e_test` are also recreated if someone drops them, and the
"recreate the volume" advice disappears from `prepare.ts` and from the setup's message:
"Cannot reach PostgreSQL. Start it with `docker compose up -d`."

`ensureRuntimeTestRole` gets the same race treatment (`duplicate_object`, 42710), since
two worktrees migrating a fresh server at once could both try to create the role.

`01-create-test-db.sql` stays (WI question 3): harmless, and a fresh volume then needs no
create at all. Its comment says the harnesses now create any missing test database.

### 4. Ports

`tests/e2e/environment.ts` and `addons/posthog/e2e/environment.ts` take their ports from:

| Run            | Variable (wins when set) | No ID (today) | With an ID            |
| -------------- | ------------------------ | ------------- | --------------------- |
| App end-to-end | `E2E_PORT`               | 3100          | 20000 + (ID mod 1000) |
| PostHog add-on | `OPANEL_ADDON_E2E_PORT`  | 3200          | 21000 + (ID mod 1000) |

"ID mod 1000" reads the first 8 hex characters as a number; an `OPANEL_WORKTREE` value
that is not hex is hashed first. The variables must be an integer from 1024 to 65535,
else an error naming the variable. The ranges sit below 32768, the start of Linux's
ephemeral ports, and far from 3000 (`pnpm dev`) and 5432/5433.

Two worktrees pick the same port only when their IDs agree modulo 1000: about one chance
in 1000 for a pair, one in 100 with five worktrees alive at once, and it matters only if
both run end-to-end tests at the same moment (question 1). When the port is already
listening, the run stops at once, before `prepare` and the build, with:
"Port 20417 is already in use, probably by another end-to-end run. Set E2E_PORT to a free
port." (the add-on names its own variable). The check runs in the Playwright config's
main process only (workers, which load the config again, skip it), as a TCP connect
attempt with a short timeout.

### 5. Dropping a worktree's databases: `pnpm test:db:drop`

`scripts/drop-test-databases.ts`, run with `tsx` (`NODE_ENV=test`, so it reads
`.env.test` and the shell as the tests do):

- `pnpm test:db:drop` drops this checkout's two databases (the names the tests would use).
- `pnpm test:db:drop --stale` lists every database named `opanel_<id>_test` or
  `opanel_<id>_e2e_test` whose `<id>` belongs to no worktree in
  `git worktree list --porcelain` (each path hashed as in section 2), and drops them. Run
  it from any checkout after removing worktrees. A database of an `OPANEL_WORKTREE` ID is
  also "stale" by this rule, so the command prints what it will drop and drops only with
  `--yes`; without it, it only lists.
- Every name is checked to end in `_test` before the `drop database` (plain, not
  `with (force)`): a database still in use, by a run in progress, is reported and kept.
- It never drops `opanel_test` or `opanel_e2e_test` with `--stale`; the no-argument form
  in the main checkout does, which is harmless: the next run recreates them.

### 6. The `.next` directory (WI question 2)

No change. Next.js 16 already keeps `next dev` (`.next/dev`) and `next build` (`.next`)
apart, and each worktree has its own `.next`. A separate `distDir` would also make
`next build` rewrite `tsconfig.json` and `next-env.d.ts`. The only remaining overlap, the
app's and the add-on's end-to-end runs in one worktree at once, is not a use case.

### 7. Docs

- `CONTRIBUTING.md`, "Local database": the table names the default databases; a new
  paragraph "Several worktrees at once" says how the ID, the names and the ports are
  chosen, the variables that override them, and `pnpm test:db:drop` (`--stale`).
- `docs/work-items/WI-095` and this spec: statuses and the implementation record.
- The follow-up "Let end-to-end runs choose their port and database" is answered; the
  next index commit on `main` (`docs: follow-up from WI-095`) marks it so.

## Files

| Path                                         | Change                                                             |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `src/server/db/worktree.ts`                  | create: ID, database URL, ports, port-in-use check                 |
| `src/server/db/worktree.test.ts`             | create: unit tests                                                 |
| `src/server/db/testing.ts`                   | modify: `ensureTestDatabase`, `useWorktreeTestDatabase`, role race |
| `src/server/db/testing.integration.test.ts`  | create (or extend if present): create and drop against PostgreSQL  |
| `vitest.integration.global.ts`               | modify: worktree URL, create on demand, message                    |
| `vitest.integration.setup.ts`                | modify: worktree URL                                               |
| `tests/e2e/environment.ts`                   | modify: worktree URL and port                                      |
| `tests/e2e/prepare.ts`                       | modify: create on demand, message                                  |
| `playwright.config.ts`                       | modify: port-in-use check                                          |
| `addons/posthog/e2e/environment.ts`          | modify: worktree port                                              |
| `addons/posthog/playwright.config.ts`        | modify: port-in-use check                                          |
| `scripts/drop-test-databases.ts`             | create: `pnpm test:db:drop`                                        |
| `scripts/drop-test-databases.test.ts`        | create: which names `--stale` picks (unit)                         |
| `package.json`                               | modify: `test:db:drop` script                                      |
| `docker/postgres/init/01-create-test-db.sql` | modify: comment only                                               |
| `CONTRIBUTING.md`                            | modify: section 7                                                  |
| WI-095, WS-095                               | modify: statuses, implementation record                            |

Not touched: `.env.test`, `.env.example`, `compose.yaml`, `.github/workflows/ci.yml`,
`next.config.ts`, `mcp/`.

## Data model changes

None. No migration.

## API contract

None.

## Test plan (written first, in this order)

| #   | Level            | Test                                                                                                                                                                                        | Covers criterion |
| --- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit             | `worktreeId`: `.git` directory → none; `.git` file → 8 hex, stable; same path in another case on Windows → same ID; two paths → two IDs (temp folders)                                      | 1, 5             |
| 2   | unit             | `worktreeId`: `OPANEL_WORKTREE` wins; an invalid value throws a message naming the variable and not the value                                                                               | 1                |
| 3   | unit             | `worktreeDatabaseUrl`: `opanel_test` and `opanel_e2e_test` get `_<id>` before their suffix; idempotent; no ID → unchanged; host, port, user, query kept                                     | 1, 5             |
| 4   | unit             | ports: no ID → 3100 / 3200; an ID → 20000–20999 / 21000–21999, deterministic; `E2E_PORT` / `OPANEL_ADDON_E2E_PORT` win; invalid values throw naming the variable                            | 3, 5             |
| 5   | unit             | port check: a port with a listener (a `net` server on port 0) throws the message naming the variable; a free port passes                                                                    | 3                |
| 6   | unit             | `--stale` selection: given database names and live worktree IDs, picks only `opanel_<id>_test` / `_e2e_test` with an unknown `<id>`; never the defaults, never a name not ending in `_test` | 6                |
| 7   | integration      | `ensureTestDatabase` creates a missing `opanel_<random>_test`, a second call is a no-op, a name not ending in `_test` is refused; the drop function drops it and refuses other names        | 2, 6             |
| 8   | integration      | `ensureRuntimeTestRole` called twice at once (two connections) does not throw                                                                                                               | 2                |
| 9   | manual, recorded | two worktrees at once (below)                                                                                                                                                               | 4                |
| 10  | gate             | the full gate in this worktree (with an ID) and CI on the PR (no ID: today's names and ports)                                                                                               | 5, 7             |

**Test 9, two worktrees at once.** From this branch, `git worktree add` a second, temporary
worktree and install it. In it only, add a throwaway table to the Drizzle schema and run
`pnpm db:generate` (never committed). Then:

1. start `pnpm test` in both worktrees at the same moment (two background shells); both
   pass;
2. the same with `pnpm test:e2e`; both pass, each on its own port (printed by the run);
3. `psql \dt` in each worktree's integration and end-to-end databases: the throwaway table
   exists only in the second worktree's;
4. remove the second worktree, run `pnpm test:db:drop --stale --yes` here: its two
   databases are dropped and this worktree's are kept.

The commands and their output go in the implementation record. This is not automated:
a test that runs the whole gate twice inside the gate would double CI time and could not
run in CI's single checkout anyway.

## Risks and open questions

**Questions for the owner** (each with my recommendation):

1. **Ports.** The WI says two worktrees "never" pick the same port. A port from the hash
   collides for about 1 pair in 1000, and a collision then fails at once with a message
   naming `E2E_PORT`. A collision-free choice needs a registry of slots shared by every
   worktree (a file in the Git common directory, with a lock, freed by
   `test:db:drop`): more code and more ways to go wrong. **Recommended: the hash plus the
   fail-fast check**, and the criterion reads "practically never; a collision stops with
   a message naming the variable".
2. **The `.next` directory (WI question 2).** **Recommended: no separate `distDir`**
   (section 6): Next.js 16 already separates dev and build, and the change would rewrite
   `tsconfig.json`.
3. **`01-create-test-db.sql` (WI question 3).** **Recommended: keep it**, comment
   updated.
4. **Maintenance database.** `postgres` instead of `opanel` for the `create database`
   connection (section 3). **Recommended: `postgres`**, present on every server.

**Risks.**

- Roles are cluster-wide. A branch whose migration changes `opanel_app` itself (not its
  grants) changes it for every worktree. Rare; such a migration is reviewed with care
  anyway.
- A moved worktree folder gets a new ID and new databases; the old ones are left until
  `--stale`. Disk use only.
- Two runs whose ports collide and that start within the same few seconds both pass the
  check, and the second `next start` fails with Node's `EADDRINUSE` instead of the message
  of section 4. Still a failure, not a wrong result.
- Every worktree migrates its databases from zero on its first run: a few seconds more,
  once.
