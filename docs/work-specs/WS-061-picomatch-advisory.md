# WS-061 — Triage of the picomatch advisory, with no fix published

- Status: Done (approved by the owner on 2026-11-18, questions 1 to 4 as proposed)
- Work-item: [WI-061](../work-items/WI-061-picomatch-advisory.md)
- Canonical docs: none changed (no dependency in the stack table of `AGENTS.md` changes);
  [WS-053](WS-053-esbuild-advisory.md) (the audit workflow and its process);
  [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)

## Approach

### 1. What was checked (2026-11-18)

- `pnpm audit --prod` (pnpm 10.28.0), on `main`: one high advisory, picomatch `<=4.0.7`,
  path `.>better-auth>vitest>picomatch`. CI run 44301156987 (pull request #53) reports the
  same.
- The advisory (GitHub API): `first_patched_version` is null. npm's latest picomatch is
  4.0.7. The attack needs the attacker to supply the **glob pattern**: `+(*)`, `+(*a)`,
  matched against a short crafted string.
- `pnpm why picomatch`: 4.0.7 everywhere (vitest, vite, tinyglobby, fdir, and through them
  other dev tools), plus one 2.3.2. In the production audit, only under better-auth's
  `vitest`.
- better-auth 1.7.22: `vitest` is in `peerDependenciesMeta` with `optional: true`. Its
  `dist` uses it only in `dist/test-utils/`, the `better-auth/test-utils` export, which
  Opanel never imports (`src`, `tests`: no match).
- Opanel's code never imports picomatch, micromatch or minimatch. Vitest and Vite compile
  only patterns written in this repository's config.
- pnpm 10.28.0 reads `auditConfig.ignoreGhsas` from `pnpm-workspace.yaml` (read in the
  installed `pnpm.cjs`: `auditConfig` is a root setting, and the audit drops findings whose
  `github_advisory_id` is listed).

### 2. The ignore

`pnpm-workspace.yaml`:

```yaml
auditConfig:
  ignoreGhsas:
    # picomatch <=4.0.7, ReDoS on attacker-supplied extglob patterns; no fix published.
    # Only path: better-auth's optional peer vitest (our own test runner); Opanel never
    # gives picomatch a pattern from outside the repository. The audit workflow fails
    # once a fix exists (WS-061).
    - GHSA-fc5q-39xc-vjpf
```

One id, not `--ignore-unfixable` (which would hide every future advisory without a fix,
reachable or not).

### 3. The ignore expires with the fix

A step in `.github/workflows/audit.yml`, after the audit:

```yaml
- name: Ignored advisories still have no fix
  env:
    GH_TOKEN: ${{ github.token }}
  run: pnpm exec tsx scripts/check-ignored-advisories.ts
```

`scripts/check-ignored-advisories.ts` (run with `tsx`, as `scripts/migrate.ts` is; no new
dependency): reads the
`ignoreGhsas` ids from `pnpm-workspace.yaml` (lines matching `- GHSA-…` under
`ignoreGhsas`), asks the GitHub advisory API for each (`/advisories/<id>`, with
`GH_TOKEN`), and exits 1 naming every id whose `vulnerabilities[].first_patched_version`
is not null: "A fix exists for GHSA-…: upgrade, then remove the ignore." A failed request
also exits 1. It runs weekly with the audit, so a published fix turns the workflow red
within a week.

The parsing and the verdict are pure functions, exported and covered by a unit test; the
script runs them only when executed directly. The API call itself is exercised by the
workflow and once by hand (test 5). The unit project of `vitest.config.ts` gains
`scripts/**/*.test.ts` in its `include`.

### 4. `CONTRIBUTING.md`

Step 4 becomes: never ignore an advisory wholesale, never override a package everywhere
when one path is enough. An advisory **with no fix published and no path Opanel runs in
production** may be ignored by its id in `auditConfig.ignoreGhsas`, decided in a
work-spec, with a comment naming it; the audit workflow fails once a fix exists.

### Considered and not chosen

- **`pnpm audit --prod --ignore-unfixable`**: expires by itself, but also hides any future
  unfixed advisory on a reachable path, where Opanel might still need to act (replace the
  package, guard the input).
- **Override picomatch**: no version to override to; 2.x is in range too.
- **Stop pnpm from resolving the optional peer** (`resolvePeersFromWorkspaceRoot: false`):
  changes how every peer in the tree resolves, a far larger change than this advisory.
- **Wait**: the audit stays red on every pull request that touches dependencies, and the
  weekly run is red until upstream publishes a fix.

## Files

| Path                                       | Change                                    |
| ------------------------------------------ | ----------------------------------------- |
| `pnpm-workspace.yaml`                      | modify: `auditConfig.ignoreGhsas`, one id |
| `scripts/check-ignored-advisories.ts`      | create: section 3                         |
| `vitest.config.ts`                         | modify: unit tests also under `scripts/`  |
| `scripts/check-ignored-advisories.test.ts` | create: the parsing and the verdict       |
| `.github/workflows/audit.yml`              | modify: the expiry step                   |
| `CONTRIBUTING.md`                          | modify: step 4                            |
| `docs/README.md`, WI-061, WS-061           | modify: statuses                          |

No application code, no migration, no dependency change.

## Data model changes

None.

## API contract

None.

## Test plan (written first, in this order)

| #   | Level  | Test                                                                                                                                    | Covers criterion |
| --- | ------ | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | manual | `pnpm audit --prod` before the change: fails on GHSA-fc5q-39xc-vjpf (red, recorded)                                                     | 1                |
| 2   | unit   | the parser returns the ids under `auditConfig.ignoreGhsas` and nothing from comments or other keys; an empty or missing list gives none | 3                |
| 3   | unit   | the verdict: an advisory whose vulnerabilities all have `first_patched_version: null` passes; one with a version fails and names the id | 3                |
| 4   | manual | `pnpm audit --prod` after: passes; with the id removed: fails                                                                           | 1, 2             |
| 5   | manual | `pnpm exec tsx scripts/check-ignored-advisories.ts` with `GH_TOKEN` from `gh auth token`: passes today                                  | 3                |
| 6   | CI     | the audit workflow on the pull request: the audit and the expiry step pass                                                              | 3, 5             |
| 7   | gate   | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm install --frozen-lockfile` leaves `pnpm-lock.yaml` unchanged             | 5                |

## Risks and open questions

For the owner:

1. **Ignore this advisory by id** while no fix exists (section 2), instead of leaving the
   audit red. **Recommend: ignore by id.**
2. **The expiry check** (section 3), a small script calling GitHub's advisory API weekly.
   Without it, the ignore depends on someone remembering. **Recommend: add it.**
3. **`CONTRIBUTING.md` step 4 changes**: it allowed no ignore at all, as decided in WS-053.
   This narrows the exception to "no fix and no production path". **Recommend: approve.**
4. **Branch and order.** This item is on its own branch from `main`. Pull request #53
   (WI-060) also touches `pnpm-workspace.yaml`, so its audit stays red until this merges;
   whichever merges second needs a trivial rebase. **Recommend: merge this one first, then
   rerun #53's audit.**

## Deviations from the approved spec

1. **The external input is validated with Zod** (`AGENTS.md` hard rule 4): `GH_TOKEN` and
   the advisory API's answer go through a schema before use. The spec did not name it.
2. **One unit test more than planned**: the parser also reads a CRLF file, since the script
   may run on a Windows checkout (WS-060).

## Implementation record

- Red:
  - `pnpm audit --prod` on `main` failed on GHSA-fc5q-39xc-vjpf (exit 1), as in CI run 44301156987.
  - The unit tests failed before the script existed: the module could not be resolved.
- Green:
  - `scripts/check-ignored-advisories.ts`: `ignoredGhsas()` and `fixedAdvisories()`, pure
    and exported; `main()` runs only when the file is executed directly. 6 unit tests.
  - `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml`, one id, with its reason.
  - The expiry step in `audit.yml`.
  - `CONTRIBUTING.md` step 4.
  - `scripts/**/*.test.ts` in the unit project of `vitest.config.ts`.
- Checks by hand on 2026-11-18:
  - `pnpm audit --prod` exits 0 with the ignore ("1 high (1 ignored)") and 1 without it.
  - The expiry script, with `GH_TOKEN` from `gh auth token`, passes ("Ignored advisories
    without a fix: GHSA-fc5q-39xc-vjpf.").
  - With GHSA-67mh-4wv8-2f99 (the esbuild advisory of WS-053, which has a fix) added to the
    list for the check, it exits 1: "A fix exists for GHSA-67mh-4wv8-2f99: upgrade, then
    remove the ignore."
  - `pnpm install --frozen-lockfile` leaves `pnpm-lock.yaml` unchanged.
- Gate on 2026-11-18:
  - typecheck and lint pass; Prettier on the changed files passes;
  - Vitest 1181 of 1181; `pnpm test:e2e` 68 of 68 with `--retries=0`;
  - Windows, Node 24, pnpm 10.28.0, Compose PostgreSQL on port 5433.
