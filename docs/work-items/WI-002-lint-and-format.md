# WI-002 — ESLint and Prettier

- Status: Done
- Work-track: [WT-01](../work-tracks/WT-01-project-boilerplate.md)
- Depends on: WI-001
- Work-spec: [WS-002](../work-specs/WS-002-lint-and-format.md)

## Outcome

`pnpm lint` and `pnpm format:check` exist, pass on the current code, and fail on the
violations that `AGENTS.md` hard rule 3 forbids. Two more of the five quality gate
commands become real.

## Acceptance criteria

- [x] `pnpm lint` runs ESLint over the whole repository with zero warnings allowed, and
      passes.
- [x] `pnpm format:check` runs Prettier in check mode and passes; `pnpm format` rewrites.
- [x] Linting is type-aware (rules that need type information are active).
- [x] Each of these, introduced by hand, makes `pnpm lint` fail (verified once, not
      committed): an explicit `any`; a `@ts-ignore` comment; an unawaited promise; an
      unused variable; an `eslint-disable` comment with no description.
- [x] A mis-formatted file makes `pnpm format:check` fail (verified once, not committed).
- [x] ESLint and Prettier do not conflict: formatting rules are owned by Prettier only.
- [x] `pnpm typecheck`, `pnpm test` and `pnpm build` still pass.

## Notes

Git hooks (lint-staged, Husky) are not part of this item. CI enforcement is WI-009.
