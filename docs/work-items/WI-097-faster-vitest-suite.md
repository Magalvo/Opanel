# WI-097 — A faster unit and integration suite

- Status: Draft
- Work-track: none: a development-flow item from the review of 2026-11-20 (findings D05,
  D06 and D07)
- Depends on: WI-095 (its "create the database on demand" step, for the per-pool
  databases)
- Work-spec: WS-097 (once written)

## Outcome

`pnpm test` is the longest step of the local quality gate after the end-to-end tests,
and every session runs it before every merge. On 2026-11-20, on the owner's 12-core
Windows machine (with other sessions busy), `pnpm test:unit` took 141 s. The review found
three causes, none of which needs a test to change what it checks:

1. **The unit project builds a new jsdom for every file.** Vitest reported "jsdom was
   created 89 times · 556.82s total, 43% of tracked time" and suggested creating it once
   per worker (`pool: 'vmThreads'`, which keeps per-file isolation, or `isolate: false`).
2. **Integration files run one at a time.** `vitest.config.ts:34` sets
   `fileParallelism: false` because all 88 files (about 548 tests) share one database,
   and `resetDatabase` lists the tables from `pg_tables` before every test.
3. **Every test account hashes its password with Argon2id.** `createTestAccount`
   (`src/server/auth/testing.ts:42`) calls `hashPassword` at the production cost
   (19 MiB, two passes, `src/server/auth/password.ts:9-10`); there are 244 calls in the
   integration files, most of them with the same `TEST_PASSWORD`.

After this item the unit project shares its browser environment within a worker, the
integration project runs its files in parallel, each worker on its own database, and
test accounts reuse one precomputed hash, while every test keeps checking what it checks
today.

## Acceptance criteria

- [ ] The unit project no longer creates one jsdom per file (Vitest no longer prints the
      advice above), and no test depends on state another file left behind (the suite
      passes in random file order, for example with `--sequence.shuffle`).
- [ ] The integration project runs files in parallel: each Vitest worker uses its own
      database (for example `<name>_<VITEST_POOL_ID>`), created from a migrated template
      once per run, so migrations run once, not once per worker. The name guards still
      hold for every such database.
- [ ] `resetDatabase` no longer queries `pg_tables` before every test (the list is read
      once per worker), and still empties every table.
- [ ] `createTestAccount` with the default password reuses one hash computed once per
      worker; a test that passes its own password still gets a real hash, and the tests
      of `hashPassword` and of sign-in still run the production cost.
- [ ] Measured on the same machine, before and after, with the times recorded in the
      work-spec: `pnpm test:unit` and `pnpm test:integration` are each at least 40%
      faster. (Proposed target; the work-spec confirms it after measuring.)
- [ ] CI runs the same commands, and the full quality gate passes.

## Notes

Questions for the work-spec:

1. `vmThreads` or `isolate: false` for the unit project. `vmThreads` keeps module
   isolation but is known to use more memory; `isolate: false` is faster but lets module
   state leak between files. Read the installed Vitest 5 docs (`AGENTS.md` rule 13)
   before choosing. Proposed: `vmThreads` first.
2. How many integration workers locally: as many as Vitest picks, or a cap like the
   end-to-end one (WS-054), since several worktrees may run at once. Proposed: a cap of 4.

Not in this item, also found by the review (follow-ups): the 123 s `pnpm lint` (measure
the type-aware rules with `TIMING=1`, try `--cache`), and the end-to-end run's full
`next build` every time. Files this item modifies include `vitest.config.ts`,
`vitest.integration.global.ts`, `vitest.integration.setup.ts`,
`src/server/db/testing.ts` and `src/server/auth/testing.ts`.
