# Opanel docs index

The spec system is described in `AGENTS.md` section 4. This file is the index: every doc is
listed here with its current status. Update it whenever a doc is added or changes status.

Statuses: `Draft` → `Proposed` → `Approved` → `In progress` → `Done` (or `Superseded`).

## Canonical docs (`canonical/`)

| Doc                                               | Title                                                       | Status   |
| ------------------------------------------------- | ----------------------------------------------------------- | -------- |
| [0001](canonical/0001-ai-qa-agents-and-triage.md) | AI QA agents: identity, authentication and automated triage | Approved |
| [0002](canonical/0002-realtime-sync.md)           | Real-time board sync                                        | Approved |
| [0003](canonical/0003-task-management.md)         | Task management: roles, tickets, boards and planning        | Approved |

## Work-tracks (`work-tracks/`)

| Track                                             | Title               | Status      |
| ------------------------------------------------- | ------------------- | ----------- |
| [WT-01](work-tracks/WT-01-project-boilerplate.md) | Project boilerplate | In progress |

Planned next, not yet drafted:

- WT-02 Accounts, human sign-in, roles and the permission layer
- WT-03 Board core: projects, teams, columns, epics, tasks, comments, assignment
- WT-04 Real-time board sync
- WT-05 Agent accounts and API tokens
- WT-06 Bug reports and automated triage
- WT-07 Backlog, priority, due dates, labels
- WT-08 Search, filters, list view, activity timeline
- WT-09 Sub-tasks and task links
- WT-10 Sprints and story points

WT-07 to WT-10 and the detail of WT-02 and WT-03 come from canonical doc 0003.

## Work-items (`work-items/`) and work-specs (`work-specs/`)

| Item                                           | Title                                                | Item status | Spec                                           | Spec status |
| ---------------------------------------------- | ---------------------------------------------------- | ----------- | ---------------------------------------------- | ----------- |
| [WI-001](work-items/WI-001-app-skeleton.md)    | App skeleton: Next.js, strict TypeScript, Vitest     | Done        | [WS-001](work-specs/WS-001-app-skeleton.md)    | Done        |
| [WI-002](work-items/WI-002-lint-and-format.md) | ESLint and Prettier                                  | Done        | [WS-002](work-specs/WS-002-lint-and-format.md) | Done        |
| [WI-003](work-items/WI-003-validated-env.md)   | Validated environment variables                      | Done        | [WS-003](work-specs/WS-003-validated-env.md)   | Done        |
| [WI-004](work-items/WI-004-database.md)        | PostgreSQL, Drizzle and the integration test harness | Done        | [WS-004](work-specs/WS-004-database.md)        | Done        |
| [WI-005](work-items/WI-005-health-endpoint.md) | Health endpoint: the first vertical slice            | Done        | [WS-005](work-specs/WS-005-health-endpoint.md) | Done        |
| [WI-006](work-items/WI-006-openapi.md)         | OpenAPI document generated from Zod                  | Done        | [WS-006](work-specs/WS-006-openapi.md)         | Done        |
| [WI-007](work-items/WI-007-e2e.md)             | Playwright end-to-end tests                          | Proposed    | [WS-007](work-specs/WS-007-e2e.md)             | Proposed    |

WI-008 to WI-010 are outlined in WT-01 and get their own files when they are started.

## Follow-ups

Deferred decisions that need a work-item before they are acted on.

- Add a browsable API documentation page once there are real endpoints (see WS-006).
- Write canonical doc "API conventions" (error format, pagination, versioning) at the
  start of WT-02.
- Upgrade Node.js from 22 to 24 LTS (`engines`, `.nvmrc`, `@types/node`, CI).
- Upgrade pnpm from 10 to 12 (`packageManager`, CI).
- Return from TypeScript 6.0 to 7 once `typescript-eslint` supports it (see WS-002).
