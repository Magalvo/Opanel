# WI-053 — No vulnerable esbuild in the dependency tree

- Status: Done
- Work-track: none: a hardening item from the audit of 2026-11-17 (finding A11)
- Depends on: none (its branch was stacked on WI-052, and rebased onto `main` once WI-052
  and WI-054 were merged)
- Work-spec: [WS-053](../work-specs/WS-053-esbuild-advisory.md)

## Outcome

`pnpm audit --prod` reports one moderate advisory, GHSA-67mh-4wv8-2f99 (esbuild's
development server answers any website's requests, up to 0.24.2), on the path
`better-auth > drizzle-kit > @esbuild-kit/esm-loader > @esbuild-kit/core-utils > esbuild@0.18.20`.

Opanel is not exposed: it never starts an esbuild server. The path is not even loaded:
better-auth declares drizzle-kit as an **optional** peer and never imports it, drizzle-kit
is Opanel's own devDependency, and drizzle-kit 0.31.11 lists `@esbuild-kit/esm-loader` but
none of its shipped files refer to it (both `@esbuild-kit` packages are deprecated, "merged
into tsx"). Still, the old esbuild is installed, and an audit that always shows one known
advisory teaches everyone to ignore the audit.

After this item no esbuild older than 0.25.0 is installed, `pnpm audit --prod` reports
nothing, and a scheduled audit catches the next advisory.

## Acceptance criteria

- [x] `pnpm-lock.yaml` resolves no esbuild below 0.25.0; `pnpm why esbuild` shows it.
- [x] `pnpm audit --prod` reports no vulnerabilities.
- [x] `pnpm db:generate` still works and leaves no diff; migrations still apply (the
      integration and end-to-end suites migrate their databases).
- [x] A CI workflow runs `pnpm audit --prod` weekly and on any change to `package.json`,
      `pnpm-lock.yaml` or `pnpm-workspace.yaml`, with SHA-pinned actions and a frozen-lockfile install.
- [x] No package is added, removed or upgraded in `package.json` `dependencies` or
      `devDependencies`.
- [x] The full quality gate passes (after rebasing onto `main` with WI-054; see WS-053,
      "Implementation record").

## Notes

drizzle-kit 1.0, which drops `@esbuild-kit`, exists only as a release candidate
(`1.0.0-rc.5` on 2026-11-17). When it is stable, upgrading removes the reason for the
override (WS-053, question 2).
