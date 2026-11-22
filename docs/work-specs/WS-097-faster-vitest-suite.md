# WS-097 — A faster unit and integration suite

- Status: Approved (approved by the owner on 2026-11-22, questions 1 to 6 as proposed)
- Work-item: [WI-097](../work-items/WI-097-faster-vitest-suite.md)
- Canonical docs: none changes (test infrastructure only). `AGENTS.md` section 5 and
  `CONTRIBUTING.md` "Local database" describe the result.

## Approach

Nothing a test checks changes. Four changes to how the suite runs, each measured on its own
(section "Measurements"):

1. **Unit tests run in Node unless they need a DOM.** The `unit` project splits in two:
   - `unit`: `environment: "node"`, for `src/**/*.test.ts` and `scripts/**/*.test.ts`.
     Measured on 2026-11-22: these 68 files take 17 s in Node against 65 s in jsdom.
   - `ui`: `environment: "jsdom"`, for `src/**/*.test.tsx` and the `.ts` files that need a
     DOM, today `src/components/board/keyboard.test.ts` alone (listed by name in
     `vitest.config.ts`, so a new one is a deliberate choice).
   - `vitest.setup.ts` splits the same way: `vitest.setup.ts` keeps what both need
     (`loadEnvFiles()`), and `vitest.setup.dom.ts` takes jest-dom, Testing Library's
     `cleanup`, the `EventSource` fake and the jsdom polyfills.
   - `pnpm test:unit` runs both projects (`--project unit --project ui`).
   - The `ui` project then tries `pool: "vmThreads"`, which builds jsdom once per worker
     instead of once per file (the Vitest 5.1 types: `isolate` "has no effect on vmThreads
     pool"). It is kept only if it saves at least 20% of that project's time and the
     project passes with `--sequence.shuffle`; otherwise the project stays on the default
     pool and the measurement is recorded.
2. **Integration files run in parallel, each worker on its own database.**
   - The global setup migrates the test database as today, then uses it as a template:
     for each worker `n` from 1 to `maxWorkers` it drops and creates
     `<name>_w<n>_test` (`opanel_w1_test`, or `opanel_3f9a07c2_w1_test` in a worktree)
     `template <name>`. Migrations run once per run; every worker starts from the
     current schema, never from a stale copy. Its teardown drops them again.
   - Each worker's setup file points `DATABASE_URL` at `<name>_w<VITEST_POOL_ID>_test`
     before anything reads the environment, as `applyWorktreeTestDatabase` does today.
     The new names end in `_test`, so `assertTestDatabaseUrl` guards them unchanged, and
     the new helper refuses a pool ID that is not a positive integer.
   - `maxWorkers: 4` for the integration project, locally and in CI (question 2): several
     worktrees may run at once (WS-054 chose 4 for the end-to-end suite for the same
     reason), and a fixed number fixes how many databases the setup creates. CI's runner
     has 4 vCPUs.
   - `fileParallelism: false` goes.
3. **`resetDatabase` deletes instead of truncating, from a list read once.**
   - The list of tables is read from `pg_tables` on the first reset in a worker's module
     instance and kept (once per file with Vitest's per-file isolation, against once per
     test today).
   - The reset is one transaction: `set local session_replication_role = replica`, then
     `delete from` each table. The replica role turns off triggers, so the append-only
     triggers (`audit_log`, `task_events`, `comments`, `bug_reports`) and the foreign-key
     checks do not apply and the order of the deletes does not matter. `set local` ends
     with the transaction. Measured on 2026-11-22: 4 to 60 ms per reset against 100 to
     290 ms for `truncate ... restart identity cascade`; there are no sequences in
     `public`, so `restart identity` did nothing.
   - This needs a superuser (question 3). The test owner `opanel` is one: it is
     `POSTGRES_USER` in `compose.yaml`, which CI uses too. Without one the reset fails
     with PostgreSQL's permission error, which names the setting.
4. **Cheaper writes and hashes in tests only.**
   - Each worker database gets `alter database ... set synchronous_commit = off` (question
     4). A crash can lose the last few commits of a test database, never corrupt it, and
     the development database `opanel` and `compose.yaml` keep their settings. `fsync`
     stays on: turning it off server-wide could corrupt the development database.
   - `createTestAccount` without its own password reuses one hash of `TEST_PASSWORD`,
     computed with `hashPassword` on first use in the module instance. A test that passes
     its own password still gets a fresh hash. The tests of `password.ts` and of sign-in
     call `hashPassword` and Better Auth directly and keep the production cost.

Also fixed, because parallel workers expose it: `waitForAdvisoryLockWaiter` counts waiting
advisory locks across the whole server (`pg_locks`). With several databases busy at once, a
waiter in another worker's database would satisfy it. It now counts only those of
`current_database()`. The two queries on `pg_stat_activity` already filter on
`datname = current_database()`.

`pnpm test:db:drop --stale` keeps working: a worker database left behind by a run that
crashed, such as `opanel_3f9a07c2_w2_test`, is listed with its worktree's databases when
that worktree is gone, and `pnpm test:db:drop` drops this checkout's worker databases with
its own two. A main-checkout worker database (`opanel_w1_test`) reads, to the stale
listing, like the database of a worktree whose ID is `w1`, so it is listed as stale unless
such a worktree exists. That is harmless: worker databases are recreated on every run, and
a database in use is never dropped.

## Files

| Path                                          | Change                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| `vitest.config.ts`                            | modify: `unit` (node) and `ui` (jsdom) projects; integration in parallel |
| `vitest.setup.ts`                             | modify: what both unit projects need                                     |
| `vitest.setup.dom.ts`                         | create: the DOM-only setup, moved from `vitest.setup.ts`                 |
| `vitest.integration.global.ts`                | modify: worker databases from the template; teardown drops them          |
| `vitest.integration.setup.ts`                 | modify: points the worker at its database                                |
| `src/server/db/testing.ts`                    | modify: `workerDatabaseUrl`, worker databases, the new reset             |
| `src/server/db/testing.test.ts`               | create (or extend): `workerDatabaseUrl`                                  |
| `src/server/db/testing.integration.test.ts`   | modify: worker databases, reset                                          |
| `src/server/db/worktree.ts`                   | modify: the stale listing knows worker databases                         |
| `src/server/db/worktree.test.ts`              | modify: the stale listing                                                |
| `scripts/drop-test-databases.ts`              | modify: drops this checkout's worker databases too                       |
| `src/server/auth/testing.ts`                  | modify: the shared hash; `waitForAdvisoryLockWaiter` per database        |
| `src/server/auth/testing.integration.test.ts` | create: the shared hash and the advisory-lock waiter                     |
| `scripts/vitest-config.test.ts`               | create: the projects' environments, files and workers                    |
| `package.json`                                | modify: `test:unit` runs `unit` and `ui`                                 |
| `AGENTS.md`, `CONTRIBUTING.md`                | modify: the projects and the worker databases                            |

## Data model changes

None.

## API contract

None.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                   | Covers criterion |
| --- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit        | `vitest.config.ts`: `unit` is node and holds no `.tsx`; `ui` is jsdom and holds the `.tsx` files and `keyboard.test.ts`; integration has file parallelism, 4 workers   | 1, 2             |
| 2   | unit        | `workerDatabaseUrl`: `opanel_test` and pool 2 give `opanel_w2_test`; a worktree name keeps its ID; pool `0`, `x` or missing throw; the name still ends in `_test`      | 2                |
| 3   | unit        | stale listing: `opanel_<gone>_w2_test` is stale, `opanel_<live>_w2_test` is not                                                                                        | 2                |
| 4   | integration | worker databases: created from the template with its tables and migrations table, `synchronous_commit` off, a stale one replaced, dropped again by the teardown helper | 2                |
| 5   | integration | `resetDatabase` empties every table, the append-only ones and those with foreign keys included, and leaves `session_replication_role` as it was                        | 3                |
| 6   | integration | `resetDatabase` reads `pg_tables` once: the second reset in a file runs no catalog query                                                                               | 3                |
| 7   | integration | `createTestAccount`: two default accounts share one hash that verifies `TEST_PASSWORD`; an account with its own password gets its own hash                             | 4                |
| 8   | integration | `waitForAdvisoryLockWaiter` does not count a waiter in another database                                                                                                | 2                |
| 9   | manual      | `pnpm test:unit -- --sequence.shuffle` and `pnpm test:integration -- --sequence.shuffle` pass                                                                          | 1, 2             |
| 10  | manual      | times before and after on the same machine, recorded below; CI's "Unit and integration tests" job before and after                                                     | 5, 6             |

## Measurements

Before, on `main` at `20f93b2` (2026-11-22, the owner's 12-core Windows 11 machine,
otherwise idle, Compose PostgreSQL on port 5433), wall time of `vitest run --project ...`:

| Project       | Wall  | Vitest's own report                                                       |
| ------------- | ----- | ------------------------------------------------------------------------- |
| `unit`        | 92 s  | 82.6 s; "jsdom was created 96 times · 396.48s total, 48% of tracked time" |
| `integration` | 397 s | 395.4 s; 92 files, 755 tests, one file at a time                          |

The 40% target therefore means at most 55 s for `pnpm test:unit` and at most 238 s for
`pnpm test:integration`, on this machine. After: recorded at implementation, with CI's
"Unit and integration tests" job (3 min 34 s and 2 min 51 s in the last two runs of
WI-103).

## Risks and open questions

1. **`vmThreads` for the `ui` project.** Proposed: try it after the split and keep it only
   on the measured gain above. The `unit` project stays on the default pool.
2. **Integration workers.** Proposed: a fixed 4, locally and in CI.
3. **`session_replication_role` needs a superuser.** Proposed: accept it for the test
   owner, which is one locally and in CI. The alternative, disabling the user triggers of
   four tables around every reset, takes exclusive locks and is slower.
4. **`synchronous_commit`.** Proposed: off on the worker databases only, as above;
   `fsync` untouched.
5. **Target.** WI-097 proposes at least 40% faster for `pnpm test:unit` and
   `pnpm test:integration` each. Proposed: keep it (at most 55 s and 238 s here). The
   measurements suggest more: most of the unit time is jsdom built for `.ts` files that
   do not need it, and integration runs on 4 workers.
6. **Memory.** Four integration workers, each with its own connection pool, on one
   PostgreSQL. If CI's runner shows pressure, the worker count is the knob.
