# WS-052 — End-to-end tests do not deactivate each other's Admins

- Status: Done (approved by the owner on 2026-11-17, questions 1 to 5 as proposed;
  criterion 5 narrowed by the owner on 2026-11-17, see "Deviations")
- Work-item: [WI-052](../work-items/WI-052-e2e-admin-isolation.md)
- Canonical docs: [WS-007](WS-007-e2e.md) (Playwright), [WS-016](WS-016-first-run-setup.md)
  (the `first-run` project), [WS-018](WS-018-account-management-api.md) (the last-Admin
  rule); audit of 2026-11-17, finding A09

## Approach

### The cause

`playwright.config.ts` sets `fullyParallel: true` and has two projects: `first-run`
(`setup.spec.ts`, alone, on an empty database) and `chromium` (everything else, depending on
`first-run`). The end-to-end database is shared by all workers.

`accounts.spec.ts` has one test that, in the middle, reads the account list and deactivates
every other active Admin, so that it can show the `409 last_admin` refusal. Three other
places seed Admins and need them to stay active while they run:

| Spec                  | Admin used for                            |
| --------------------- | ----------------------------------------- |
| `accept-link.spec.ts` | inviting, then issuing a reset link (API) |
| `people.spec.ts`      | the People page journey (fixture `admin`) |
| `accounts.spec.ts`    | itself                                    |

When the deactivation lands while one of the others is running, that Admin's sessions end
and its next request is `401`. The reverse also happens: an Admin seeded after the list was
read makes the demotion succeed (`200` where `409` was expected). Which one fails depends
on timing.

### The fix

1. **Split the test.** `accounts.spec.ts` keeps the invite, list, role change and
   deactivate-a-signed-in-person checks; none of them needs to be the only Admin. The
   last-Admin part moves to a new `tests/e2e/last-admin.spec.ts`: seed an Admin, sign in,
   deactivate every other active Admin, then `409 last_admin` on demoting self. Same
   assertions as today, nothing dropped.
2. **Give it its own project**, between the two that exist:

   ```ts
   { name: "first-run", testMatch: "**/setup.spec.ts", ... },
   {
     name: "exclusive",
     testMatch: "**/last-admin.spec.ts",
     dependencies: ["first-run"],
     ...
   },
   {
     name: "chromium",
     testIgnore: ["**/setup.spec.ts", "**/last-admin.spec.ts"],
     dependencies: ["exclusive"],
     ...
   },
   ```

   Dependencies are "projects that need to run before any test in this project runs"
   (installed Playwright 1.63.0, `types/test.d.ts`), so nothing else
   runs while `exclusive` does, and Admins seeded later by `chromium` tests are never seen
   by it. A comment in the config states the rule: **a test that changes install-wide state
   that other tests rely on goes in `exclusive`.**

3. **A clear failure** in `accept-link.spec.ts`: assert `201` on the reset-link response
   before `resetLinkResponseSchema.parse`, so that a `401` reads as a `401`.

Cost: one test (a few seconds) moves onto the critical path. The other ~60 tests stay
parallel.

### Considered and not chosen

- **One database and app per worker** isolates everything, but each worker would need its
  own `next start` and migrated database: much slower and a larger config change, for one
  test. Kept as the option if more global tests appear (question 1).
- **`--workers=1` for the whole suite** hides the problem and makes the suite several times
  slower.
- **Dropping the end-to-end last-Admin step** would remove an assertion (hard rule 3).

### Out of scope

The parallel run of 2026-11-17 also failed once in `board.spec.ts` (keyboard move) and
`accessibility.spec.ts` (projects pages, light mode). Both use Member accounts, are not
affected by deactivated Admins, and passed when run alone. They are recorded as a
follow-up unless the repeated runs of this item show them again (question 3).

## Files

| Path                             | Change                                             |
| -------------------------------- | -------------------------------------------------- |
| `tests/e2e/last-admin.spec.ts`   | create: the last-Admin journey, moved              |
| `tests/e2e/accounts.spec.ts`     | modify: the last-Admin part removed, the rest kept |
| `tests/e2e/accept-link.spec.ts`  | modify: status assertion before the parse          |
| `playwright.config.ts`           | modify: the `exclusive` project and its comment    |
| `CONTRIBUTING.md`                | modify: one line on where install-wide tests go    |
| `docs/README.md`, WI-052, WS-052 | modify: statuses                                   |

No application code, no dependency, no migration.

## Data model changes

None.

## API contract

None.

## Test plan (written first, in this order)

This item changes tests, not behaviour, so "red" is the interference itself:

| #   | Level | Test                                                                                                                                                       | Covers criterion |
| --- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | e2e   | before any change: run the full suite repeatedly with no retries and record the `accept-link` (or `people`, or `accounts`) failures and their status codes | the cause        |
| 2   | e2e   | `last-admin.spec.ts`: the same assertions as the moved part (others deactivated, `409 last_admin` on self-demotion), passing in the `exclusive` project    | split, no loss   |
| 3   | e2e   | `accounts.spec.ts`: invite `201`, listed as invited, role change `200`, deactivated member's next request `401`                                            | rest kept        |
| 4   | e2e   | `accept-link.spec.ts`: reset-link status `201` asserted before parsing                                                                                     | clear failure    |
| 5   | e2e   | `npx playwright test --list` shows `last-admin` only under `exclusive` and `setup` only under `first-run`                                                  | project layout   |
| 6   | e2e   | full suite three times with default workers and three times with `--workers=4`, `--retries=0`; every run green                                             | no interference  |
| 7   | gate  | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`                                                                                                    | gate             |

## Risks and open questions

For the owner:

1. **A serial project rather than a database per worker.** It fixes the one known global
   test at the cost of a few seconds, and the rule in the config tells future authors where
   such tests go. **Recommend: the `exclusive` project; revisit per-worker databases only
   if `exclusive` grows past a handful of tests.**
2. **CI keeps `retries: 1`.** A retry can hide a flake like this one; but removing it is a
   separate decision about the whole suite. **Recommend: keep it, and validate this item
   with `--retries=0` locally (test 6).**
3. **The board and accessibility flakes.** If they show up in test 6, they are stopped
   and raised here, not fixed under this item. **Recommend: as proposed.**
4. **A failing `exclusive` test skips the `chromium` project**, as a failing `first-run`
   already does: Playwright does not run a project whose dependency failed. A broken
   last-Admin rule then shows as one failure and many skipped tests, not as many failures.
   **Recommend: accept; the report names the failing dependency.**
5. **The branch is stacked on WI-051** (PR #45), only for the docs index. Its pull request
   is opened once #45 is merged, or rebased. **Recommend: as proposed.**

## Deviations from the approved spec

**Acceptance criterion 5 (six green runs) was not met, for reasons outside this item.** As
question 3 says, the work stopped there for the owner, who on 2026-11-17 narrowed the
criterion to the Admin specs and closed this item; the other failures are a follow-up in
`docs/README.md`. In the six runs of test 6 no Admin
test failed, but these did, all with Member or Manager accounts:

| Test                                                     | Default workers | `--workers=4` |
| -------------------------------------------------------- | --------------- | ------------- |
| `board.spec.ts:172` keyboard move, drop announced        | 3 of 3          | 3 of 3        |
| `accessibility.spec.ts:59` projects pages, light mode    | 3 of 3          | 1 of 3        |
| `accessibility.spec.ts:59` projects pages, dark mode     | 3 of 3          | 0 of 3        |
| `task-detail`, `epics`, `projects`, `profile` (timeouts) | 1 to 4 per run  | 0 of 3        |

The keyboard move fails in every parallel run and passes alone (`--workers=1`,
2026-11-17); the others look like load on this machine (12 cores, so 6 default workers,
plus the production server and PostgreSQL), since they fail less with 4 workers.

## Implementation record

- Before (test 1): two parallel runs on 2026-11-17 with retries off. Run 1 failed
  `accept-link` with a `ZodError` at the reset-link step, as in the audit. Run 2's
  summary was cut off, so whether `accept-link` failed is not known.
- The change: `tests/e2e/last-admin.spec.ts` holds the last-Admin journey, with the same
  assertions; `accounts.spec.ts` keeps the rest; `accept-link.spec.ts` asserts `201`
  before parsing; `playwright.config.ts` has the `exclusive` project between `first-run`
  and `chromium`; `CONTRIBUTING.md` says where such tests go.
- `playwright test --list`: `setup` only under `first-run`, `last-admin` only under
  `exclusive`; 64 tests in 20 files.
- After (test 6): six full runs, `--retries=0`, three with default workers and three with
  `--workers=4`. `accept-link`, `accounts`, `people` and `last-admin` passed in all six.
  The other failures are under "Deviations".
- Typecheck, lint and Prettier on the changed files pass. Vitest: 1096 of 1097; the one
  failure is `routes.test.ts` "finds the route files" timing out at 5.08 s (limit 5 s)
  under full load, as during WI-051, where it passed alone and on a second run.
- Run on Windows with Node 24 and the pinned pnpm 10.28.0, against the Compose PostgreSQL
  on port 5433.
