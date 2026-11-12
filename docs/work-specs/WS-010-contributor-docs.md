# WS-010 — Contributor docs: README and CONTRIBUTING

- Status: In progress (approved by the owner on 2026-11-12)
- Work-item: [WI-010](../work-items/WI-010-contributor-docs.md)
- Canonical docs: `AGENTS.md` sections 1, 4, 5 and 8

## Approach

Two Markdown files at the repository root, written for a human reader arriving from
GitHub. `AGENTS.md` remains the constitution; these files summarise and link to it, so a
rule is never stated in two places that can drift apart.

### `README.md`

1. **Title, one-paragraph description and CI badge.** The description is the purpose
   statement from `AGENTS.md` section 1. The badge points at the `CI` workflow on `main`.
2. **Status.** One honest sentence: the project is at the boilerplate stage; there are no
   accounts, boards or agents yet. Links to `docs/README.md` for the roadmap.
3. **Prerequisites.** Node.js 22 (`.nvmrc`), pnpm 10 (`packageManager`; `corepack enable`
   is the suggested way to get it), Docker with Compose.
4. **Getting started.** The exact sequence from the WT-01 exit criteria, plus the one step
   it leaves out:

   ```
   pnpm install
   cp .env.example .env
   docker compose up -d
   pnpm db:migrate
   pnpm dev
   ```

   Then where to look: `http://localhost:3000` and `/api/v1/health`.

5. **Commands.** A table of every `package.json` script, with the five quality gate
   commands marked.
6. **Project layout.** A short version of the tree in `AGENTS.md` section 3, with a link
   to the full one.
7. **Contributing and licence.** Links to `CONTRIBUTING.md`, `AGENTS.md` and `LICENSE`.

### `CONTRIBUTING.md`

1. **Before you start.** Read `AGENTS.md`; it applies to people and AI contributors alike.
2. **How a change happens.** The six-step flow (work-item, work-spec, owner approval, TDD,
   doc updates) in a few lines each, linking to `AGENTS.md` section 4 and to the templates.
3. **Tests.** The three levels and where each lives; integration tests use a real
   PostgreSQL and are never mocked; `pnpm exec playwright install chromium` before the
   first end-to-end run.
4. **Local database notes.** The three databases (`opanel`, `opanel_test`,
   `opanel_e2e_test`) and what each is for; `OPANEL_DB_PORT` when port 5432 is taken, and
   the matching `DATABASE_URL` change; `docker compose down -v` to reset.
5. **Quality gate and CI.** The five commands; CI runs the same five on every pull request.
6. **Commits and pull requests.** Conventional Commits with the work-item reference; one
   work-item per pull request; `main` stays green.

### Testing documentation

There is no application code here, so the red and green steps are checks on the documents:

- **Red:** before the files exist, a link check over `README.md` and `CONTRIBUTING.md`
  fails because they are missing, and the fresh-clone walkthrough has no instructions to
  follow.
- **Green:** the files exist, links resolve, and the walkthrough succeeds.

The walkthrough is done in a temporary clone of the branch in a scratch directory, with its
own Compose project name and database port, so it cannot touch the working copy or its
database volume. It is removed afterwards.

The link check is a one-off shell check, not a new dependency or a committed test (see
open question 2).

## Files

| Path              | Change                                                                |
| ----------------- | --------------------------------------------------------------------- |
| `README.md`       | create                                                                |
| `CONTRIBUTING.md` | create                                                                |
| `docs/README.md`  | modify: statuses; WT-01 marked `Done` if its exit criteria hold       |
| `docs/work-*`     | modify: statuses of WI-010, WS-010 and WT-01                          |
| `AGENTS.md`       | not changed (section 3 already lists the layout; owner-approved file) |

No dependency changes.

## Data model changes

None.

## API contract

None.

## Test plan (written first, in this order)

| #   | Level  | Test                                                                                                                  | Covers criterion           |
| --- | ------ | --------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 1   | local  | every relative link in both files points at a path that exists (fails first, while the files are missing)             | links resolve              |
| 2   | local  | fresh clone in a scratch directory, following the README literally, reaches `200` from `/api/v1/health` on `pnpm dev` | fresh clone to running app |
| 3   | local  | every key under `scripts` in `package.json` appears in the README commands table                                      | all scripts listed         |
| 4   | local  | the full quality gate passes, including `format:check` on the two new files                                           | formatting                 |
| 5   | GitHub | the pull request run is green, and the badge URL returns an image                                                     | badge                      |
| 6   | review | the owner reads both files; `CONTRIBUTING.md` contradicts nothing in `AGENTS.md`                                      | workflow explained         |

## Risks and open questions

1. **Which branch and pull request?** `AGENTS.md` rule 10 is one work-item per pull
   request, but so far every item has been committed to the single working branch, and
   pull request 1 (WI-009) is still an open draft from it. **Owner: should I (a) merge
   pull request 1 first and do WI-010 on a new branch from `main` (recommended), or (b)
   keep going on the current branch, so pull request 1 carries both items?** This proposal
   is committed locally and not pushed until you decide.
2. **Should the link and script checks become a committed test?** A small Vitest test
   could fail when a script is added without a README entry or a link breaks. Proposed
   answer: no for now — it is extra code to maintain for two files; reconsider if the docs
   drift.
3. **The badge shows "no status" until `main` has a run.** The `push` trigger on `main`
   first fires when pull request 1 is merged. Under option (b) above the badge would be
   grey until then.
4. **Default branch.** The repository's default branch on GitHub is still the working
   branch, so visitors would not see the README on `main` first. Changing it is a GitHub
   setting only the owner can decide.
5. **`pnpm db:migrate` with no migrations.** There are no tables yet; the walkthrough
   confirms the command succeeds as a no-op rather than failing.
