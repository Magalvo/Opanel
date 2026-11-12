# WT-01 — Project boilerplate

- Status: In progress (approved by the owner on 2026-11-12)
- Canonical docs: `AGENTS.md` (sections 2, 3, 5), [0001](../canonical/0001-ai-qa-agents-and-triage.md), [0002](../canonical/0002-realtime-sync.md)

## Goal

A running, empty Opanel app in which every guardrail from `AGENTS.md` section 5 exists and
is enforced locally and in CI, so that all later work-tracks can be built with TDD from
their first commit.

## In scope

- Next.js + TypeScript (strict) app skeleton with the directory layout from `AGENTS.md`.
- The full quality gate: `typecheck`, `lint`, `format:check`, `test`, `test:e2e`.
- PostgreSQL via Docker Compose, Drizzle client and migration tooling, validated env vars.
- One vertical slice proving the layering end to end: `GET /api/v1/health`.
- OpenAPI generation from Zod.
- Tailwind CSS + shadcn/ui base.
- GitHub Actions CI and contributor setup docs.

## Out of scope

- Any domain feature: accounts, auth, projects, tasks, agents, triage, real-time sync.
- Better Auth installation (WT-02).
- Production deployment (app Dockerfile, reverse proxy). Compose here is for local
  development and CI only.

## Work-items

Each item leaves the repository green and is one branch/PR.

| Item                                              | Title                                                                              | Status   | Depends on             |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- | -------- | ---------------------- |
| [WI-001](../work-items/WI-001-app-skeleton.md)    | App skeleton: Next.js, strict TypeScript, Vitest                                   | Done     | none                   |
| [WI-002](../work-items/WI-002-lint-and-format.md) | ESLint + Prettier with `lint` and `format:check` scripts                           | Done     | WI-001                 |
| [WI-003](../work-items/WI-003-validated-env.md)   | Validated environment variables (Zod)                                              | Done     | WI-001                 |
| [WI-004](../work-items/WI-004-database.md)        | PostgreSQL in Docker Compose, Drizzle client, migrations, integration test harness | Done     | WI-003                 |
| [WI-005](../work-items/WI-005-health-endpoint.md) | `GET /api/v1/health` vertical slice (route handler → service → DB)                 | Proposed | WI-004                 |
| WI-006                                            | OpenAPI document generated from Zod, served at `/api/v1/openapi.json`              | Draft    | WI-005                 |
| WI-007                                            | Playwright setup with a smoke test, `test:e2e` script                              | Draft    | WI-005                 |
| WI-008                                            | Tailwind CSS + shadcn/ui base and app shell layout                                 | Draft    | WI-002                 |
| WI-009                                            | GitHub Actions CI running the full quality gate                                    | Draft    | WI-002, WI-004, WI-007 |
| WI-010                                            | `README.md` and `CONTRIBUTING.md`: setup, commands, workflow                       | Draft    | WI-009                 |

Work-items beyond WI-001 are listed here as one-liners and get their own work-item and
work-spec files just before they are started, so each spec reflects the code that actually
exists at that point.

## Exit criteria

- A fresh clone reaches a running app with: `pnpm install`, `docker compose up -d`,
  `pnpm db:migrate`, `pnpm dev`.
- All five quality gate commands pass locally and in CI on `main`.
- `GET /api/v1/health` returns `200` with database status, covered by unit, integration
  and E2E tests.
- The directory layout matches `AGENTS.md` section 3.
