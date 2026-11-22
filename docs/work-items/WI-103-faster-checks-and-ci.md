# WI-103 — Faster static checks, end-to-end build and CI

- Status: Done
- Work-track: none: a development-flow item, from the quality-gate review of 2026-11-22
  (it covers follow-up D12 of the review of 2026-11-20)
- Depends on: none. WI-097 speeds up `pnpm test`; this item covers the rest of the gate
  and the CI pipeline, and the two touch different files.
- Work-spec: [WS-103](../work-specs/WS-103-faster-checks-and-ci.md)

## Outcome

The quality gate takes less time, locally and in CI, without weakening any check:

- the three static checks (`typecheck`, `lint`, `format:check`) can be run together, in
  parallel, with one command;
- `pnpm typecheck` also checks the typed routes on a clean checkout, so the end-to-end
  build no longer needs to type-check the project a second time;
- CI runs the static checks, the Vitest suite and the end-to-end suite as parallel jobs,
  and still reports one "Quality gate" result.

Measured on 2026-11-22 (owner's 12-core Windows machine; CI run 45021616517 on `main`):
locally the three static checks take 25 + 66 + 17 s one after another, and the
end-to-end `next build` spends 21 of its 53 s re-running TypeScript. In CI the single
"Quality gate" job takes 8 min 39 s: 81 s of static checks, 4 min 9 s of `pnpm test`
and 2 min 28 s of `pnpm test:e2e`, in series.

## Acceptance criteria

- [ ] `pnpm check` runs `typecheck`, `lint` and `format:check` at the same time, prints
      each one's output as a block with its duration, and exits non-zero when any of
      them fails, naming it. Each of the three still runs on its own as before.
- [ ] `pnpm typecheck` generates the route types (`next typegen`) before `tsc`, so a link
      to a route that does not exist fails it on a fresh clone with no `.next` folder.
- [ ] The production build run by `pnpm test:e2e` skips Next.js's own TypeScript step;
      `pnpm build` and the image build still run it.
- [ ] `pnpm format:check` uses Prettier's content cache, and still fails on a file that
      is not formatted.
- [ ] CI runs three jobs in parallel (static checks with the migration check, Vitest,
      end-to-end) and a final job named "Quality gate" that fails unless all three
      succeeded. The add-ons and Windows format jobs are unchanged.
- [ ] Times before and after, measured on the same machine and in CI, are recorded in the
      work-spec. Proposed targets: `pnpm check` at most 70% of the three checks run one
      after another; the CI "Quality gate" result at most 60% of today's 8 min 39 s.
- [ ] `AGENTS.md` section 5 and `CONTRIBUTING.md` ("Quality gate") describe
      `pnpm check`; the full quality gate passes.

## Notes

Not in this item: the Vitest suite (WI-097) and ESLint's `--cache` (stale results with
type-aware rules, WS-103 question 2).
