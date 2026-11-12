# WS-002 — ESLint and Prettier

- Status: Proposed (must be `Approved` by the owner before any code is written)
- Work-item: [WI-002](../work-items/WI-002-lint-and-format.md)
- Canonical docs: `AGENTS.md` sections 2, 5, 6

## Approach

ESLint with a flat config, built from three layers: the Next.js preset, typescript-eslint's
strict type-aware presets, and a few project rules that encode `AGENTS.md` hard rule 3.
Prettier owns all formatting; `eslint-config-prettier` switches off any ESLint rule that
would overlap.

Before writing the config, read the ESLint guide shipped with the installed Next.js
(`node_modules/next/dist/docs/`), since Next.js 16 removed `next lint` and changed how its
preset is consumed.

### TypeScript is downgraded from 7.0.2 to 6.0.3

`typescript-eslint` 8.72.2 (latest, including its canary) declares
`typescript: >=4.8.4 <6.1.0`. It does not support TypeScript 7, and type-aware linting
cannot work without it. This is the incompatibility anticipated in WS-001, and the owner
pre-approved the fallback.

The alternative, keeping TypeScript 7 for `tsc` and installing 6 only for ESLint, would
mean two compilers that can disagree about the same code. Rejected.

Returning to TypeScript 7 is added to the follow-ups in `docs/README.md`, to be picked up
when `typescript-eslint` supports it.

## Versions

Latest stable on 2026-11-12, pinned exactly.

| Package | Version | Kind |
| ------- | ------- | ---- |
| `typescript` | 6.0.3 (was 7.0.2) | dev |
| `eslint` | 10.14.0 | dev |
| `@eslint/js` | 10.0.1 | dev |
| `typescript-eslint` | 8.72.2 | dev |
| `eslint-config-next` | 16.4.6 | dev |
| `eslint-config-prettier` | 10.1.8 | dev |
| `eslint-plugin-simple-import-sort` | 14.0.0 | dev |
| `prettier` | 3.10.1 | dev |

## Files

| Path | Change |
| ---- | ------ |
| `package.json` | modify: TypeScript version, new dev dependencies, scripts |
| `pnpm-lock.yaml` | modify (generated) |
| `eslint.config.mjs` | create (see below) |
| `.prettierrc.json` | create: `{ "printWidth": 100 }`, otherwise Prettier defaults |
| `.prettierignore` | create: `pnpm-lock.yaml`, `.next`, `coverage`, `next-env.d.ts` |
| existing source, config and Markdown files | modify only where Prettier or the import-sort rule reformats them |

Scripts added:

```
lint          eslint . --max-warnings 0
lint:fix      eslint . --fix
format        prettier --write .
format:check  prettier --check .
```

### `eslint.config.mjs` contents

1. Global ignores: `.next`, `node_modules`, `coverage`, `next-env.d.ts`.
2. `eslint-config-next`: the `core-web-vitals` and `typescript` presets (React, React
   Hooks, accessibility and Next.js rules).
3. `typescript-eslint`: `strictTypeChecked` and `stylisticTypeChecked`, with
   `parserOptions.projectService` so rules can use type information.
4. Project rules, all at `error`:
   - `@typescript-eslint/no-explicit-any`
   - `@typescript-eslint/ban-ts-comment`: `@ts-ignore` banned; `@ts-expect-error` only
     with a description
   - `@typescript-eslint/no-floating-promises`, `@typescript-eslint/no-misused-promises`
   - `@typescript-eslint/consistent-type-imports`
   - `@typescript-eslint/no-unused-vars` (underscore-prefixed names exempt)
   - `eslint-comments`-style requirement that every `eslint-disable` carries a
     description, using ESLint's built-in `reportUnusedDisableDirectives` plus the
     `--report-unused-inline-configs` behaviour; if a description requirement needs a
     plugin, add `@eslint-community/eslint-plugin-eslint-comments` and record it here
   - `simple-import-sort/imports` and `simple-import-sort/exports`
   - `no-console` (allowing `warn` and `error`)
5. Type-aware rules disabled for plain JS config files (`*.mjs`).
6. `eslint-config-prettier` last.

Prettier formats Markdown too, so `docs/` and `AGENTS.md` are reformatted once
(table alignment and spacing only; `proseWrap` stays at the default `preserve`, so
paragraphs are not re-wrapped). The `AGENTS.md` change is whitespace-only.

## Data model changes

None.

## API contract

None.

## Test plan (in this order)

Lint and format rules are configuration, so the "failing test" for this item is the gate
itself failing on a known violation.

| # | Level | Test | Covers criterion |
| - | ----- | ---- | ---------------- |
| 1 | red | With the config in place and before any fixes, `pnpm lint` and `pnpm format:check` are run and their failures on the existing code recorded | gates detect real issues |
| 2 | green | Fix what they report; both pass | lint and format pass |
| 3 | manual, once each | Introduce an explicit `any`, a `@ts-ignore`, an unawaited promise, an unused variable, an undescribed `eslint-disable`; confirm each fails `pnpm lint` with the expected rule id; remove | hard rule 3 is enforced |
| 4 | manual, once | Mis-format a file; confirm `pnpm format:check` fails; restore | format gate bites |
| 5 | gate | `pnpm typecheck`, `pnpm test`, `pnpm build` pass on TypeScript 6.0.3 | nothing regressed |

## Risks and open questions

1. `eslint-config-next` 16.4.6 declares `eslint >=9`, and its bundled plugins
   (`eslint-plugin-react`, `eslint-plugin-import`, `eslint-plugin-jsx-a11y`) may lag
   behind ESLint 10. If any of them fails on ESLint 10, fall back to the latest ESLint 9
   and record it here. **Owner: is that fallback acceptable without a new approval round,
   as with TypeScript?**
2. `strictTypeChecked` is the strictest typescript-eslint preset. Individual rules that
   prove noisy can be relaxed later by a spec change; it is proposed on from day one for
   the same reason as the strict compiler flags.
