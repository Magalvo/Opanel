# WI-095 — Parallel worktrees can run the quality gate at the same time

- Status: Done (2026-11-21; WS-095 approved by the owner the same day)
- Work-track: none: a development-flow item from the review of 2026-11-20 (finding D01)
- Depends on: none
- Work-spec: [WS-095](../work-specs/WS-095-worktree-test-isolation.md)

## Outcome

Several sessions now work on this repository at once, each in its own git worktree, and
each runs the quality gate before it merges. Today every worktree uses the same test
databases, the same port and the same Docker volume, so two runs at the same time break
each other:

- **Integration tests.** `.env.test:4` fixes `DATABASE_URL` to `opanel_test`, and
  `vitest.integration.setup.ts` empties every table before every test through
  `resetDatabase` (`src/server/db/testing.ts:22-38`). A second `pnpm test` empties the
  first one's data in the middle of its tests: random failures.
- **End-to-end tests.** `tests/e2e/environment.ts` fixes `E2E_PORT = 3100` and the
  database `opanel_e2e_test`; `tests/e2e/prepare.ts:43-45` truncates `accounts` and
  `rate_limits` at start-up. With `reuseExistingServer: false` the second run cannot start
  its server, and its `prepare` wipes the accounts the first run is using. The PostHog
  add-on's run (`addons/posthog/playwright.config.ts`) uses the same database and the same
  `prepare`, and builds into the same `.next`.
- **Migrations.** Every worktree migrates the same two databases. A branch that adds a
  migration changes the schema under every other branch, which then tests against tables
  it does not know.
- **The databases exist only once.** `docker/postgres/init/01-create-test-db.sql` creates
  them when the volume is first initialised, so no new name can be used without
  recreating the volume, which `docker compose down -v` does for every worktree at once.

After this item each worktree gets its own test databases and its own end-to-end ports,
created on demand, so any number of worktrees can run `pnpm test` and `pnpm test:e2e` at
the same time against the one PostgreSQL of `compose.yaml`. CI and a single checkout
behave as today. This also answers the follow-up "Let end-to-end runs choose their port
and database" (found in WI-072).

## Acceptance criteria

- [x] Each worktree derives a stable, short ID (from its path, or from an
      `OPANEL_WORKTREE` variable when set) and uses it in the names of its integration and
      end-to-end databases; every name still ends in `_test` and `_e2e_test`, and the
      existing name guards still refuse any other database.
- [x] The integration global setup and `tests/e2e/prepare.ts` create their database when
      it is missing (connecting as the owner to the `opanel` database), then migrate it
      as today; no `docker compose down -v` is ever needed for a new name, and the
      messages that suggest it are updated.
- [x] The end-to-end port of the app and of the PostHog add-on come from the same ID (or
      from `E2E_PORT` / the add-on's port variable when set); two worktrees never pick the
      same port, and a port that is taken fails with a message that names the variable.
      (Owner decision 1 of WS-095: "practically never". Ports come from the ID's hash,
      and a collision stops the run with that message.)
- [x] Two worktrees run `pnpm test` at the same time and both pass; the same for
      `pnpm test:e2e`; and one worktree's added migration does not reach the other's
      databases.
- [x] A single checkout with no variable set, and CI, run as today: same commands, no new
      setup step; `CONTRIBUTING.md` says how the names and ports are chosen and how to
      drop a worktree's databases.
- [x] Removing a worktree leaves at most its own databases behind, and a documented
      command (for example `pnpm test:db:drop`) drops them; it refuses any database whose
      name does not end in `_test`.
- [x] The full quality gate passes.

## Notes

Questions for the work-spec:

1. The ID: a hash of the worktree path (automatic, but changes if the folder moves) or a
   variable each session sets (explicit, but forgettable). Proposed: the hash, overridable.
2. The end-to-end build: also give each worktree's E2E run its own `distDir`, so it no
   longer overwrites the `.next` that `pnpm dev` uses? Proposed: yes, in this item, since
   the add-on's run shares it too.
3. Whether to keep `01-create-test-db.sql` for the default names or drop it now that the
   harnesses create their databases. Proposed: keep it, harmless.

Per-pool integration databases, which let integration files run in parallel, build on the
same "create on demand" step and are WI-097. Files this item modifies include
`.env.test`, `vitest.integration.global.ts`, `src/server/db/testing.ts`,
`tests/e2e/environment.ts`, `tests/e2e/prepare.ts`, `playwright.config.ts`,
`addons/posthog/playwright.config.ts`, `addons/posthog/e2e/environment.ts` and
`CONTRIBUTING.md`.
