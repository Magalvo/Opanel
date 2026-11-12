# WI-001 — App skeleton: Next.js, strict TypeScript, Vitest

- Status: Done
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

- [x] `pnpm install` succeeds from a clean clone with a committed lockfile.
- [x] `pnpm dev` serves a home page at `/` showing the heading "Opanel".
- [x] `pnpm build` completes without errors.
- [x] `pnpm typecheck` passes with `strict` and the extra strictness flags in WS-001.
- [x] `pnpm test` runs Vitest and passes, including a test asserting the home page
      renders the "Opanel" heading.
- [x] A deliberately introduced type error makes `pnpm typecheck` fail (verified once by
      hand, not committed).
- [x] Node and pnpm versions are pinned (`engines`, `packageManager`, `.nvmrc`).
- [x] `.gitignore` excludes `node_modules`, `.next`, env files and test output.

## Notes

Linting, formatting, env validation, database, E2E and styling are separate items
(WI-002 to WI-008) and must not be pulled into this one.
