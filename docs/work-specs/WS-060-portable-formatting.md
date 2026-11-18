# WS-060 — The formatting gate passes on every checkout

- Status: Done (approved by the owner on 2026-11-18, questions 1 to 4 as proposed)
- Work-item: [WI-060](../work-items/WI-060-portable-formatting.md)
- Canonical docs: `AGENTS.md` sections 2 (Prettier, pnpm, GitHub Actions) and 5 (the
  gate); [WS-053](WS-053-esbuild-advisory.md) (`pnpm-workspace.yaml` settings); audit of
  2026-11-17, finding A10

## Approach

### 1. Where things stand (checked on 2026-11-18)

- No `.gitattributes`, no `.editorconfig`. `.prettierrc.json` sets only `printWidth` and
  the Tailwind plugin; Prettier 3.10.1's `endOfLine` default is `"lf"`.
- `git ls-files --eol` on this Windows checkout: 554 files `i/lf w/crlf`, 6 `i/lf w/lf`, no
  binary file. `core.autocrlf=true` comes from Git for Windows' system config.
- `pnpm format:check` reports 1029 files: about 520 in the checkout itself and 508 under
  `.claude/worktrees/` (a Claude Code worktree, excluded from Git by `.git/info/exclude`
  only). ESLint lints that directory too (and passes, today).
- `package.json` pins `"packageManager": "pnpm@10.28.0"`; `.nvmrc` pins Node 22; CI reads
  both. pnpm 10.28.0's `package-manager-strict-version` defaults to `false`: a pnpm whose
  version differs only warns, then continues (read in the installed `pnpm.cjs`).

### 2. `.gitattributes`: LF in every checkout

```gitattributes
# Every text file is LF in the repository and in every checkout, whatever
# core.autocrlf says (WS-060). Git detects binary files itself.
* text=auto eol=lf
```

`eol=lf` overrides `core.autocrlf` for files Git sees as text. The index already holds LF,
so `git add --renormalize .` stages nothing: the commit adds the file, not a rewrite.

An existing clone keeps its CRLF files until they are checked out again. The one-time step,
for a clean working tree, goes in `CONTRIBUTING.md`:

```bash
git rm -r --cached --quiet . && git reset --hard --quiet
```

### 3. `.editorconfig`: the same for editors

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
```

These match what Prettier already produces; Prettier also reads `end_of_line`,
`indent_style` and `indent_size` from it, with the same values, so its output is unchanged.
No `max_line_length` (it would override nothing, `printWidth` is set) and no
`trim_trailing_whitespace` (Markdown line breaks).

### 4. Prettier and ESLint skip `.claude/`

`.prettierignore` gains `.claude/`; `eslint.config.mjs`'s `globalIgnores` gains
`".claude/**"`. The directory holds local tool state and other checkouts, never source.
`.gitignore` is not changed: whether `.claude/` settings are ever committed is a separate
decision, and the worktrees are already excluded locally.

### 5. CI: the format check on Windows

A second job in `.github/workflows/ci.yml`, `Format check (Windows)`, on `windows-latest`
(whose Git has `core.autocrlf=true`): check out, install pnpm and Node the same way as the
quality gate, `pnpm install --frozen-lockfile`, `pnpm format:check`. No database, no tests;
about 2 to 3 minutes, in parallel with the quality gate.

Red: the job is added first, in its own commit, before `.gitattributes`; it is expected to
fail on the pull request's first run, and the run is recorded.

### 6. pnpm: a wrong version stops with a clear message

`pnpm-workspace.yaml` gains:

```yaml
# A pnpm other than packageManager's stops at once, naming both versions (WS-060).
packageManagerStrictVersion: true
```

pnpm 10.28.0 then answers "This project is configured to use v10.28.0 of pnpm. Your
current pnpm is vX" and stops. `corepack enable` (as the README says) always runs the
pinned version, so a contributor using it never sees the message.

Not verified: what pnpm 11, which the audit host ran, does with this setting. Checking it
means downloading pnpm 11; I will ask before doing that (open question 3).

### 7. Node

`.nvmrc` stays the release toolchain (Node 22, what CI runs). `engines.node` stays `>=22`:
tightening it to 22 only would refuse Node 24, which runs the gate today without trouble.
`CONTRIBUTING.md` says CI on Node 22 is the reference (open question 4).

### Considered and not chosen

- **`endOfLine: "auto"` in Prettier**: hides the mismatch instead of fixing it, and lets
  mixed endings into the repository. The audit says not to relax formatting.
- **Asking contributors to set `core.autocrlf=false`**: per machine, easy to miss, and
  undone by a fresh Git install.
- **A Vitest test reading `git check-attr`**: checks the attribute, not the outcome; the
  Windows job checks the outcome.

## Files

| Path                        | Change                                                       |
| --------------------------- | ------------------------------------------------------------ |
| `.gitattributes`            | create: section 2                                            |
| `.editorconfig`             | create: section 3                                            |
| `.prettierignore`           | modify: `.claude/`                                           |
| `eslint.config.mjs`         | modify: `.claude/**` in `globalIgnores`                      |
| `.github/workflows/ci.yml`  | modify: the Windows format job                               |
| `pnpm-workspace.yaml`       | modify: `packageManagerStrictVersion: true`                  |
| `CONTRIBUTING.md`           | modify: the one-time re-checkout; the toolchain of reference |
| `docs/README.md`, WI/WS-060 | modify: statuses                                             |

## Data model changes

None.

## API contract

None.

## Test plan (written first, in this order)

| #   | Level  | Test                                                                                                                                | Covers criterion |
| --- | ------ | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | CI     | the Windows format job, added first: fails on line endings (red, recorded)                                                          | 1, 5             |
| 2   | manual | this Windows checkout, before: `pnpm format:check` fails; after `.gitattributes`, the ignores and the re-checkout: passes           | 1, 4             |
| 3   | manual | `git ls-files --eol`: every file `w/lf`; `git add --renormalize .` then `git status`: nothing staged besides this item's files      | 2, 3             |
| 4   | manual | `npx pnpm@10.27.0 --version` in the repository (or `COREPACK_ENABLE_STRICT=0` with another pnpm 10): stops with the version message | 6                |
| 5   | CI     | the Windows format job and the quality gate pass on the pull request                                                                | 5, 8             |
| 6   | gate   | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`, here on Windows                                                            | 8                |

Test 4 downloads pnpm 10.27.0 from the npm registry; I will ask before running it.

## Risks and open questions

For the owner:

1. **A Windows job in CI** (section 5): about 2 to 3 minutes more per run, in parallel.
   Without it, nothing stops a regression except a Windows contributor noticing.
   **Recommend: add it.**
2. **Ignore `.claude/` in Prettier and ESLint** (section 4), not in `.gitignore`.
   **Recommend: as proposed.**
3. **`packageManagerStrictVersion: true`** (section 6): any pnpm other than 10.28.0 stops.
   A contributor without corepack must install exactly that version. Its effect on pnpm 11
   is not verified. **Recommend: as proposed.**
4. **Node stays `>=22`, with Node 22 as the reference** (section 7), rather than refusing
   other versions. **Recommend: as proposed.**

## Deviations from the approved spec

1. **This checkout was re-checked out file by file, not with `git reset --hard`**: the
   working tree held this item's uncommitted files, which a hard reset would discard. The
   548 CRLF files without changes were deleted and checked out again. The command in
   `CONTRIBUTING.md` is unchanged; it is for a clean working tree.
2. **Test 4 needed pnpm's own switch turned off.** By default pnpm 10.27.0 sees
   `packageManager` and runs 10.28.0 instead (`managePackageManagerVersions`), so it never
   reaches the version check. With `--config.manage-package-manager-versions=false` the
   setting decides; both results are recorded below.

## Implementation record

- Red:
  - Locally, on this Windows checkout, before any change: `pnpm format:check` failed on
    1038 files, 530 in the checkout and 508 under `.claude/worktrees/`.
  - In CI: commit `b8c891d` added only the Windows job. Run 44299960237 on pull request
    #53: `Format check (Windows)` failed on 537 files, with `core.autocrlf=true` from the
    runner's system config and `package.json` checked out `i/lf w/crlf`; `Quality gate`
    passed.
- Green:
  - `.gitattributes` (`* text=auto eol=lf`) and `.editorconfig`.
    `git add --renormalize .` staged no file besides this item's.
  - `.claude/` in `.prettierignore` and in ESLint's `globalIgnores`.
  - `packageManagerStrictVersion: true` in `pnpm-workspace.yaml`.
  - `CONTRIBUTING.md`: the toolchain of reference and the one-time re-checkout.
  - After the re-checkout, `git ls-files --eol` shows all 560 files `i/lf w/lf`.
- pnpm 10.27.0 (from the npm registry, with the owner's approval):
  - by default it switched to 10.28.0 and ran;
  - with `manage-package-manager-versions=false` it stopped with "This project is
    configured to use v10.28.0 of pnpm. Your current pnpm is v10.27.0" (exit 1);
  - without the new setting, it carried on (exit 0).
- Gate on 2026-11-18, on this Windows checkout:
  - `pnpm format:check` passes on the whole repository, for the first time here;
  - typecheck and lint pass;
  - Vitest 1175 of 1175; `pnpm test:e2e` 68 of 68 with `--retries=0`;
  - Node 24, pnpm 10.28.0, Compose PostgreSQL on port 5433.
