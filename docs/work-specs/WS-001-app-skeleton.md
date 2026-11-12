# WS-001 — App skeleton: Next.js, strict TypeScript, Vitest

- Status: Done (approved by the owner on 2026-11-12)
- Work-item: [WI-001](../work-items/WI-001-app-skeleton.md)
- Canonical docs: `AGENTS.md` sections 2, 3, 5

## Approach

Write the skeleton by hand rather than running `create-next-app`. The generator adds
files this item does not want yet (ESLint config, Tailwind, sample assets, its own agent
instruction files) and may refuse to run in a non-empty repository. A hand-written
skeleton is about eight small files, each of which is reviewable against this spec.

Order of work (TDD):

1. Tooling only: `package.json`, `tsconfig.json`, Vitest config, `.gitignore`, version
   pins. No application code. `pnpm install`.
2. **Red:** write `src/app/page.test.tsx`. It fails because `src/app/page.tsx` does not
   exist.
3. **Green:** add the minimal `layout.tsx` and `page.tsx`. Test passes.
4. **Refactor:** nothing expected at this size; confirm `typecheck`, `test`, `build`.

## Versions

Latest stable on the npm registry on 2026-11-12. Pinned exactly (no `^`) in
`package.json`; upgrades are deliberate changes.

| Package                            | Version     | Kind       |
| ---------------------------------- | ----------- | ---------- |
| `next`                             | 16.4.6      | dependency |
| `react`, `react-dom`               | 19.3.1      | dependency |
| `typescript`                       | 7.0.2       | dev        |
| `@types/react`, `@types/react-dom` | 19.3.0      | dev        |
| `@types/node`                      | latest 22.x | dev        |
| `vitest`                           | 5.1.0       | dev        |
| `@vitejs/plugin-react`             | 6.3.0       | dev        |
| `@testing-library/react`           | 16.3.3      | dev        |
| `@testing-library/jest-dom`        | 7.0.1       | dev        |
| `jsdom`                            | 31.0.0      | dev        |

Runtime: Node.js 22 (`engines.node: ">=22"`, `.nvmrc`: `22`). pnpm 10, pinned through the
`packageManager` field.

## Files

| Path                    | Change                                                                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`          | create: name `opanel`, `private`, `"type": "module"`, scripts, pinned deps, `engines`, `packageManager`                                       |
| `pnpm-lock.yaml`        | create (generated)                                                                                                                            |
| `.nvmrc`                | create: `22`                                                                                                                                  |
| `.gitignore`            | create: `node_modules`, `.next`, `out`, `coverage`, `.env*` (except `.env.example`), `*.tsbuildinfo`, `next-env.d.ts`, Playwright output dirs |
| `tsconfig.json`         | create (see below)                                                                                                                            |
| `next.config.ts`        | create: `reactStrictMode: true`, `typedRoutes: true`, nothing else                                                                            |
| `vitest.config.ts`      | create: React plugin, `jsdom` environment, `@/*` alias, setup file, include `src/**/*.test.{ts,tsx}`                                          |
| `vitest.setup.ts`       | create: registers `@testing-library/jest-dom` matchers and RTL cleanup                                                                        |
| `src/app/layout.tsx`    | create: root layout, `<html lang="en">`, metadata title "Opanel"                                                                              |
| `src/app/page.tsx`      | create: `<main>` with `<h1>Opanel</h1>` and a one-line tagline                                                                                |
| `src/app/page.test.tsx` | create: the first test                                                                                                                        |

Scripts in `package.json`:

```
dev        next dev
build      next build
start      next start
typecheck  tsc --noEmit
test       vitest run
test:watch vitest
```

`tsconfig.json` compiler options beyond the Next.js defaults:

```
strict: true
noUncheckedIndexedAccess: true
exactOptionalPropertyTypes: true
noImplicitOverride: true
noFallthroughCasesInSwitch: true
forceConsistentCasingInFileNames: true
paths: { "@/*": ["./src/*"] }
```

Only the directories that contain files are created. The rest of the layout in
`AGENTS.md` section 3 (`src/server`, `src/lib`, `src/components`, `tests/e2e`) appears
with the item that first needs it; no empty placeholder directories.

## Data model changes

None.

## API contract

None.

## Test plan (written first, in this order)

| #   | Level               | Test                                                                                    | Covers criterion                            |
| --- | ------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------- |
| 1   | unit (Vitest + RTL) | `page.test.tsx`: rendering the home page shows a level-1 heading with the text "Opanel" | `pnpm test` passes; home page shows heading |
| 2   | gate                | `pnpm typecheck` passes                                                                 | strict type-check                           |
| 3   | gate                | `pnpm build` completes                                                                  | build                                       |
| 4   | manual, once        | add a type error, confirm `pnpm typecheck` fails, remove it                             | guardrail actually bites                    |
| 5   | manual, once        | `pnpm dev`, request `/`, confirm `200` and the heading in the HTML                      | dev server works                            |

Automated browser verification of the running app arrives with Playwright in WI-007.

## Resolved questions

Decided with the owner on 2026-11-12:

1. **TypeScript 7:** falling back to 6.x or 5.x without a new approval round is allowed if
   tooling is incompatible. Not needed so far: Next.js 16.4.6, Vitest 5.1.0 and
   `@vitejs/plugin-react` 6.3.0 all work with TypeScript 7.0.2. `typescript-eslint`
   turned out not to support TypeScript 7, so WI-002 moved the project to 6.0.3 (see WS-002).
2. **Node.js:** 22 now; upgrade to 24 LTS tracked in `docs/README.md` (Follow-ups).
3. **pnpm:** 10 now; upgrade to 12 tracked in `docs/README.md` (Follow-ups).
4. `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are enabled.

## Deviations from the approved spec

1. **`next.config.ts` has one extra option, `agentRules: false`.** Next.js 16.4 `next dev`
   appends its own managed block to `AGENTS.md` and re-adds it when removed. `AGENTS.md`
   is the owner-approved constitution and must not be edited by a tool, so the feature is
   switched off. The block's advice (this Next.js version differs from what an AI
   contributor may remember; read the docs shipped in `node_modules/next/dist/docs/`
   before writing Next.js code) is sound and is proposed to the owner as a hard rule.
2. **`tsconfig.json` formatting and `include`.** `next build` rewrites the file on first
   run (expanded arrays, adds `.next/dev/types/**/*.ts` to `include`). The rewritten file
   is committed so the working tree stays clean.

## Implementation record

- Red: `src/app/page.test.tsx` failed with "Failed to resolve import ./page".
- Green: `layout.tsx` and `page.tsx` added; 1 test passing.
- `pnpm typecheck` and `pnpm build` pass, including from a clean checkout state.
- Manual: an injected type error failed `pnpm typecheck` (TS2322); `pnpm dev` served `/`
  with `200` and `<h1>Opanel</h1>`.
