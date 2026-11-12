# WS-009 — Continuous integration

- Status: In progress (approved by the owner on 2026-11-12)
- Work-item: [WI-009](../work-items/WI-009-ci.md)
- Canonical docs: `AGENTS.md` sections 2 and 5

## Approach

One workflow, `.github/workflows/ci.yml`, with one job, `quality-gate`, on
`ubuntu-latest`. A single job keeps the run easy to read and avoids installing
dependencies several times; the whole gate takes about a minute locally. It can be split
into parallel jobs later if it becomes slow.

Steps:

1. Check out the code.
2. Install pnpm (version read from `packageManager` in `package.json`).
3. Install Node.js (version read from `.nvmrc`), with the pnpm store cached.
4. `pnpm install --frozen-lockfile` — fails if the lockfile does not match
   `package.json`.
5. `docker compose up -d --wait` — the same `compose.yaml` as local development, so CI and
   developers use an identical PostgreSQL with the same three databases.
6. `pnpm typecheck`, `pnpm lint`, `pnpm format:check`.
7. `pnpm test` — unit and integration. This includes the test that fails when
   `docs/api/openapi.json` is stale.
8. `pnpm exec playwright install --with-deps chromium`, then `pnpm test:e2e`.
9. On failure only: upload `playwright-report/` and `test-results/` as an artifact, kept
   for 7 days.

Other settings:

- **Triggers:** `pull_request` (any branch) and `push` to `main`. Pushes to other
  branches are covered by their pull request, which avoids running everything twice.
- **Concurrency:** one run per branch or pull request; a newer push cancels the older run.
- **Permissions:** `contents: read` only.
- **Timeout:** 15 minutes.
- **Environment:** `CI=true` is set by GitHub, which switches Playwright to one retry and
  the HTML report (already in `playwright.config.ts`). The app needs no secrets: the
  databases use the local defaults from `compose.yaml`.
- **Action versions:** official actions (`actions/checkout`, `actions/setup-node`,
  `actions/upload-artifact`, `pnpm/action-setup`) pinned to full commit hashes, with the
  version in a comment. Hashes cannot be moved the way tags can.

### Testing a workflow

A workflow cannot be run locally in a faithful way, so the "test" for this item is the run
on GitHub itself. The red step is deliberate: the first push includes a temporary failing
check (a formatting violation in a scratch file) to prove that a broken gate turns the run
red; the next commit removes it and the run must turn green.

## Files

| Path                       | Change                                            |
| -------------------------- | ------------------------------------------------- |
| `.github/workflows/ci.yml` | create                                            |
| `README.md`                | not in this item (WI-010 adds it, with the badge) |

No dependency changes.

## Data model changes

None.

## API contract

None.

## Test plan

| #   | Level            | Test                                                                                            | Covers criterion       |
| --- | ---------------- | ----------------------------------------------------------------------------------------------- | ---------------------- |
| 1   | local            | the workflow file is valid YAML and passes `actionlint` if it can be installed here             | well-formed            |
| 2   | GitHub, red      | a run with a deliberately mis-formatted file fails at `format:check` and skips later steps      | gate bites, fails fast |
| 3   | GitHub, green    | after removing it, the run passes every step                                                    | full gate on GitHub    |
| 4   | GitHub           | the run log shows Node.js 22, pnpm 10 and PostgreSQL 18                                         | versions from the repo |
| 5   | GitHub, optional | a failing end-to-end test produces a downloadable report artifact (checked once, then reverted) | artifacts              |

## Risks and open questions

1. **The workflow only runs on pull requests and on `main`.** To see it run on this
   working branch (tests 2 to 5) there has to be a pull request, or a temporary extra
   trigger for this branch. **Owner: may I open a draft pull request from this branch to
   `main` for that purpose?** There is no `main` branch on GitHub yet, so the alternative
   is a temporary `push` trigger for this branch, removed before the item is closed.
2. **Pushing a workflow file needs a specific GitHub permission.** If the Claude GitHub
   App is not allowed to write workflows, the push will be refused and I will tell you
   which permission to grant.
3. **Pinning actions to commit hashes** means updates are manual (or need a bot such as
   Dependabot later). Proposed anyway, as the safer default for a public project.
4. Docker Hub rate limits can occasionally fail the image pull on shared CI runners. If
   it becomes a problem, the image can be mirrored or cached.
