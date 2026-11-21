# Opanel docs index

The spec system is described in `AGENTS.md` section 4. This file is the index: every doc is
listed here with its link and title. A doc's status is the `Status:` line at its top, the
only record of it: `Draft` → `Proposed` → `Approved` → `In progress` → `Done` (or
`Superseded`). To list the docs in a status:
`grep -l "^- Status: In progress" docs/*/*.md`.

Only index commits on `main` change this file (`AGENTS.md` section 4): reserving a
number, recording a follow-up, and moving "Where the project stands". A work-item branch
never edits it. `scripts/docs-index.test.ts` checks it against the docs.

## Where the project stands

What a new session needs to start: what comes next, and what waits for the owner. Moved by
an index commit when a work-track is approved or done, or when what comes next changes.

- **Next:** WT-11 item B (the MCP read tools, doc 0005 section 4) proposed as a work-item
  and work-spec, and the owner's approval; item A is done (WI-099). WT-07 to WT-10 follow,
  as planned below.
- **Waiting for the owner:** WI-095 and WI-097 (Draft), from the development-flow review
  of 2026-11-20: each worktree gets its own test databases and ports (finding D01), and a
  faster Vitest suite (D05 to D07). The lower findings D08 to D12 are listed under
  [Follow-ups](#follow-ups).
- **Planning gaps awaiting an owner decision** are listed first under
  [Follow-ups](#follow-ups).

## Canonical docs (`canonical/`)

| Doc                                               | Title                                                       |
| ------------------------------------------------- | ----------------------------------------------------------- |
| [0001](canonical/0001-ai-qa-agents-and-triage.md) | AI QA agents: identity, authentication and automated triage |
| [0002](canonical/0002-realtime-sync.md)           | Real-time board sync                                        |
| [0003](canonical/0003-task-management.md)         | Task management: roles, tickets, boards and planning        |
| [0004](canonical/0004-api-conventions.md)         | API conventions                                             |
| [0005](canonical/0005-mcp-server.md)              | MCP server: Opanel as tools for AI assistants               |
| [0006](canonical/0006-operations.md)              | Operations: deployment, database roles, backup and recovery |

## Work-tracks (`work-tracks/`)

| Track                                                           | Title                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------- |
| [WT-01](work-tracks/WT-01-project-boilerplate.md)               | Project boilerplate                                     |
| [WT-02](work-tracks/WT-02-accounts-and-permissions.md)          | Accounts, human sign-in, roles and the permission layer |
| [WT-03](work-tracks/WT-03-board-core.md)                        | Board core: projects, teams, columns, epics, tasks      |
| [WT-04](work-tracks/WT-04-realtime-board-sync.md)               | Real-time board sync                                    |
| [WT-11](work-tracks/WT-11-mcp-server.md)                        | MCP server (outline)                                    |
| [WT-12](work-tracks/WT-12-operations.md)                        | Production deployment and operations                    |
| [WT-05](work-tracks/WT-05-agent-accounts-and-tokens.md)         | Agent accounts and API tokens                           |
| [WT-06](work-tracks/WT-06-bug-reports-and-triage.md)            | Bug reports and automated triage                        |
| [WT-13](work-tracks/WT-13-integrations.md)                      | Integrations (optional add-ons)                         |
| [WT-07](work-tracks/WT-07-backlog-priority-due-dates-labels.md) | Backlog, priority, due dates, labels                    |

Planned next, not yet drafted:

- WT-08 Search, filters, list view, activity timeline
- WT-09 Sub-tasks and task links
- WT-10 Sprints and story points

WT-07 to WT-10 come from canonical doc 0003; WT-07 is reserved above. WT-11, the MCP
server (doc 0005), is outlined above and comes after WT-06. WT-12, production deployment
and operations (doc 0006), came right after WT-04 and is done.

## Work-items (`work-items/`) and work-specs (`work-specs/`)

| Item                                                            | Title                                                             | Spec                                                            |
| --------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------- |
| [WI-001](work-items/WI-001-app-skeleton.md)                     | App skeleton: Next.js, strict TypeScript, Vitest                  | [WS-001](work-specs/WS-001-app-skeleton.md)                     |
| [WI-002](work-items/WI-002-lint-and-format.md)                  | ESLint and Prettier                                               | [WS-002](work-specs/WS-002-lint-and-format.md)                  |
| [WI-003](work-items/WI-003-validated-env.md)                    | Validated environment variables                                   | [WS-003](work-specs/WS-003-validated-env.md)                    |
| [WI-004](work-items/WI-004-database.md)                         | PostgreSQL, Drizzle and the integration test harness              | [WS-004](work-specs/WS-004-database.md)                         |
| [WI-005](work-items/WI-005-health-endpoint.md)                  | Health endpoint: the first vertical slice                         | [WS-005](work-specs/WS-005-health-endpoint.md)                  |
| [WI-006](work-items/WI-006-openapi.md)                          | OpenAPI document generated from Zod                               | [WS-006](work-specs/WS-006-openapi.md)                          |
| [WI-007](work-items/WI-007-e2e.md)                              | Playwright end-to-end tests                                       | [WS-007](work-specs/WS-007-e2e.md)                              |
| [WI-008](work-items/WI-008-ui-foundation.md)                    | UI foundation: Tailwind, shadcn/ui and the app shell              | [WS-008](work-specs/WS-008-ui-foundation.md)                    |
| [WI-009](work-items/WI-009-ci.md)                               | Continuous integration                                            | [WS-009](work-specs/WS-009-ci.md)                               |
| [WI-010](work-items/WI-010-contributor-docs.md)                 | Contributor docs: README and CONTRIBUTING                         | [WS-010](work-specs/WS-010-contributor-docs.md)                 |
| [WI-011](work-items/WI-011-api-foundations.md)                  | API foundations: errors, validation helpers, request id           | [WS-011](work-specs/WS-011-api-foundations.md)                  |
| [WI-012](work-items/WI-012-permissions-and-actor.md)            | Permission catalogue, human roles and the `Actor` type            | [WS-012](work-specs/WS-012-permissions-and-actor.md)            |
| [WI-013](work-items/WI-013-accounts-and-better-auth.md)         | Accounts, sessions schema and Better Auth                         | [WS-013](work-specs/WS-013-accounts-and-better-auth.md)         |
| [WI-014](work-items/WI-014-audit-log.md)                        | Audit log table and writer                                        | [WS-014](work-specs/WS-014-audit-log.md)                        |
| [WI-015](work-items/WI-015-sign-in-and-authentication.md)       | Sign-in, sign-out, me, authentication, limiter                    | [WS-015](work-specs/WS-015-sign-in-and-authentication.md)       |
| [WI-016](work-items/WI-016-first-run-setup.md)                  | First-run setup: create the first Admin                           | [WS-016](work-specs/WS-016-first-run-setup.md)                  |
| [WI-017](work-items/WI-017-sign-in-page-and-protected-shell.md) | Sign-in page, protected shell, account menu                       | [WS-017](work-specs/WS-017-sign-in-page-and-protected-shell.md) |
| [WI-018](work-items/WI-018-account-management-api.md)           | Account management API                                            | [WS-018](work-specs/WS-018-account-management-api.md)           |
| [WI-019](work-items/WI-019-accept-invitation-or-reset-link.md)  | Accept an invitation or reset link                                | [WS-019](work-specs/WS-019-accept-invitation-or-reset-link.md)  |
| [WI-020](work-items/WI-020-people-page.md)                      | Admin People page                                                 | [WS-020](work-specs/WS-020-people-page.md)                      |
| [WI-021](work-items/WI-021-own-profile.md)                      | Own profile: change name and password                             | [WS-021](work-specs/WS-021-own-profile.md)                      |
| [WI-022](work-items/WI-022-sign-in-hardening.md)                | Sign-in hardening: bounded audit and limiter growth               | [WS-022](work-specs/WS-022-sign-in-hardening.md)                |
| [WI-023](work-items/WI-023-api-guard-rails.md)                  | API guard rails: declared authentication, enforced checks         | [WS-023](work-specs/WS-023-api-guard-rails.md)                  |
| [WI-024](work-items/WI-024-revoke-invitation.md)                | Revoke an invitation that was never accepted                      | [WS-024](work-specs/WS-024-revoke-invitation.md)                |
| [WI-025](work-items/WI-025-route-declares-access.md)            | `route()` declares authentication and permission                  | [WS-025](work-specs/WS-025-route-declares-access.md)            |
| [WI-026](work-items/WI-026-teams-and-people.md)                 | Teams, membership and the people directory                        | [WS-026](work-specs/WS-026-teams-and-people.md)                 |
| [WI-027](work-items/WI-027-positions-and-version-conflict.md)   | Fractional positions and the `version_conflict` response          | [WS-027](work-specs/WS-027-positions-and-version-conflict.md)   |
| [WI-028](work-items/WI-028-projects-and-default-columns.md)     | Projects with default columns                                     | [WS-028](work-specs/WS-028-projects-and-default-columns.md)     |
| [WI-029](work-items/WI-029-columns-api.md)                      | Columns API                                                       | [WS-029](work-specs/WS-029-columns-api.md)                      |
| [WI-030](work-items/WI-030-tasks-core.md)                       | Tasks core                                                        | [WS-030](work-specs/WS-030-tasks-core.md)                       |
| [WI-031](work-items/WI-031-move-task.md)                        | Move a task between and within columns                            | [WS-031](work-specs/WS-031-move-task.md)                        |
| [WI-032](work-items/WI-032-delete-and-restore-task.md)          | Delete and restore a task                                         | [WS-032](work-specs/WS-032-delete-and-restore-task.md)          |
| [WI-033](work-items/WI-033-epics.md)                            | Epics                                                             | [WS-033](work-specs/WS-033-epics.md)                            |
| [WI-034](work-items/WI-034-comments.md)                         | Comments                                                          | [WS-034](work-specs/WS-034-comments.md)                         |
| [WI-035](work-items/WI-035-teams-page.md)                       | Teams page                                                        | [WS-035](work-specs/WS-035-teams-page.md)                       |
| [WI-036](work-items/WI-036-projects-pages.md)                   | Projects list, navigation and project settings                    | [WS-036](work-specs/WS-036-projects-pages.md)                   |
| [WI-037](work-items/WI-037-board-page.md)                       | Board page: columns, cards, create a task, drag and drop          | [WS-037](work-specs/WS-037-board-page.md)                       |
| [WI-038](work-items/WI-038-task-detail.md)                      | Task detail: fields, Markdown, assignment, comments, delete       | [WS-038](work-specs/WS-038-task-detail.md)                      |
| [WI-039](work-items/WI-039-epics-page.md)                       | Epics page: list, create, edit, close, progress                   | [WS-039](work-specs/WS-039-epics-page.md)                       |
| [WI-040](work-items/WI-040-account-link-hardening.md)           | Account link hardening                                            | [WS-040](work-specs/WS-040-account-link-hardening.md)           |
| [WI-041](work-items/WI-041-security-headers.md)                 | Security headers and Content Security Policy                      | [WS-041](work-specs/WS-041-security-headers.md)                 |
| [WI-042](work-items/WI-042-safe-error-logging.md)               | Safe error logging                                                | [WS-042](work-specs/WS-042-safe-error-logging.md)               |
| [WI-043](work-items/WI-043-setup-refuses-before-hashing.md)     | First-run setup refuses before hashing                            | [WS-043](work-specs/WS-043-setup-refuses-before-hashing.md)     |
| [WI-044](work-items/WI-044-request-body-limit.md)               | Request body size limit                                           | [WS-044](work-specs/WS-044-request-body-limit.md)               |
| [WI-045](work-items/WI-045-event-contract-and-publishing.md)    | Event contract and publishing                                     | [WS-045](work-specs/WS-045-event-contract-and-publishing.md)    |
| [WI-046](work-items/WI-046-event-hub.md)                        | Event hub                                                         | [WS-046](work-specs/WS-046-event-hub.md)                        |
| [WI-047](work-items/WI-047-events-endpoint.md)                  | Events endpoint                                                   | [WS-047](work-specs/WS-047-events-endpoint.md)                  |
| [WI-048](work-items/WI-048-live-board.md)                       | Live board                                                        | [WS-048](work-specs/WS-048-live-board.md)                       |
| [WI-049](work-items/WI-049-live-detail-epics-settings.md)       | Live task detail, epics page and project settings                 | [WS-049](work-specs/WS-049-live-detail-epics-settings.md)       |
| [WI-050](work-items/WI-050-setup-token.md)                      | Optional setup token for the first-run setup                      | [WS-050](work-specs/WS-050-setup-token.md)                      |
| [WI-051](work-items/WI-051-cursor-date-validation.md)           | Creation-time cursors are checked as dates                        | [WS-051](work-specs/WS-051-cursor-date-validation.md)           |
| [WI-052](work-items/WI-052-e2e-admin-isolation.md)              | End-to-end tests do not deactivate each other's Admins            | [WS-052](work-specs/WS-052-e2e-admin-isolation.md)              |
| [WI-053](work-items/WI-053-esbuild-advisory.md)                 | No vulnerable esbuild in the dependency tree                      | [WS-053](work-specs/WS-053-esbuild-advisory.md)                 |
| [WI-054](work-items/WI-054-e2e-parallel-stability.md)           | A keyboard move lands where announced; stable parallel E2E        | [WS-054](work-specs/WS-054-e2e-parallel-stability.md)           |
| [WI-055](work-items/WI-055-setup-fail-closed.md)                | Production setup requires a setup token                           | [WS-055](work-specs/WS-055-setup-fail-closed.md)                |
| [WI-056](work-items/WI-056-hashing-concurrency.md)              | Password hashing cannot starve the server                         | [WS-056](work-specs/WS-056-hashing-concurrency.md)              |
| [WI-057](work-items/WI-057-committed-password-recovery.md)      | A set password is never reported as a failure                     | [WS-057](work-specs/WS-057-committed-password-recovery.md)      |
| [WI-058](work-items/WI-058-session-audit-atomicity.md)          | A session change and its audit entry stand or fall together       | [WS-058](work-specs/WS-058-session-audit-atomicity.md)          |
| [WI-059](work-items/WI-059-link-lifecycle-locks.md)             | One unused link per account, under one lock order                 | [WS-059](work-specs/WS-059-link-lifecycle-locks.md)             |
| [WI-060](work-items/WI-060-portable-formatting.md)              | The formatting gate passes on every checkout                      | [WS-060](work-specs/WS-060-portable-formatting.md)              |
| [WI-061](work-items/WI-061-picomatch-advisory.md)               | Triage of the picomatch advisory, with no fix published           | [WS-061](work-specs/WS-061-picomatch-advisory.md)               |
| [WI-062](work-items/WI-062-production-image.md)                 | Production image, example Compose file and `migrate`              | [WS-062](work-specs/WS-062-production-image.md)                 |
| [WI-063](work-items/WI-063-database-roles.md)                   | An owner role for migrations, a least-privilege role for the app  | [WS-063](work-specs/WS-063-database-roles.md)                   |
| [WI-064](work-items/WI-064-schema-check.md)                     | The app refuses to start on a schema it does not match            | [WS-064](work-specs/WS-064-schema-check.md)                     |
| [WI-065](work-items/WI-065-recover-admin.md)                    | `recover-admin`: an operator command to get back in               | [WS-065](work-specs/WS-065-recover-admin.md)                    |
| [WI-066](work-items/WI-066-maintenance.md)                      | `maintenance`: remove what has expired                            | [WS-066](work-specs/WS-066-maintenance.md)                      |
| [WI-067](work-items/WI-067-https-and-proxy.md)                  | HSTS on `https:` installs, and the reverse proxy, tested          | [WS-067](work-specs/WS-067-https-and-proxy.md)                  |
| [WI-068](work-items/WI-068-backup-rehearsal.md)                 | Backup and restore, rehearsed in CI                               | [WS-068](work-specs/WS-068-backup-rehearsal.md)                 |
| [WI-069](work-items/WI-069-safe-logs.md)                        | No request data in the logs when a query fails                    | [WS-069](work-specs/WS-069-safe-logs.md)                        |
| [WI-070](work-items/WI-070-operations-guide.md)                 | The operations guide, `docs/operations.md`                        | [WS-070](work-specs/WS-070-operations-guide.md)                 |
| [WI-071](work-items/WI-071-agent-data-model.md)                 | Agent accounts in the data model, and the agent `Actor`           | [WS-071](work-specs/WS-071-agent-data-model.md)                 |
| [WI-072](work-items/WI-072-api-tokens.md)                       | API tokens, and `authenticate()` accepting them                   | [WS-072](work-specs/WS-072-api-tokens.md)                       |
| [WI-073](work-items/WI-073-project-restrictions.md)             | Project restrictions enforced in every service                    | [WS-073](work-specs/WS-073-project-restrictions.md)             |
| [WI-074](work-items/WI-074-agent-badge.md)                      | Agents where humans see them: the "Agent" badge                   | [WS-074](work-specs/WS-074-agent-badge.md)                      |
| [WI-075](work-items/WI-075-agents-admin-api.md)                 | The Admin API for agents and their tokens                         | [WS-075](work-specs/WS-075-agents-admin-api.md)                 |
| [WI-076](work-items/WI-076-me-for-agents.md)                    | `GET /me` for agents                                              | [WS-076](work-specs/WS-076-me-for-agents.md)                    |
| [WI-077](work-items/WI-077-agents-page.md)                      | The Agents page                                                   | [WS-077](work-specs/WS-077-agents-page.md)                      |
| [WI-078](work-items/WI-078-agent-flow-and-guide.md)             | The agent flow end to end, and the agents guide                   | [WS-078](work-specs/WS-078-agent-flow-and-guide.md)             |
| [WI-079](work-items/WI-079-production-secrets-split.md)         | Each production service gets only the secrets it needs            | [WS-079](work-specs/WS-079-production-secrets-split.md)         |
| [WI-080](work-items/WI-080-lists-without-duplicates.md)         | Paged lists never show a row twice                                | [WS-080](work-specs/WS-080-lists-without-duplicates.md)         |
| [WI-081](work-items/WI-081-name-cursor-length.md)               | Name cursors fit the longest name they carry                      | [WS-081](work-specs/WS-081-name-cursor-length.md)               |
| [WI-082](work-items/WI-082-board-reload-ordering.md)            | The board applies only the latest load, never during a move       | [WS-082](work-specs/WS-082-board-reload-ordering.md)            |
| [WI-083](work-items/WI-083-documented-responses.md)             | Every response the API sends is documented                        | [WS-083](work-specs/WS-083-documented-responses.md)             |
| [WI-084](work-items/WI-084-agents-link-assertion-scope.md)      | The Manager's Agents-link check looks only at the sidebar         | [WS-084](work-specs/WS-084-agents-link-assertion-scope.md)      |
| [WI-085](work-items/WI-085-nav-link-assertion-scope.md)         | Absent-link assertions are scoped to their navigation             | [WS-085](work-specs/WS-085-nav-link-assertion-scope.md)         |
| [WI-086](work-items/WI-086-triage-data-model.md)                | The data model of bug reports and triage                          | [WS-086](work-specs/WS-086-triage-data-model.md)                |
| [WI-087](work-items/WI-087-triage-settings-api.md)              | The triage settings API                                           | [WS-087](work-specs/WS-087-triage-settings-api.md)              |
| [WI-088](work-items/WI-088-task-severity.md)                    | Severity on tasks                                                 | [WS-088](work-specs/WS-088-task-severity.md)                    |
| [WI-089](work-items/WI-089-bug-report-pipeline.md)              | The bug report endpoint and the triage pipeline                   | [WS-089](work-specs/WS-089-bug-report-pipeline.md)              |
| [WI-090](work-items/WI-090-reading-bug-reports.md)              | Reading the reports behind a task, and its regression links       | [WS-090](work-specs/WS-090-reading-bug-reports.md)              |
| [WI-091](work-items/WI-091-bugs-in-the-ui.md)                   | Bugs in the UI                                                    | [WS-091](work-specs/WS-091-bugs-in-the-ui.md)                   |
| [WI-092](work-items/WI-092-triage-section.md)                   | The project's "Triage" settings section                           | [WS-092](work-specs/WS-092-triage-section.md)                   |
| [WI-093](work-items/WI-093-posthog-addon.md)                    | Optional PostHog add-on: error-tracking issues become bug reports | [WS-093](work-specs/WS-093-posthog-addon.md)                    |
| [WI-094](work-items/WI-094-triage-flow-and-guide.md)            | The triage flow end to end, the agents' guide, WT-06's amendments | [WS-094](work-specs/WS-094-triage-flow-and-guide.md)            |
| [WI-095](work-items/WI-095-worktree-test-isolation.md)          | Parallel worktrees can run the quality gate at the same time      | —                                                               |
| [WI-096](work-items/WI-096-parallel-merge-flow.md)              | Parallel work-items merge without renumbering or index conflicts  | [WS-096](work-specs/WS-096-parallel-merge-flow.md)              |
| [WI-097](work-items/WI-097-faster-vitest-suite.md)              | A faster unit and integration suite                               | —                                                               |
| [WI-098](work-items/WI-098-keyboard-move-subpixel.md)           | A keyboard move works while the board is still animating          | [WS-098](work-specs/WS-098-keyboard-move-subpixel.md)           |
| [WI-099](work-items/WI-099-mcp-server-skeleton.md)              | The MCP server starts over stdio and answers opanel_whoami        | [WS-099](work-specs/WS-099-mcp-server-skeleton.md)              |
| [WI-100](work-items/WI-100-mcp-read-tools.md)                   | The MCP read tools: projects, board, teams, people and a task     | [WS-100](work-specs/WS-100-mcp-read-tools.md)                   |

## Follow-ups

Deferred decisions that need a work-item before they are acted on.

Planning gaps found in the review of 2026-11-12. Each needs an owner decision:

- **Answered by WI-065 (2026-11-18): no way back in if the only Admin lost their
  password.** An operator on the server runs `recover-admin --email <admin email>`, which
  prints a one-time link for that Admin (`docs/operations.md`, "Recovering the last Admin").
- **An email can be neither corrected nor freed** once its invitation was accepted. An
  invitation that was never accepted can now be revoked, which frees its email (WI-024).
  Changing the email of an account that has signed in remains undecided.
- **Answered by WT-12 (2026-11-19): no work-track covered production deployment.** The
  image, the example install and `docs/operations.md` (WI-062 to WI-070) answer it: the
  reverse proxy, HTTPS and `Strict-Transport-Security`, `CLIENT_IP_HEADER`, the 512 KiB
  request body, and log contents, access and retention are each a section of the guide.

Other follow-ups:

- **The board can load too slowly after a reload on a cold test server** (WI-098, WS-098
  section 4). Locally, with 4 workers on a freshly started `next start`, `board.spec.ts`'s
  keyboard test failed 4 of 20 at `expect.poll` after `page.reload()`: the board was still
  loading after 5 s (`/api/v1/me` took 2.4 to 3 s). CI never showed it. Needs a work-item
  if it recurs: a warm-up before the suite, or a longer wait after a reload.

- **WT-10 places agent-filed bugs at the top of the backlog in sprint projects** (doc 0003
  section 13, question 1; WT-06 decision 7). Today a new bug goes to the top of the first
  column. WT-10's work-spec changes `placeNewBug` in `src/server/services/bug-reports.ts`,
  the one function that decides it, and nothing else in the pipeline (WI-094).

- Send one real PostHog error-tracking alert, with a body from `addons/posthog/bodies/`, to
  a local Opanel through a tunnel, and record the answer in WS-093 (the manual check of
  WS-093 section 4, deferred by the owner on 2026-11-20: no PostHog project yet).

- **Answered by WI-084 (2026-11-19):** `tests/e2e/agents.spec.ts`, "a Manager has neither
  the Agents link nor the page", counted every link whose name contains "Agents" (found in
  WI-081). It now looks at the sidebar only.

- `bug_reports` grows with every report, repeats included (WT-06 question 6, WS-089). Add
  it to the tables that grow in `docs/operations.md`, and let `maintenance` thin old
  repeats if installs need it.

- Let end-to-end runs choose their port and database (`E2E_PORT`, already
  `E2E_DATABASE_URL`), so that parallel sessions can each run Playwright: today port 3100
  is fixed and a second run tests the first one's server (found in WI-072). To be answered by
  WI-095.

- Lower findings of the development-flow review of 2026-11-20, each needing a work-item:
  - D08: most service SQL is raw `sql` strings (185 calls against 64 query-builder
    calls) with hand-written row types, so a renamed column passes `tsc` and fails only
    in integration tests. Prefer the Drizzle builder, or `${table.column}`, in new code.
  - D09: `AGENTS.md` section 3 says only services import the DB client, but
    `src/server/auth/auth.ts`, `src/server/auth/authenticate.ts` and the health route do.
    Write the exception down or move the code (hard rule 11).
  - D10: shared helpers copied across files: `ISO_MS` in 9 services; `failure`,
    `withCookie` and `cookieFor` in 8 to 18 integration test files.
  - D11: deleting a column moves its tasks with two queries per task
    (`columns.ts:338-350`); a token request makes five sequential queries, repeated on
    every SSE heartbeat (`authenticate.ts:99-130`).
  - D12: `pnpm lint` takes about 120 s locally (measure the type-aware rules with
    `TIMING=1`, try `--cache`), and each end-to-end run does a full `next build`.

- Rehearse a real upgrade, by `docs/operations.md`, from the first tagged release to the
  next, and add it to the image workflow (WS-068 question 4, WS-070). Until then WT-12's
  upgrade criterion rests on each migration being tested against the earlier ones and on
  the schema check.

- Give WS-009, WS-010 and WS-012 the "Implementation record" and "Deviations" sections that
  every other finished work-spec has (audit of 2026-11-13). Format only.

- Make `pnpm typecheck` independent of a stale `.next` directory (for example by
  generating route types first). Until then see the note in `CONTRIBUTING.md`.
- The activity timeline (WT-08) returns each event's actor as `AccountRef` and renders it
  with `AccountName`, so agents carry the "Agent" badge there too (WS-074 section 6). The
  reporter of a bug report (WT-06) is the task's `reporter`, already an `AccountRef`.
- Add a browsable API documentation page once there are real endpoints (see WS-006).
- Give the shared `destructive` button style enough contrast in light mode: red text on its
  pale red background is 4:1, below the 4.5:1 of WCAG AA (found by axe in WI-035). It
  affects the confirmation buttons of the People and Teams pages; the Agents page avoids it
  (WS-077, deviation 2).
- **Answered by WI-083 (2026-11-19): document every `409` of the operations that check
  `version`** (WS-036, question 4). The six versioned writes document `anyOf` their
  version conflict and `Problem`, and name each other code they answer.
- The project settings dialogs (Add column, Edit column) have no `DialogTrigger`, so on
  close Radix moves the focus to the page body instead of the button that opened them
  (seen in a browser while checking WI-037; the board's "Add task" dialog returns it
  explicitly, see WS-037 "Deviations"). Needs its own work-item.
- Delete the superseded remote branches `claude/wi-038-task-detail`,
  `claude/wi-038-task-detail-spec` and `claude/wi-041-security-headers` (owner's decision
  in WS-038, question 6), `claude/wi-044-request-body-limit` (WS-044, question 5) and
  `claude/wi-042-safe-error-logging` (WS-042, question 4) and
  `claude/wi-043-setup-refuses-before-hashing` and
  `claude/wi-043-setup-refuses-before-hashing-v2` (WS-043, question 5).
- Upgrade drizzle-kit to 1.0 once it is stable (it drops the deprecated `@esbuild-kit`
  packages), then delete the esbuild override in `pnpm-workspace.yaml` (WS-053,
  question 2).
- `pnpm audit` without `--prod` reports GHSA-g3hv-75wg-m249 (`minimatch`, a denial of
  service, under `eslint`), a development dependency (found in WI-053). Decide whether
  development advisories are audited too.
- Create the first Admin through a command run on the server instead of the public setup
  page, a candidate for the production deployment track (WS-055, question 3). It belongs
  with the last-Admin recovery command above.
- Upgrade Node.js from 22 to 24 LTS (`engines`, `.nvmrc`, `@types/node`, CI).
- Upgrade pnpm from 10 to 12 (`packageManager`, CI).
- Upgrade Playwright from 1.63.0 to the latest release (see WS-007).
- Add Firefox and WebKit to the end-to-end tests once there is real UI to protect.
- Return from TypeScript 6.0 to 7 once `typescript-eslint` supports it (see WS-002).
- **Answered by WI-080 (2026-11-19): the People page could show an account twice.** An
  invitation finished while the first page loaded was appended by a handler that still saw
  no cursor, and "Load more" returned it again (audit finding B02). Every paged list now
  shows each item once (`usePagedList`), and `people.spec.ts` reproduces the race.

Lower findings of the audit of 2026-11-19, each to become a work-item when the owner
chooses. B01 to B05 are WI-079 to WI-083.

- B06: the event stream's heartbeat check refreshes the session (Better Auth extends a
  session older than `updateAge` on each `getSession`), so an open board tab keeps its
  session from expiring. Pass `disableRefresh` on the heartbeat's check
  (`src/server/http/event-stream.ts`, `src/server/auth/authenticate.ts`).
- B07: failed bearer-token attempts are not rate limited (the per-token limiter runs after
  authentication), and the example Caddyfile adds no limit, although WS-072 hands
  unauthenticated limiting to the proxy. Add a per-IP limit for failed token
  authentication, or a limit in the example proxy and `docs/operations.md`.
- B08 (owner decision): an Admin can issue a reset link for another, active Admin and sign
  in as them. It is audited (`account.reset_link_created` with the issuer as actor).
  Decide whether the API should refuse Admin targets, leaving `recover-admin` as the way.
- B09: `postgres:18-alpine` is a floating tag in `compose.production.yaml` and
  `compose.yaml`, while the Node and Caddy images are pinned by digest. Pin it in the
  production file, and say how to upgrade it in `docs/operations.md`.
- B10: `engines.node` is `>=22` but CI, `.nvmrc` and the image use 22, and Node 25 no
  longer bundles corepack, which the `Dockerfile` uses. Narrow it to `^22` until the
  Node 24 upgrade above.
- B11: fixed waits in tests: `settle()` in `tests/e2e/board.spec.ts` waits 200 ms, and
  `scripts/smoke-production.sh` uses `sleep 1` with second-precision `logs --since`. Wait
  on a condition instead. CI also retries end-to-end tests once without reporting flaky
  ones (`playwright.config.ts`).
- B12: `eslint.config.mjs` does not ignore `playwright-report/`, `test-results/` and
  `blob-report/`.
- B13: migration `0014_runtime_role.sql` relies on PostgreSQL 15 or later not granting
  `CREATE` on `public` to `PUBLIC`. Revoke it explicitly, or name 15 as the minimum.
- B14: answered by WI-083 (2026-11-19): `docs/agents.md` lists `409 account_inactive` and
  `429 too_many_streams`, and doc 0004 sections 4 to 6 are corrected.
- B15: the project frame applies project updates without a version check
  (`project-events.tsx`, `board.tsx`), and the board shows no "paused" banner while the
  browser retries the stream on its own (`use-project-events.ts`). One small item (WS-082,
  question 4); the version check of the task detail's changes in `use-board.ts` is done
  (WI-082). Seen once in a full E2E run of WI-080: `projects.spec.ts:34` showed "Someone
  else changed this project" after the Manager's own save; it passed on every rerun.
- A card refresh already in flight when a drag starts can still change the board under
  the drag; only the moved card is corrected after the move (WS-082, question 3).
- B16: a local run of `pnpm test` fails when another PostgreSQL holds port 5432: the
  Compose file honours `OPANEL_DB_PORT` but `.env.test` always names 5432. Belongs with the
  `E2E_PORT` follow-up above.

Optimisations found by the same audit, none urgent:

- Board: nothing is memoised and the React Compiler is off, so every cross-column
  `onDragOver` re-renders every card; the first load is a waterfall (project, then the
  stream, then columns and task pages in turn); `react-markdown` loads eagerly.
- Database: `listTasks` orders across a join and cannot use an index; no index on
  `tasks.reporter_account_id`, `tasks.deleted_by`, `task_events.actor_account_id`,
  `comments.author_account_id`, `credentials.account_id`, `sessions.expires_at`; each task
  write runs the six-join task select two or three times.
- Position keys grow by a character about every six moves into the same gap and are never
  renumbered. A board cursor carries two positions and must fit the `cursor` parameter
  (2048 characters since WI-081), so after several thousand such moves "Load more" on that
  column fails with `400` (WS-081, question 3).
- CI: one serial job; Playwright browsers and `.next/cache` are not cached; the image build
  has no BuildKit cache.
