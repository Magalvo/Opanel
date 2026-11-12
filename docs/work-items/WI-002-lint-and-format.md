# WI-002 — ESLint and Prettier

- Status: Proposed
- Work-track: [WT-01](../work-tracks/WT-01-project-boilerplate.md)
- Depends on: WI-001
- Work-spec: [WS-002](../work-specs/WS-002-lint-and-format.md)

## Outcome

`pnpm lint` and `pnpm format:check` exist, pass on the current code, and fail on the
violations that `AGENTS.md` hard rule 3 forbids. Two more of the five quality gate
commands become real.

## Acceptance criteria

- [ ] `pnpm lint` runs ESLint over the whole repository with zero warnings allowed, and
      passes.
- [ ] `pnpm format:check` runs Prettier in check mode and passes; `pnpm format` rewrites.
- [ ] Linting is type-aware (rules that need type information are active).
- [ ] Each of these, introduced by hand, makes `pnpm lint` fail (verified once, not
      committed): an explicit `any`; a `@ts-ignore` comment; an unawaited promise; an
      unused variable; an `eslint-disable` comment with no description.
- [ ] A mis-formatted file makes `pnpm format:check` fail (verified once, not committed).
- [ ] ESLint and Prettier do not conflict: formatting rules are owned by Prettier only.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` still pass.

## Notes

Git hooks (lint-staged, Husky) are not part of this item. CI enforcement is WI-009.
