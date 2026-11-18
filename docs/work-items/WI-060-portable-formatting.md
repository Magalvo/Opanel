# WI-060 — The formatting gate passes on every checkout

- Status: Done
- Work-track: none: a hardening item from the audit of 2026-11-17 (finding A10)
- Depends on: none
- Work-spec: [WS-060](../work-specs/WS-060-portable-formatting.md)

## Outcome

`pnpm format:check` fails on a Windows checkout although the committed files are correctly
formatted. Measured on 2026-11-18, on a clean checkout of `main`:

- Git for Windows sets `core.autocrlf=true`, so 554 of the 560 tracked files are checked
  out with CRLF. Prettier expects LF (`endOfLine` defaults to `"lf"`) and reports every one.
  The index holds LF throughout, so CI on Linux passes.
- Prettier also checks `.claude/worktrees/`, the worktrees Claude Code creates inside the
  repository: a whole second checkout, with the same CRLF files. Git ignores it only
  through `.git/info/exclude`, which Prettier does not read.

The audit also ran a pnpm other than the pinned 10.28.0; it failed on an unrelated step
instead of saying the version was wrong.

After this item:

- `.gitattributes` makes every text file LF in every checkout, whatever `core.autocrlf`
  says, and `.editorconfig` tells editors the same;
- Prettier and ESLint skip `.claude/`;
- CI also runs the format check on a Windows checkout, so a regression shows on the pull
  request;
- pnpm refuses to run with a version other than the pinned one, naming both versions;
- `CONTRIBUTING.md` says how to re-check out an existing clone once.

## Acceptance criteria

- [x] On a Windows checkout with `core.autocrlf=true`, after the one-time re-checkout,
      `pnpm format:check` passes; before this item it fails on line endings.
- [x] `git ls-files --eol` reports `w/lf` for every tracked text file on that checkout.
- [x] No tracked file's content changes: the index already holds LF everywhere
      (`git add --renormalize .` stages nothing).
- [x] `pnpm format:check` and `pnpm lint` do not read `.claude/`.
- [x] A CI job on `windows-latest` checks out, installs and runs `pnpm format:check`, and
      passes.
- [x] Running a pnpm 10 other than 10.28.0 in the repository stops with pnpm's message
      naming the wanted and the current version.
- [x] `CONTRIBUTING.md` documents the one-time re-checkout and the pinned toolchain.
- [x] Prettier's options are unchanged. The full quality gate passes.

## Notes

Not a reformat: no source file is rewritten. Only line endings in working copies change.
