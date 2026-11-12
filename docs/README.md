# Opanel docs index

The spec system is described in `AGENTS.md` section 4. This file is the index: every doc is
listed here with its current status. Update it whenever a doc is added or changes status.

Statuses: `Draft` → `Proposed` → `Approved` → `In progress` → `Done` (or `Superseded`).

## Where the project stands

Updated at the end of every work-item, so that a new session can start from here.

- **Last finished:** WI-016 (first-run setup), merged in PR #8.
- **Next:** WI-017, the sign-in page, protected app shell and account menu. Work-item and
  work-spec are drafted and `Proposed`; **waiting for the owner's approval** of
  [WS-017](work-specs/WS-017-sign-in-page-and-protected-shell.md), which lists three open
  questions. No code until it is `Approved`.
- **Order after that:** the work-item table in
  [WT-02](work-tracks/WT-02-accounts-and-permissions.md), which also holds the ten design
  decisions the owner approved for the track and notes for whoever implements it.
- **Awaiting the owner:** approval of WS-017.

## Canonical docs (`canonical/`)

| Doc                                               | Title                                                       | Status   |
| ------------------------------------------------- | ----------------------------------------------------------- | -------- |
| [0001](canonical/0001-ai-qa-agents-and-triage.md) | AI QA agents: identity, authentication and automated triage | Approved |
| [0002](canonical/0002-realtime-sync.md)           | Real-time board sync                                        | Approved |
| [0003](canonical/0003-task-management.md)         | Task management: roles, tickets, boards and planning        | Approved |
| [0004](canonical/0004-api-conventions.md)         | API conventions                                             | Approved |

## Work-tracks (`work-tracks/`)

| Track                                                  | Title                                                   | Status      |
| ------------------------------------------------------ | ------------------------------------------------------- | ----------- |
| [WT-01](work-tracks/WT-01-project-boilerplate.md)      | Project boilerplate                                     | Done        |
| [WT-02](work-tracks/WT-02-accounts-and-permissions.md) | Accounts, human sign-in, roles and the permission layer | In progress |

Planned next, not yet drafted:

- WT-03 Board core: projects, teams, columns, epics, tasks, comments, assignment
- WT-04 Real-time board sync
- WT-05 Agent accounts and API tokens
- WT-06 Bug reports and automated triage
- WT-07 Backlog, priority, due dates, labels
- WT-08 Search, filters, list view, activity timeline
- WT-09 Sub-tasks and task links
- WT-10 Sprints and story points

WT-07 to WT-10 and the detail of WT-03 come from canonical doc 0003.

## Work-items (`work-items/`) and work-specs (`work-specs/`)

| Item                                                            | Title                                                   | Item status | Spec                                                            | Spec status |
| --------------------------------------------------------------- | ------------------------------------------------------- | ----------- | --------------------------------------------------------------- | ----------- |
| [WI-001](work-items/WI-001-app-skeleton.md)                     | App skeleton: Next.js, strict TypeScript, Vitest        | Done        | [WS-001](work-specs/WS-001-app-skeleton.md)                     | Done        |
| [WI-002](work-items/WI-002-lint-and-format.md)                  | ESLint and Prettier                                     | Done        | [WS-002](work-specs/WS-002-lint-and-format.md)                  | Done        |
| [WI-003](work-items/WI-003-validated-env.md)                    | Validated environment variables                         | Done        | [WS-003](work-specs/WS-003-validated-env.md)                    | Done        |
| [WI-004](work-items/WI-004-database.md)                         | PostgreSQL, Drizzle and the integration test harness    | Done        | [WS-004](work-specs/WS-004-database.md)                         | Done        |
| [WI-005](work-items/WI-005-health-endpoint.md)                  | Health endpoint: the first vertical slice               | Done        | [WS-005](work-specs/WS-005-health-endpoint.md)                  | Done        |
| [WI-006](work-items/WI-006-openapi.md)                          | OpenAPI document generated from Zod                     | Done        | [WS-006](work-specs/WS-006-openapi.md)                          | Done        |
| [WI-007](work-items/WI-007-e2e.md)                              | Playwright end-to-end tests                             | Done        | [WS-007](work-specs/WS-007-e2e.md)                              | Done        |
| [WI-008](work-items/WI-008-ui-foundation.md)                    | UI foundation: Tailwind, shadcn/ui and the app shell    | Done        | [WS-008](work-specs/WS-008-ui-foundation.md)                    | Done        |
| [WI-009](work-items/WI-009-ci.md)                               | Continuous integration                                  | Done        | [WS-009](work-specs/WS-009-ci.md)                               | Done        |
| [WI-010](work-items/WI-010-contributor-docs.md)                 | Contributor docs: README and CONTRIBUTING               | Done        | [WS-010](work-specs/WS-010-contributor-docs.md)                 | Done        |
| [WI-011](work-items/WI-011-api-foundations.md)                  | API foundations: errors, validation helpers, request id | Done        | [WS-011](work-specs/WS-011-api-foundations.md)                  | Done        |
| [WI-012](work-items/WI-012-permissions-and-actor.md)            | Permission catalogue, human roles and the `Actor` type  | Done        | [WS-012](work-specs/WS-012-permissions-and-actor.md)            | Done        |
| [WI-013](work-items/WI-013-accounts-and-better-auth.md)         | Accounts, sessions schema and Better Auth               | Done        | [WS-013](work-specs/WS-013-accounts-and-better-auth.md)         | Done        |
| [WI-014](work-items/WI-014-audit-log.md)                        | Audit log table and writer                              | Done        | [WS-014](work-specs/WS-014-audit-log.md)                        | Done        |
| [WI-015](work-items/WI-015-sign-in-and-authentication.md)       | Sign-in, sign-out, me, authentication, limiter          | Done        | [WS-015](work-specs/WS-015-sign-in-and-authentication.md)       | Done        |
| [WI-016](work-items/WI-016-first-run-setup.md)                  | First-run setup: create the first Admin                 | Done        | [WS-016](work-specs/WS-016-first-run-setup.md)                  | Done        |
| [WI-017](work-items/WI-017-sign-in-page-and-protected-shell.md) | Sign-in page, protected shell, account menu             | Approved | [WS-017](work-specs/WS-017-sign-in-page-and-protected-shell.md) | Approved |

WI-018 to WI-021 are outlined in WT-02 and get their own files when they are started.

## Follow-ups

Deferred decisions that need a work-item before they are acted on.

- Optional `SETUP_TOKEN` for the first-run setup: if set, the form and endpoint require it,
  so a freshly deployed install cannot be claimed by the first visitor (see WS-016,
  question 1).
- Update the data model sketch in doc 0001 section 7 when WS-013 is approved: the password
  hash moves from `accounts` to a `credentials` table (WT-02, design decision 2).
- Declare the security schemes (session cookie, bearer token) in the OpenAPI document
  when the first authenticated endpoint is added (WI-015).
- Add a browsable API documentation page once there are real endpoints (see WS-006).
- Upgrade Node.js from 22 to 24 LTS (`engines`, `.nvmrc`, `@types/node`, CI).
- Upgrade pnpm from 10 to 12 (`packageManager`, CI).
- Upgrade Playwright from 1.63.0 to the latest release (see WS-007).
- Add Firefox and WebKit to the end-to-end tests once there is real UI to protect.
- Return from TypeScript 6.0 to 7 once `typescript-eslint` supports it (see WS-002).
