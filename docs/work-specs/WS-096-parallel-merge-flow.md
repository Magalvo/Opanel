# WS-096 — Parallel work-items merge without renumbering or index conflicts

- Status: Approved (approved by the owner on 2026-11-20, decisions 1 to 4 and risk 4 as
  proposed)
- Work-item: [WI-096](../work-items/WI-096-parallel-merge-flow.md)
- Canonical docs: `AGENTS.md` sections 4 (the spec-driven flow), 7 (definition of done)
  and 8 (Git conventions); `CONTRIBUTING.md` ("How a change is made"); the development-flow
  review of 2026-11-20, findings D02 to D04

Owner decisions taken on 2026-11-20, before this spec was written:

1. Numbers are reserved by a one-line commit on `main`, before the branch is created
   (WI-096 question 1, option a).
2. The finished-items history goes nowhere new: the docs themselves and `git log` hold it
   (question 2).
3. The CI schema check is part of this item (question 3).
4. A doc's status lives only in the doc's own `Status:` line; the index in
   `docs/README.md` lists links and titles, no status (asked while drafting this spec,
   because Git treats edits to neighbouring table rows as a conflict).

## Approach

### 1. Where things stand (checked on 2026-11-20, `main` at 7ac1f7b)

- `docs/README.md` (about 400 lines) holds the index and every doc's status twice: in the
  tables and in "Where the project stands", which lists every finished item as "Also
  finished" (about 110 lines). It changed in more than 230 commits.
- Every work-item branch edits it at least twice (its row's status, "Last finished"), and
  two branches that change neighbouring rows conflict even when each edits only its own
  row: WI-094 and WI-095 did on 2026-11-20.
- Numbers come from each session's own copy of the index, so parallel sessions pick the
  same one: WI-054, WI-093 (drafted as WI-092) and WI-094 (drafted as WI-093) were
  renumbered.
- Every doc already has its status in its own header: the 97 work-items, 94 work-specs
  and 9 work-tracks as `- Status: <word> (...)`, the 6 canonical docs as
  `- Status: **Approved** (...)`. All 206 agree with the index today (checked by a
  script on 2026-11-20).
- `main` is not protected (GitHub API, 2026-11-20), so the owner and the owner's sessions
  can push to it.
- `pnpm db:generate` runs `drizzle-kit generate` (0.31.11). With no schema change it
  writes nothing and prints "No schema changes, nothing to migrate". `drizzle-kit check`
  checks the journal and snapshots for collisions. `drizzle.config.ts` reads
  `DATABASE_URL` through `loadEnvFiles`, so in CI it runs with `NODE_ENV=test`, which
  loads `.env.test`; neither command connects to the database.
- `scripts/doc-checks.ts` and its tests (`operations-guide.test.ts`,
  `agents-guide.test.ts`) already keep two guides in step with the repository; the index
  check below follows the same pattern.

### 2. The rule: branches never edit `docs/README.md`

`docs/README.md` becomes a file that only **index commits** change: small, docs-only
commits pushed straight to `main`, each touching nothing but the index (and, for a
reservation, the new doc's stub). There are three kinds:

| Index commit                    | When                                                                     | Message                       |
| ------------------------------- | ------------------------------------------------------------------------ | ----------------------------- |
| Reserve a number                | Before a branch for a new WI, WT or canonical doc is created             | `docs: reserve WI-NNN (slug)` |
| Record a follow-up              | When a work-item finds a follow-up (also recorded in its work-spec)      | `docs: follow-up from WI-NNN` |
| Move "Where the project stands" | When a work-track is approved or done, or the owner changes what is next | `docs: next is ...`           |

A work-item branch then changes only its own files (its WI and WS, code, canonical docs),
so two branches meet only where they really touch the same code.

### 3. Reserving a number (`AGENTS.md` section 4, new step 2)

1. `git fetch origin`, then take the next free number from `origin/main`: one more than
   the highest in `docs/README.md` and in the file names of the directory.
2. On a checkout of `origin/main`, add the doc from its template with
   `Status: Draft` and its title, and its row in the index (link and title).
3. Commit (`docs: reserve WI-NNN (slug)`) and push to `main`. If the push is refused
   because `main` moved, fetch, rebase, take the number again, and retry: the refused
   push is what makes the reservation safe.
4. Create the branch from that commit, and fill the doc in there.

A work-spec takes its work-item's number and needs no reservation. A reserved number is
never reused or renamed, even if the item is dropped (its status becomes `Superseded`).
Outside contributors, who cannot push to `main`, propose a work-item in an issue or pull
request; the owner reserves the number (`CONTRIBUTING.md`).

### 4. The new `docs/README.md`

- **Where the project stands** keeps only what a new session needs to start: what is
  next, and decisions waiting for the owner. No "Last finished", no "Also finished", no
  "Approved on" entries: approvals are recorded in the approved doc's own status line, as
  they are today (`Done (approved by the owner on ...)`).
- **The four tables** keep their links and titles and lose every status column. The
  work-items table becomes `| Item | Title | Spec |`; the spec link is added by the
  reservation commit, before the work-spec exists (the link resolves once the work-spec
  merges). A note above the tables says where the statuses are and how to list them:
  `grep -m1 "^- Status:" docs/work-items/*.md`.
- **Follow-ups** stay as they are; new ones arrive by index commits.

Today's "Also finished" entries are deleted, not moved (decision 2). Every fact in them is
already in the item's own doc (its status, date and branch in "Implementation record").
The implementation checks that claim item by item before deleting, and moves any fact
found nowhere else into the item's own doc.

### 5. The index check (`scripts/docs-index.test.ts`)

A Vitest unit test, in the style of `operations-guide.test.ts`, with its logic in
`scripts/doc-checks.ts` so that it can be tested on small fixtures:

- every doc in the four directories (`_TEMPLATE.md` aside) has a `Status:` line whose
  first word (bold marks aside) is one of `Draft`, `Proposed`, `Approved`,
  `In progress`, `Done`, `Superseded`;
- every such doc has exactly one row in `docs/README.md`, and every row links to an
  existing doc, except a work-spec link whose work-item is `Draft` or `Proposed`;
- every work-spec has a work-item with the same number;
- no number is used twice in a directory, and file names match `NNNN-`, `WT-NN-`,
  `WI-NNN-`, `WS-NNN-`;
- the tables of `docs/README.md` have no status column.

The check catches a doc whose index row was forgotten and a number taken twice. It cannot
see a reservation that was skipped; the push rule does that.

### 6. After taking in `main` (`AGENTS.md` section 8)

New text: before a branch merges, it takes in `main` (rebase or merge), then:

- if it adds a migration and `main` gained one meanwhile, it deletes its own migration and
  snapshot and runs `pnpm db:generate` again, so the numbers follow `main`'s;
- runs `pnpm openapi:generate` if it changes the API;
- runs the full quality gate again on the result.

### 7. CI: migrations match the schema

A new step in the quality-gate job of `.github/workflows/ci.yml`, after "Format check":

```yaml
# The Drizzle schema and the committed migrations agree, and the journal has no
# collision (WS-096). Neither command connects to the database.
- name: Migrations match the schema
  env:
    NODE_ENV: test
  run: |
    pnpm exec drizzle-kit check
    pnpm db:generate
    git status --porcelain -- src/server/db/migrations
    test -z "$(git status --porcelain -- src/server/db/migrations)"
```

And a `pnpm db:check` script (`drizzle-kit check`) for local use, listed in `README.md`.

### Considered and not chosen

- **Numbers assigned at merge, ranges per work-track:** the owner chose reservation
  (decision 1).
- **A CI check that refuses a pull request that edits `docs/README.md`:** strict, but an
  index commit sometimes comes from a pull request (outside contributors, or `main`
  protected later). The rule and the index check are enough for now; revisit if branches
  keep editing the index.
- **A `merge=union` Git attribute on `docs/README.md`:** silently keeps both sides of a
  changed row, so a status change would leave two rows.
- **A generated index:** a script could write the tables from the docs' headers, but the
  file would then change on every branch again.

## Files

| Path                                                           | Change                                                                                                                                                                                   |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                                    | modify: section 4 (index commits, reserving a number, where statuses live), section 7 (definition of done: the doc's own status line, no index edit), section 8 (after taking in `main`) |
| `CONTRIBUTING.md`                                              | modify: "How a change is made" steps 2 and 6, and how outside contributors get a number                                                                                                  |
| `docs/README.md`                                               | modify: "Where the project stands" reduced to what is next and open decisions; status columns removed; a note on where statuses are                                                      |
| `docs/work-items/_TEMPLATE.md`, `docs/work-specs/_TEMPLATE.md` | modify: the statuses a doc can have, and where approval is recorded                                                                                                                      |
| `scripts/doc-checks.ts`                                        | modify: the index check (section 5)                                                                                                                                                      |
| `scripts/docs-index.test.ts`                                   | create                                                                                                                                                                                   |
| `.github/workflows/ci.yml`                                     | modify: the "Migrations match the schema" step                                                                                                                                           |
| `package.json`                                                 | modify: the `db:check` script                                                                                                                                                            |
| `README.md`                                                    | modify: `pnpm db:check` in the scripts table                                                                                                                                             |
| `docs/work-items/*`, `docs/work-tracks/*`                      | modify only if a fact from "Also finished" is found nowhere else (section 4)                                                                                                             |

## Data model changes

None.

## API contract

None.

## Test plan (written first, in this order)

| #   | Level  | Test                                                                                                                                                                                                                                                                                                                        | Covers criterion                               |
| --- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 1   | unit   | The index check, on fixtures: finds a doc with no row, a row with no doc, a status outside the list, a work-spec with no work-item, a number used twice, a file name in the wrong form, and a status column; finds nothing in a consistent fixture; allows a missing work-spec while its work-item is `Draft` or `Proposed` | "Where the project stands", every doc's status |
| 2   | unit   | The index check on this repository finds nothing (fails before section 4 is done: the tables have status columns)                                                                                                                                                                                                           | the same                                       |
| 3   | manual | On a scratch branch: change a column in the Drizzle schema without a migration, push, see the new CI step fail and name the migration it would write; then add the migration and see it pass. Recorded in "Implementation record"                                                                                           | the CI schema check                            |
| 4   | manual | Reserve a number from two checkouts at once (the second push is refused; after a rebase it takes the next number). Recorded in "Implementation record"                                                                                                                                                                      | reserving a number                             |
| 5   | gate   | `AGENTS.md` under 300 lines (`wc -l`), and the full quality gate                                                                                                                                                                                                                                                            | the remaining criteria                         |

The reservation flow and the `AGENTS.md` text are process, not code: tests 3 and 4 are
manual checks of the rule, run once and recorded.

## Risks and open questions

1. **Pushing to `main` directly.** It works today because `main` is not protected. If the
   owner protects it later, an index commit becomes a one-file pull request merged at
   once; the rule in `AGENTS.md` says so. Index commits are docs-only and CI still runs on
   them (`push: branches: [main]`), so `main` stays green.
2. **A session forgets to reserve.** Its branch then has a doc with no index row, which
   the index check fails in CI. The fix is a reservation commit, then a rebase.
3. **This work-item itself.** Its branch must edit `docs/README.md` to change the format,
   once; it is the last branch that does. Other branches open while it merges will
   conflict on the index one last time: merge this item when few branches are open, and
   say so in the pull request.
4. **A session needs to know what is in progress.** Today it reads "Last finished"; after
   this item it greps the status lines (the note in the index says how) or looks at open
   pull requests. Question for the owner: is that enough, or should "Where the project
   stands" keep a line per open branch? Proposed: enough, since that line would be the
   next conflict hotspot.
