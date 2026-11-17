# WI-052 — End-to-end tests do not deactivate each other's Admins

- Status: Done
- Work-track: none: a hardening item from the audit of 2026-11-17 (finding A09)
- Depends on: none (its branch is stacked on WI-051, for the status lines of the docs index)
- Work-spec: [WS-052](../work-specs/WS-052-e2e-admin-isolation.md)

## Outcome

The Playwright suite runs fully in parallel against one shared database. One test,
in `tests/e2e/accounts.spec.ts`, proves that the last active Admin cannot be demoted. To get
there it deactivates **every other Admin it can see**, including the Admins that
`accept-link.spec.ts` and `people.spec.ts` seed for themselves while they run. Those tests
then fail at random with `401` (seen in the audit's run and again on 2026-11-17 while
checking WI-051: `accept-link` failed at the reset-link step and passed alone).

After this item the test that needs to be the only Admin runs on its own, before every other
test that uses Admins, and the rest of the suite stays parallel. A failure in the
accept-link journey also names the status it received, instead of a Zod parse error.

## Acceptance criteria

- [x] The last-Admin check runs in its own Playwright project, after `first-run` and
      before `chromium`; it no longer shares a run window with any other test.
- [x] Every other test still runs in parallel (`fullyParallel` unchanged).
- [x] `accounts.spec.ts` keeps all its other checks (invite, list, role change, a
      deactivated person's next request is `401`), in the parallel project.
- [x] `accept-link.spec.ts` asserts the reset-link status (`201`) before parsing the body.
- [x] The Admin specs (`accept-link`, `accounts`, `people`, `last-admin`) pass in three
      full runs with the default workers and three with `--workers=4`, with no retries,
      on the same machine. (Narrowed by the owner on 2026-11-17 from "the full suite
      passes": other tests fail in parallel for reasons outside this item; see WS-052,
      "Deviations".)
- [x] The quality gate passes, apart from the end-to-end failures and the load timeout of
      `routes.test.ts` recorded in WS-052 and left to their own item.

## Notes

The last-Admin rule itself, including concurrency, is already covered by the integration
tests of `account-management`. This item only isolates the end-to-end journey that shows it.
Separate databases per worker were considered and not chosen (WS-052, question 1).
