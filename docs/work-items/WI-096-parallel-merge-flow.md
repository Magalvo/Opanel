# WI-096 — Parallel work-items merge without renumbering or index conflicts

- Status: In progress
- Work-track: none: a development-flow item from the review of 2026-11-20 (findings D02,
  D03 and D04)
- Depends on: none
- Work-spec: [WS-096](../work-specs/WS-096-parallel-merge-flow.md)

## Outcome

Work-items are now drafted and built by several sessions at once, and three things in the
workflow of `AGENTS.md` section 4 turn every parallel merge into extra work:

1. **Numbers collide.** Each session takes "the next free number" from its own copy of
   `docs/README.md`, so two branches pick the same one. It has happened at least three
   times: WI-054 was renumbered, the PostHog add-on was drafted as WI-092 and merged as
   WI-093, and the triage flow, drafted as WI-093, now commits as WI-094. Each rename
   touches the file names, every cross-reference and the commit messages, and the
   branch names no longer match their item.
2. **`docs/README.md` conflicts on every merge.** Every work-item edits the same lines:
   "Where the project stands" lists every finished item as "Also finished" (about 110
   lines today), and the file has changed in more than 230 commits. Branches then need a
   "merge main" commit and a "record the merge" commit for the docs alone.
3. **Generated files collide silently.** Two branches that each add migration `0019`, or
   each regenerate `docs/api/openapi.json` or `src/lib/openapi/contracts.ts`, conflict in
   `migrations/meta/_journal.json` and the snapshots, or merge cleanly into a state no
   branch tested. `AGENTS.md` says nothing about what to redo before merging.

After this item a work-item's number is fixed when it is drafted and never changes, the
docs index has no section that every work-item rewrites, and `AGENTS.md` says what a
branch regenerates and re-checks after taking in `main`. This is a docs-and-process item:
no application code changes.

## Acceptance criteria

- [ ] `AGENTS.md` section 4 says how a number is reserved before a branch starts (see
      question 1), and a number, once reserved, is never reused or renamed; the existing
      renumbered items keep their current numbers.
- [ ] Each doc's status lives only in its own `Status:` line. The index in
      `docs/README.md` lists links and titles, no status, and a work-item branch never
      edits it: index rows, follow-ups and "Where the project stands" change only by small
      commits on `main` (owner decision 4).
- [ ] "Where the project stands" holds only what a new session needs to start: what is
      next, and decisions waiting for the owner; it no longer lists finished items.
- [ ] A test fails when a doc has no index row or no valid `Status:` line, when a row
      points at no doc, or when a number is used twice.
- [ ] `AGENTS.md` section 4 (or section 8) says that after taking in `main` a branch
      regenerates its migration (`pnpm db:generate` on a renumbered base) and
      `docs/api/openapi.json`, and runs the full quality gate again, before merging.
- [ ] CI fails when the Drizzle schema needs a migration that is not committed (for
      example `drizzle-kit check`, or `drizzle-kit generate` producing no new file), so a
      bad merge of the journal is caught in the pull request.
- [ ] `AGENTS.md` stays under 300 lines, and its section 7 (definition of done) asks for
      the shorter "Where the project stands", not for a new "Also finished" entry.
- [ ] `pnpm format:check` passes (and the full quality gate, for the CI step).

## Notes

Owner decisions of 2026-11-20 (WS-096 records them):

1. Numbers are reserved by a one-line commit on `main` before the branch is created
   (option a; the others were a number given at merge, and ranges per work-track).
2. The finished-items history goes nowhere new: the docs and `git log` hold it.
3. The CI schema check is part of this item.
4. A doc's status lives only in its own `Status:` line, not in the index (asked while
   drafting WS-096: Git treats edits to neighbouring table rows as a conflict).

Found by the development-flow review of 2026-11-20 (D02: numbering, D03: the index, D04:
generated files and the missing schema check). Files this item modifies include
`AGENTS.md`, `docs/README.md`, `CONTRIBUTING.md` and `.github/workflows/ci.yml`.
