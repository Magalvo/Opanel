# WI-009 — Continuous integration

- Status: Done (approved by the owner on 2026-11-12)
- Work-track: [WT-01](../work-tracks/WT-01-project-boilerplate.md)
- Depends on: WI-002, WI-004, WI-007
- Work-spec: [WS-009](../work-specs/WS-009-ci.md)

## Outcome

Every push and pull request runs the full five-command quality gate on GitHub, on a clean
machine. "It passes on my computer" stops being the standard: `main` can only be called
green when GitHub says so.

## Acceptance criteria

- [x] A GitHub Actions workflow runs on every pull request and on pushes to `main`.
- [x] It runs, in order and failing fast: install from the lockfile, `typecheck`, `lint`,
      `format:check`, `test`, `test:e2e`.
- [x] It uses the same Node.js, pnpm and PostgreSQL versions as local development, taken
      from the repository's own files rather than repeated in the workflow.
- [x] The committed OpenAPI file and lockfile are verified as up to date (a stale file
      fails the run).
- [x] When end-to-end tests fail, the Playwright report and traces are downloadable from
      the run.
- [x] A newer push to the same branch cancels the run in progress.
- [x] The workflow has read-only repository permissions.
- [x] A run on this branch completes successfully on GitHub.

## Notes

Deployment, releases, dependency update bots and branch protection rules are not part of
this item.
