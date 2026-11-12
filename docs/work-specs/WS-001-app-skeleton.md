# WS-001 — App skeleton: Next.js, strict TypeScript, Vitest

- Status: Proposed (must be `Approved` by the owner before any code is written)
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

| Package | Version | Kind |
| ------- | ------- | ---- |
| `next` | 16.4.6 | dependency |
| `react`, `react-dom` | 19.3.1 | dependency |
| `typescript` | 7.0.2 | dev |
| `@types/react`, `@types/react-dom` | 19.3.0 | dev |
| `@types/node` | latest 22.x | dev |
| `vitest` | 5.1.0 | dev |
| `@vitejs/plugin-react` | 6.3.0 | dev |
| `@testing-library/react` | 16.3.3 | dev |
| `@testing-library/jest-dom` | 7.0.1 | dev |
| `jsdom` | 31.0.0 | dev |

Runtime: Node.js 22 (`engines.node: ">=22"`, `.nvmrc`: `22`). pnpm 10, pinned through the
`packageManager` field.

## Files

| Path | Change |
| ---- | ------ |
| `package.json` | create: name `opanel`, `private`, `"type": "module"`, scripts, pinned deps, `engines`, `packageManager` |
| `pnpm-lock.yaml` | create (generated) |
| `.nvmrc` | create: `22` |
| `.gitignore` | create: `node_modules`, `.next`, `out`, `coverage`, `.env*` (except `.env.example`), `*.tsbuildinfo`, `next-env.d.ts`, Playwright output dirs |
| `tsconfig.json` | create (see below) |
| `next.config.ts` | create: `reactStrictMode: true`, `typedRoutes: true`, nothing else |
| `vitest.config.ts` | create: React plugin, `jsdom` environment, `@/*` alias, setup file, include `src/**/*.test.{ts,tsx}` |
| `vitest.setup.ts` | create: registers `@testing-library/jest-dom` matchers and RTL cleanup |
| `src/app/layout.tsx` | create: root layout, `<html lang="en">`, metadata title "Opanel" |
| `src/app/page.tsx` | create: `<main>` with `<h1>Opanel</h1>` and a one-line tagline |
| `src/app/page.test.tsx` | create: the first test |

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

| # | Level | Test | Covers criterion |
| - | ----- | ---- | ---------------- |
| 1 | unit (Vitest + RTL) | `page.test.tsx`: rendering the home page shows a level-1 heading with the text "Opanel" | `pnpm test` passes; home page shows heading |
| 2 | gate | `pnpm typecheck` passes | strict type-check |
| 3 | gate | `pnpm build` completes | build |
| 4 | manual, once | add a type error, confirm `pnpm typecheck` fails, remove it | guardrail actually bites |
| 5 | manual, once | `pnpm dev`, request `/`, confirm `200` and the heading in the HTML | dev server works |

Automated browser verification of the running app arrives with Playwright in WI-007.

## Risks and open questions

1. **TypeScript 7.** 7.0 is a new major (the native compiler). Next.js 16.4,
   `@vitejs/plugin-react` and, in WI-002, `typescript-eslint` must all support it. If any
   of them does not, fall back to the latest TypeScript 6.x or 5.x and record the change
   in this spec. **Owner: is that fallback acceptable without a new approval round?**
2. **Node.js 22 vs 24.** 22 is proposed because it is what the current development
   environment provides and Next.js requires `>=20.9`. Node 24 is the newer LTS line.
   **Owner: keep 22, or target 24?**
3. **pnpm 10 vs 12.** 10 is installed in the development environment; 12 is the latest.
   **Owner: keep 10, or pin 12?**
4. `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are stricter than most
   projects use and occasionally fight third-party types. They are far cheaper to enable
   on day one than later, so they are proposed on; they can be relaxed by a spec change.
