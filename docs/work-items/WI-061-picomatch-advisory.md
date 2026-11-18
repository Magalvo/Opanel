# WI-061 — Triage of the picomatch advisory, with no fix published

- Status: Done
- Work-track: none: dependency triage (the process of WS-053)
- Depends on: none
- Work-spec: [WS-061](../work-specs/WS-061-picomatch-advisory.md)

## Outcome

`pnpm audit --prod` fails on `main` since
[GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) (high, published
2026-10-19): picomatch up to 4.0.7, the latest version, compiles single-branch repeated
extglobs such as `+(*)` into a regular expression that backtracks exponentially. **No
patched version exists.** It showed on pull request #53 because that pull request touches
`pnpm-workspace.yaml`; it would show on the next weekly run anyway.

The only production path is `better-auth > vitest > … > picomatch`. As with esbuild in
WS-053, `vitest` is an optional peer of better-auth that pnpm resolves to Opanel's own
devDependency, so the audit counts the test runner as production. Opanel never passes a
glob pattern from a user to picomatch.

The process in `CONTRIBUTING.md` (upgrade, else a scoped override) has nothing to upgrade
to, and it forbids ignoring an advisory.

After this item:

- the audit ignores this one advisory by its id, with the reason next to it;
- the audit workflow fails as soon as any ignored advisory has a patched version, so the
  ignore cannot outlive the fix;
- `CONTRIBUTING.md` says when an advisory may be ignored, and how.

## Acceptance criteria

- [x] `pnpm audit --prod` passes, and fails again if the ignore is removed.
- [x] Only `GHSA-fc5q-39xc-vjpf` is ignored, by id, in `pnpm-workspace.yaml`, with a comment
      naming the advisory, the path, why it is unreachable and this work-spec.
- [x] The audit workflow has a step that fails when an ignored advisory has a patched
      version, naming it; it passes today.
- [x] `CONTRIBUTING.md` step 4 allows an ignore by id only for an advisory with no fix and
      no path Opanel runs in production, decided in a work-spec.
- [x] No dependency version changes; `pnpm-lock.yaml` is unchanged. The full quality gate
      and the audit workflow pass.

## Notes

The vulnerable code stays installed as part of Vitest and Vite, which only run in
development and CI on the repository's own patterns.
