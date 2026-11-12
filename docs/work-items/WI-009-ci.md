# WI-009 — Continuous integration

- Status: Proposed
- Work-track: [WT-01](../work-tracks/WT-01-project-boilerplate.md)
- Depends on: WI-002, WI-004, WI-007
- Work-spec: [WS-009](../work-specs/WS-009-ci.md)

## Outcome

Every push and pull request runs the full five-command quality gate on GitHub, on a clean
machine. "It passes on my computer" stops being the standard: `main` can only be called
green when GitHub says so.

## Acceptance criteria

- [ ] A GitHub Actions workflow runs on every pull request and on pushes to `main`.
- [ ] It runs, in order and failing fast: install from the lockfile, `typecheck`, `lint`,
      `format:check`, `test`, `test:e2e`.
- [ ] It uses the same Node.js, pnpm and PostgreSQL versions as local development, taken
      from the repository's own files rather than repeated in the workflow.
- [ ] The committed OpenAPI file and lockfile are verified as up to date (a stale file
      fails the run).
- [ ] When end-to-end tests fail, the Playwright report and traces are downloadable from
      the run.
- [ ] A newer push to the same branch cancels the run in progress.
- [ ] The workflow has read-only repository permissions.
- [ ] A run on this branch completes successfully on GitHub.

## Notes

Deployment, releases, dependency update bots and branch protection rules are not part of
this item.
