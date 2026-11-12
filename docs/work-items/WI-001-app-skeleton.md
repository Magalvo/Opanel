# WI-001 — App skeleton: Next.js, strict TypeScript, Vitest

- Status: Proposed
- Work-track: [WT-01](../work-tracks/WT-01-project-boilerplate.md)
- Depends on: none
- Work-spec: [WS-001](../work-specs/WS-001-app-skeleton.md)

## Outcome

The repository contains a minimal Next.js app that boots, type-checks under strict
TypeScript, and has a working Vitest setup with its first passing test. This is the
smallest base on which every later item can follow Red, Green, Refactor.

The test runner is part of this item on purpose: without it, no later item could start
with a failing test.

## Acceptance criteria

- [ ] `pnpm install` succeeds from a clean clone with a committed lockfile.
- [ ] `pnpm dev` serves a home page at `/` showing the heading "Opanel".
- [ ] `pnpm build` completes without errors.
- [ ] `pnpm typecheck` passes with `strict` and the extra strictness flags in WS-001.
- [ ] `pnpm test` runs Vitest and passes, including a test asserting the home page
      renders the "Opanel" heading.
- [ ] A deliberately introduced type error makes `pnpm typecheck` fail (verified once by
      hand, not committed).
- [ ] Node and pnpm versions are pinned (`engines`, `packageManager`, `.nvmrc`).
- [ ] `.gitignore` excludes `node_modules`, `.next`, env files and test output.

## Notes

Linting, formatting, env validation, database, E2E and styling are separate items
(WI-002 to WI-008) and must not be pulled into this one.
