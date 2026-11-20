# WI-096 — Parallel work-items merge without renumbering or index conflicts

- Status: Draft
- Work-track: none: a development-flow item from the review of 2026-11-20 (findings D02,
  D03 and D04)
- Depends on: none
- Work-spec: WS-096 (once written)

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
- [ ] "Where the project stands" in `docs/README.md` holds only what a new session needs
      to start: what is in progress (item and branch), what is next, and open owner
      approvals; it no longer lists every finished item. The status of each item stays in
      the work-items table, which remains the single record.
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

Questions for the owner:

1. **How to reserve a number.** Options:
   - (a) A one-line commit to `main` that adds the item's row to the table with status
     `Draft`, before the branch is created. Cheap, conflicts are one line, but needs
     direct pushes to `main` or a tiny pull request.
   - (b) Drafts use a slug (`WI-draft-<slug>`) and get their number when the pull request
     merges. No reservation step, but every merge renames files again.
   - (c) Ranges per session or per work-track (for example WT-13 uses 130–139). No
     coordination, but numbers stop being in time order.
     Proposed: (a).
2. **Where the finished-items history goes.** Proposed: nowhere new. The table's statuses
   and `git log` already hold it, and any new history file would be the next hotspot.
3. **The CI schema check.** Strictly a quality-gate change; keep it here (proposed, it is
   one CI step) or as its own item.

Found by the development-flow review of 2026-11-20 (D02: numbering, D03: the index, D04:
generated files and the missing schema check). Files this item modifies include
`AGENTS.md`, `docs/README.md`, `CONTRIBUTING.md` and `.github/workflows/ci.yml`.
