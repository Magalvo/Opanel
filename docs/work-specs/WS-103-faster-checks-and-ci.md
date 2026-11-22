# WS-103 — Faster static checks, end-to-end build and CI

- Status: Approved (approved by the owner on 2026-11-22, questions 1 to 4 as proposed)
- Work-item: [WI-103](../work-items/WI-103-faster-checks-and-ci.md)
- Canonical docs: `AGENTS.md` sections 5 (quality gate) and 6 (hard rules 3 and 4);
  `CONTRIBUTING.md` ("Quality gate"); WS-054 (end-to-end workers), WS-095 (worktree
  isolation), WS-096 (the CI migration check)

## Approach

### 1. Where things stand (measured on 2026-11-22, `main` at 6b6b14e)

Locally, on the owner's 12-core Windows machine, in a worktree:

| Step                         | Time                                       |
| ---------------------------- | ------------------------------------------ |
| `pnpm typecheck`             | 25 s cold, 8 s with `tsconfig.tsbuildinfo` |
| `pnpm lint`                  | 66 s (62 s again; 6 s with `--cache`)      |
| `pnpm format:check`          | 17 s (4 s with `--cache`)                  |
| `next build` (in `test:e2e`) | 53 s, of which "Running TypeScript" 21 s   |

`eslint --stats` shows 12 s of parsing and the rest in type-aware rules
(`no-unsafe-assignment`, `no-deprecated`, `no-floating-promises`, ...), most of which is
the type information built once by whichever rule asks first. No rule is removed by this
item (hard rule 3).

In CI (run 45021616517, `main`), the single "Quality gate" job took 8 min 39 s: install
2 s (pnpm store cached), typecheck 18 s, lint 49 s, format 14 s, migration check 2 s,
`pnpm test` 4 min 9 s, Playwright browser install 15 s, `pnpm test:e2e` 2 min 28 s, in
series.

Two facts found on the way:

- `tsconfig.json` includes `.next/types/**/*.ts`, and `typedRoutes` is on. On a fresh
  clone (and in CI) `pnpm typecheck` runs before any build, so the route types do not
  exist and **typed routes are only checked by `next build`**. Next.js 16.4 has
  `next typegen`, which writes them without a build (0.9 s here;
  `node_modules/next/dist/docs/01-app/03-api-reference/06-cli/next.md`).
- `next build` type-checks unless `typescript.ignoreBuildErrors` is set
  (`.../05-config/01-next-config-js/typescript.md`). Once `pnpm typecheck` covers the
  route types, the check inside the end-to-end build repeats work the gate has just done.

### 2. `pnpm check`: the three static checks in parallel

A new script, `scripts/check.ts`, run by `"check": "tsx scripts/check.ts"`. It starts
`node --run typecheck`, `node --run lint` and `node --run format:check` at once, buffers
each one's output, and prints, as each finishes, a block headed with its name, exit code
and duration. It exits 1 if any failed, with a last line naming the failed checks.

The scheduling and the report are a pure function, `runChecks(names, run)`, where `run`
starts one script and resolves to `{ code, output, ms }`; the script wires it to
`child_process.spawn(process.execPath, ["--run", name])`. No new dependency.

The three scripts stay as they are, so CI and a contributor can still run one alone.
The gate in `AGENTS.md` section 5 becomes:

```
pnpm check        # typecheck, lint and format:check, in parallel
pnpm test         # Vitest unit + integration
pnpm test:e2e     # Playwright
```

with a line saying `pnpm check` is exactly the first three of the five commands, each
of which can still be run alone.

### 3. `pnpm typecheck` checks the typed routes

`"typecheck": "next typegen && tsc --noEmit && tsc -p mcp --noEmit"`. This also removes
the stale-`RouteImpl` advice in `CONTRIBUTING.md` ("delete the `.next` directory"):
`next typegen` rewrites the route types every time. To check before relying on it: that
`next typegen` needs no database and no env file (it ran here without either).

### 4. The end-to-end build skips the repeated TypeScript step

`next.config.ts` sets `typescript.ignoreBuildErrors` only when
`OPANEL_BUILD_SKIP_TYPECHECK` is `"1"`. The variable is read through a small function,
`buildSkipsTypecheck(env)` in `scripts/build-options.ts`, which validates it with Zod
(`z.enum(["1"]).optional()`; any other value is an error, hard rule 4). The Playwright
`webServer.env` sets it; `pnpm build`, the `Dockerfile` and the image workflow do not, so
they keep Next.js's check. Saves about 21 s per end-to-end run.

### 5. Prettier's cache

`"format:check": "prettier --check . --cache --cache-strategy content"`. The cache lives
in `node_modules/.cache/prettier` (already ignored) and is keyed on file content, Prettier
version and options, so a stale cache cannot hide an unformatted file. CI starts without
it, so nothing changes there. `format` gets the same flags.

### 6. CI: three parallel jobs and one result

`.github/workflows/ci.yml`, job `quality-gate` split into:

| Job (name)     | Steps after checkout, pnpm, Node and install                                     |
| -------------- | -------------------------------------------------------------------------------- |
| `static`       | typecheck, lint, format check, migrations match the schema                       |
| `vitest`       | start PostgreSQL, `pnpm test`                                                    |
| `e2e`          | start PostgreSQL, install Chromium, `pnpm test:e2e`, upload on failure           |
| `quality-gate` | `needs: [static, vitest, e2e]`, `if: always()`, fails unless all three succeeded |

The last job keeps the name "Quality gate", so a future required status check (`main` is
not protected today) and anyone reading the PR still see one result. Each split job pays
its own install (2 s with the cached store) and checkout; the wall time becomes the
slowest job, today Vitest (about 4.5 min), and the end-to-end job once WI-097 lands.
`timeout-minutes` stays 15 per job. The add-ons and Windows format jobs do not change.

Not added: a Playwright browser cache (the install is 15 s, and a cache action would be
one more pinned action to maintain).

## Files

| Path                            | Change                                                        |
| ------------------------------- | ------------------------------------------------------------- |
| `scripts/check.ts`              | create: `runChecks` and the command                           |
| `scripts/check.test.ts`         | create                                                        |
| `scripts/build-options.ts`      | create: `buildSkipsTypecheck`                                 |
| `scripts/build-options.test.ts` | create                                                        |
| `package.json`                  | modify: `check`, `typecheck`, `format`, `format:check`        |
| `next.config.ts`                | modify: `typescript.ignoreBuildErrors` from the flag          |
| `playwright.config.ts`          | modify: `OPANEL_BUILD_SKIP_TYPECHECK: "1"` in `webServer.env` |
| `.github/workflows/ci.yml`      | modify: section 6                                             |
| `AGENTS.md`                     | modify: section 5, the gate (owner approval by this spec)     |
| `CONTRIBUTING.md`               | modify: "Quality gate"                                        |
| WI-103, WS-103                  | modify: statuses, measurements after                          |

## Data model changes

None.

## API contract

None.

## Test plan (written first, in this order)

| #   | Level  | Test                                                                                                  | Covers criterion |
| --- | ------ | ----------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit   | `runChecks` starts every check before any finishes (the runner sees all three calls at once)          | 1                |
| 2   | unit   | `runChecks` prints each check's output as one block, with its name, exit code and duration            | 1                |
| 3   | unit   | `runChecks` returns exit 1 and names the failed checks when one fails; 0 when all pass                | 1                |
| 4   | unit   | every name `pnpm check` runs is a script in `package.json`                                            | 1                |
| 5   | unit   | `buildSkipsTypecheck`: true for `"1"`, false when unset, throws for any other value                   | 3                |
| 6   | manual | on a copy with no `.next`, a `<Link href="/no-such-route">` fails `pnpm typecheck`; recorded here     | 2                |
| 7   | manual | an unformatted file fails `pnpm format:check` on a second, cached run; recorded here                  | 4                |
| 8   | manual | the `test:e2e` build log has no "Running TypeScript"; `pnpm build`'s does; recorded here              | 3                |
| 9   | CI     | the PR's run shows the three jobs in parallel and "Quality gate" green; one deliberately failing push | 5                |
|     |        | (a lint error) turns "Quality gate" red, then is reverted                                             |                  |
| 10  | manual | times before and after, locally and in CI, recorded in section 1 and below                            | 6                |

## Risks and open questions

1. **Skipping Next.js's type check in the end-to-end build.** It relies on the gate
   running `pnpm typecheck` (now with route types) before `pnpm test:e2e`, locally and in
   CI. Someone who runs only `pnpm test:e2e` gets no type errors from it. Proposed: accept,
   since the gate always runs both; or drop section 4 and keep the 21 s.
2. **ESLint `--cache`** (66 s to 6 s on a re-run). With type-aware rules ESLint re-lints
   only changed files, so a change to a type in one file can leave a stale pass in a file
   that uses it. Proposed: not in the gate or CI; no `lint:cached` script either, to keep
   one way to lint. The owner may want it for quick local iteration.
3. **Parallel checks on a busy machine.** `pnpm check` runs three CPU-heavy processes at
   once; with several worktrees running the gate it may be slower than in series
   (compare WS-054). Proposed: measure with two worktrees running it; if it is slower,
   document it and keep the sequential commands as the fallback.
4. **More CI minutes.** Three jobs each pay checkout, pnpm and Node setup (about 15 to
   20 s each), for a shorter wall time. Proposed: accept.
