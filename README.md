# Opanel

[![CI](https://github.com/Magalvo/Opanel/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Magalvo/Opanel/actions/workflows/ci.yml)

Opanel is an open-source project management web app: a modern Jira alternative built from
day one for human engineering teams and autonomous AI agents working side by side.

- **Task management** — projects, epics, tasks, kanban boards, assignments to teams and
  people.
- **Agents as first-class accounts** — an AI agent has its own identity, role, scopes and
  credentials, and every action it takes is attributable to it.
- **Automated triage** — external AI QA agents submit structured bug reports, and Opanel
  turns each one into a ticket routed to the responsible team.

## Status

Opanel is in early development. Accounts are in place: a first-run setup that creates the
first Admin, sign-in with email and password, four roles, and an API with which Admins
invite people, change roles and deactivate accounts. There are no projects, boards or
agents yet. The roadmap and the status of every piece of work are in
[docs/README.md](docs/README.md).

## Prerequisites

| Tool    | Version | Notes                                                                      |
| ------- | ------- | -------------------------------------------------------------------------- |
| Node.js | 22      | Pinned in [.nvmrc](.nvmrc).                                                |
| pnpm    | 10      | Pinned in [package.json](package.json). `corepack enable` installs it.     |
| Docker  | recent  | With Docker Compose. Runs PostgreSQL 18 for development and for the tests. |

## Getting started

```bash
pnpm install
cp .env.example .env   # then replace BETTER_AUTH_SECRET: openssl rand -base64 32
docker compose up -d
pnpm db:migrate
pnpm dev
```

Then open <http://localhost:3000>. A fresh install leads you to `/setup`, where you create the
first administrator; the page disappears once an account exists, and from then on visitors
are asked to sign in. The health endpoint is at
<http://localhost:3000/api/v1/health> and the OpenAPI document at
<http://localhost:3000/api/v1/openapi.json>.

If port 5432 is already in use on your machine, see
[CONTRIBUTING.md](CONTRIBUTING.md#local-database).

## Commands

The five commands marked **gate** are the quality gate: all of them must pass before a
change is accepted, and CI runs the same five on every pull request.

| Command                 | What it does                                                         |
| ----------------------- | -------------------------------------------------------------------- |
| `pnpm dev`              | Starts the app in development mode on port 3000.                     |
| `pnpm build`            | Builds the app for production.                                       |
| `pnpm start`            | Serves the production build.                                         |
| `pnpm typecheck`        | **Gate.** Type-checks the whole project.                             |
| `pnpm lint`             | **Gate.** Runs ESLint; warnings count as failures.                   |
| `pnpm lint:fix`         | Runs ESLint and fixes what it can.                                   |
| `pnpm format:check`     | **Gate.** Checks formatting with Prettier.                           |
| `pnpm format`           | Formats every file with Prettier.                                    |
| `pnpm test`             | **Gate.** Runs unit and integration tests (needs the database).      |
| `pnpm test:unit`        | Runs unit tests only (no database needed).                           |
| `pnpm test:integration` | Runs integration tests only.                                         |
| `pnpm test:watch`       | Runs Vitest in watch mode.                                           |
| `pnpm test:e2e`         | **Gate.** Builds the app and runs the Playwright end-to-end tests.   |
| `pnpm db:generate`      | Generates a migration from changes to the Drizzle schema.            |
| `pnpm db:migrate`       | Applies pending migrations to the database in `DATABASE_URL`.        |
| `pnpm openapi:generate` | Regenerates [docs/api/openapi.json](docs/api/openapi.json) from Zod. |

## Project layout

```
AGENTS.md       Project rules: read this first
docs/           Specs, and the index of all work
src/app/        Pages and /api/v1 route handlers
src/components/ React components (ui/ holds shadcn/ui)
src/server/     Database, domain services, auth
src/lib/        Zod schemas shared by API, UI and OpenAPI
tests/e2e/      Playwright end-to-end tests
```

The full layout and the layering rules are in [AGENTS.md](AGENTS.md), section 3.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) before opening a pull
request. Changes are spec-driven: a work-spec is approved before any code is written.

## Licence

[MIT](LICENSE)
