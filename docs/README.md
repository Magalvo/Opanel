# Opanel docs index

The spec system is described in `AGENTS.md` section 4. This file is the index: every doc is
listed here with its current status. Update it whenever a doc is added or changes status.

Statuses: `Draft` → `Proposed` → `Approved` → `In progress` → `Done` (or `Superseded`).

## Where the project stands

Updated at the end of every work-item, so that a new session can start from here.

- **Last finished:** WI-047 (events endpoint), on 2026-11-17, on the branch
  `claude/dreamy-pasteur-fdl401` (WI-046 was merged in PR #43).
- **Next:** draft WI-048 (live board) and WS-048 as `Proposed`, and stop for the owner's
  approval.
- **Approved on 2026-11-16:** WT-04 (real-time board sync), including its amendment to
  canonical doc 0002 (two new event types, `projectId` and `taskId` in events), which
  WI-045 writes into the doc.
- **Approved on 2026-11-17:** amendment A1 to WT-04, the optional `SETUP_TOKEN` for the
  first-run setup as WI-050 (owner's decision in WS-043, question 2), done first in the
  track.
- **Approved on 2026-11-16:** canonical doc 0005 (MCP server) and the outline of WT-11,
  which starts after WT-06.
- **Also finished:** WI-051 (cursor date validation, audit of 2026-11-17, finding A08), on
  2026-11-17, on the branch `claude/wi-051-cursor-validation`.
- **Also finished:** WI-052 (end-to-end Admin isolation, audit of 2026-11-17, finding A09),
  on 2026-11-17, on the branch `claude/wi-052-e2e-isolation`, stacked on WI-051.
- **Also finished:** WI-054 (a keyboard move lands where it was announced, and the
  end-to-end suite is stable in parallel), on 2026-11-17, on the branch
  `claude/wi-054-e2e-parallel-stability`, stacked on WI-052.
- **Also finished:** WI-053 (esbuild advisory, audit of 2026-11-17, finding A11), on
  2026-11-17, on the branch `claude/wi-053-esbuild-advisory`.
- **Also finished:** WI-055 (production setup requires a setup token, audit of 2026-11-17,
  finding A02; amends WT-04 decision 13), on 2026-11-17, on the branch
  `claude/wi-055-setup-fail-closed`.
- **Also finished:** WI-056 (bounded password hashing, audit of 2026-11-17, finding A03),
  on 2026-11-17, on the branch `claude/wi-056-hashing-concurrency`.
- **Planning gaps awaiting an owner decision** are listed first under
  [Follow-ups](#follow-ups).

## Canonical docs (`canonical/`)

| Doc                                               | Title                                                       | Status   |
| ------------------------------------------------- | ----------------------------------------------------------- | -------- |
| [0001](canonical/0001-ai-qa-agents-and-triage.md) | AI QA agents: identity, authentication and automated triage | Approved |
| [0002](canonical/0002-realtime-sync.md)           | Real-time board sync                                        | Approved |
| [0003](canonical/0003-task-management.md)         | Task management: roles, tickets, boards and planning        | Approved |
| [0004](canonical/0004-api-conventions.md)         | API conventions                                             | Approved |
| [0005](canonical/0005-mcp-server.md)              | MCP server: Opanel as tools for AI assistants               | Approved |

## Work-tracks (`work-tracks/`)

| Track                                                  | Title                                                   | Status   |
| ------------------------------------------------------ | ------------------------------------------------------- | -------- |
| [WT-01](work-tracks/WT-01-project-boilerplate.md)      | Project boilerplate                                     | Done     |
| [WT-02](work-tracks/WT-02-accounts-and-permissions.md) | Accounts, human sign-in, roles and the permission layer | Done     |
| [WT-03](work-tracks/WT-03-board-core.md)               | Board core: projects, teams, columns, epics, tasks      | Done     |
| [WT-04](work-tracks/WT-04-realtime-board-sync.md)      | Real-time board sync                                    | Approved |
| [WT-11](work-tracks/WT-11-mcp-server.md)               | MCP server (outline)                                    | Approved |

Planned next, not yet drafted:

- WT-05 Agent accounts and API tokens
- WT-06 Bug reports and automated triage
- WT-07 Backlog, priority, due dates, labels
- WT-08 Search, filters, list view, activity timeline
- WT-09 Sub-tasks and task links
- WT-10 Sprints and story points

WT-07 to WT-10 come from canonical doc 0003. WT-11, the MCP server (doc 0005), is outlined
above and comes after WT-06.

## Work-items (`work-items/`) and work-specs (`work-specs/`)

| Item                                                            | Title                                                       | Item status | Spec                                                            | Spec status |
| --------------------------------------------------------------- | ----------------------------------------------------------- | ----------- | --------------------------------------------------------------- | ----------- |
| [WI-001](work-items/WI-001-app-skeleton.md)                     | App skeleton: Next.js, strict TypeScript, Vitest            | Done        | [WS-001](work-specs/WS-001-app-skeleton.md)                     | Done        |
| [WI-002](work-items/WI-002-lint-and-format.md)                  | ESLint and Prettier                                         | Done        | [WS-002](work-specs/WS-002-lint-and-format.md)                  | Done        |
| [WI-003](work-items/WI-003-validated-env.md)                    | Validated environment variables                             | Done        | [WS-003](work-specs/WS-003-validated-env.md)                    | Done        |
| [WI-004](work-items/WI-004-database.md)                         | PostgreSQL, Drizzle and the integration test harness        | Done        | [WS-004](work-specs/WS-004-database.md)                         | Done        |
| [WI-005](work-items/WI-005-health-endpoint.md)                  | Health endpoint: the first vertical slice                   | Done        | [WS-005](work-specs/WS-005-health-endpoint.md)                  | Done        |
| [WI-006](work-items/WI-006-openapi.md)                          | OpenAPI document generated from Zod                         | Done        | [WS-006](work-specs/WS-006-openapi.md)                          | Done        |
| [WI-007](work-items/WI-007-e2e.md)                              | Playwright end-to-end tests                                 | Done        | [WS-007](work-specs/WS-007-e2e.md)                              | Done        |
| [WI-008](work-items/WI-008-ui-foundation.md)                    | UI foundation: Tailwind, shadcn/ui and the app shell        | Done        | [WS-008](work-specs/WS-008-ui-foundation.md)                    | Done        |
| [WI-009](work-items/WI-009-ci.md)                               | Continuous integration                                      | Done        | [WS-009](work-specs/WS-009-ci.md)                               | Done        |
| [WI-010](work-items/WI-010-contributor-docs.md)                 | Contributor docs: README and CONTRIBUTING                   | Done        | [WS-010](work-specs/WS-010-contributor-docs.md)                 | Done        |
| [WI-011](work-items/WI-011-api-foundations.md)                  | API foundations: errors, validation helpers, request id     | Done        | [WS-011](work-specs/WS-011-api-foundations.md)                  | Done        |
| [WI-012](work-items/WI-012-permissions-and-actor.md)            | Permission catalogue, human roles and the `Actor` type      | Done        | [WS-012](work-specs/WS-012-permissions-and-actor.md)            | Done        |
| [WI-013](work-items/WI-013-accounts-and-better-auth.md)         | Accounts, sessions schema and Better Auth                   | Done        | [WS-013](work-specs/WS-013-accounts-and-better-auth.md)         | Done        |
| [WI-014](work-items/WI-014-audit-log.md)                        | Audit log table and writer                                  | Done        | [WS-014](work-specs/WS-014-audit-log.md)                        | Done        |
| [WI-015](work-items/WI-015-sign-in-and-authentication.md)       | Sign-in, sign-out, me, authentication, limiter              | Done        | [WS-015](work-specs/WS-015-sign-in-and-authentication.md)       | Done        |
| [WI-016](work-items/WI-016-first-run-setup.md)                  | First-run setup: create the first Admin                     | Done        | [WS-016](work-specs/WS-016-first-run-setup.md)                  | Done        |
| [WI-017](work-items/WI-017-sign-in-page-and-protected-shell.md) | Sign-in page, protected shell, account menu                 | Done        | [WS-017](work-specs/WS-017-sign-in-page-and-protected-shell.md) | Done        |
| [WI-018](work-items/WI-018-account-management-api.md)           | Account management API                                      | Done        | [WS-018](work-specs/WS-018-account-management-api.md)           | Done        |
| [WI-019](work-items/WI-019-accept-invitation-or-reset-link.md)  | Accept an invitation or reset link                          | Done        | [WS-019](work-specs/WS-019-accept-invitation-or-reset-link.md)  | Done        |
| [WI-020](work-items/WI-020-people-page.md)                      | Admin People page                                           | Done        | [WS-020](work-specs/WS-020-people-page.md)                      | Done        |
| [WI-021](work-items/WI-021-own-profile.md)                      | Own profile: change name and password                       | Done        | [WS-021](work-specs/WS-021-own-profile.md)                      | Done        |
| [WI-022](work-items/WI-022-sign-in-hardening.md)                | Sign-in hardening: bounded audit and limiter growth         | Done        | [WS-022](work-specs/WS-022-sign-in-hardening.md)                | Done        |
| [WI-023](work-items/WI-023-api-guard-rails.md)                  | API guard rails: declared authentication, enforced checks   | Done        | [WS-023](work-specs/WS-023-api-guard-rails.md)                  | Done        |
| [WI-024](work-items/WI-024-revoke-invitation.md)                | Revoke an invitation that was never accepted                | Done        | [WS-024](work-specs/WS-024-revoke-invitation.md)                | Done        |
| [WI-025](work-items/WI-025-route-declares-access.md)            | `route()` declares authentication and permission            | Done        | [WS-025](work-specs/WS-025-route-declares-access.md)            | Done        |
| [WI-026](work-items/WI-026-teams-and-people.md)                 | Teams, membership and the people directory                  | Done        | [WS-026](work-specs/WS-026-teams-and-people.md)                 | Done        |
| [WI-027](work-items/WI-027-positions-and-version-conflict.md)   | Fractional positions and the `version_conflict` response    | Done        | [WS-027](work-specs/WS-027-positions-and-version-conflict.md)   | Done        |
| [WI-028](work-items/WI-028-projects-and-default-columns.md)     | Projects with default columns                               | Done        | [WS-028](work-specs/WS-028-projects-and-default-columns.md)     | Done        |
| [WI-029](work-items/WI-029-columns-api.md)                      | Columns API                                                 | Done        | [WS-029](work-specs/WS-029-columns-api.md)                      | Done        |
| [WI-030](work-items/WI-030-tasks-core.md)                       | Tasks core                                                  | Done        | [WS-030](work-specs/WS-030-tasks-core.md)                       | Done        |
| [WI-031](work-items/WI-031-move-task.md)                        | Move a task between and within columns                      | Done        | [WS-031](work-specs/WS-031-move-task.md)                        | Done        |
| [WI-032](work-items/WI-032-delete-and-restore-task.md)          | Delete and restore a task                                   | Done        | [WS-032](work-specs/WS-032-delete-and-restore-task.md)          | Done        |
| [WI-033](work-items/WI-033-epics.md)                            | Epics                                                       | Done        | [WS-033](work-specs/WS-033-epics.md)                            | Done        |
| [WI-034](work-items/WI-034-comments.md)                         | Comments                                                    | Done        | [WS-034](work-specs/WS-034-comments.md)                         | Done        |
| [WI-035](work-items/WI-035-teams-page.md)                       | Teams page                                                  | Done        | [WS-035](work-specs/WS-035-teams-page.md)                       | Done        |
| [WI-036](work-items/WI-036-projects-pages.md)                   | Projects list, navigation and project settings              | Done        | [WS-036](work-specs/WS-036-projects-pages.md)                   | Done        |
| [WI-037](work-items/WI-037-board-page.md)                       | Board page: columns, cards, create a task, drag and drop    | Done        | [WS-037](work-specs/WS-037-board-page.md)                       | Done        |
| [WI-038](work-items/WI-038-task-detail.md)                      | Task detail: fields, Markdown, assignment, comments, delete | Done        | [WS-038](work-specs/WS-038-task-detail.md)                      | Done        |
| [WI-039](work-items/WI-039-epics-page.md)                       | Epics page: list, create, edit, close, progress             | Done        | [WS-039](work-specs/WS-039-epics-page.md)                       | Done        |
| [WI-040](work-items/WI-040-account-link-hardening.md)           | Account link hardening                                      | Done        | [WS-040](work-specs/WS-040-account-link-hardening.md)           | Done        |
| [WI-041](work-items/WI-041-security-headers.md)                 | Security headers and Content Security Policy                | Done        | [WS-041](work-specs/WS-041-security-headers.md)                 | Done        |
| [WI-042](work-items/WI-042-safe-error-logging.md)               | Safe error logging                                          | Done        | [WS-042](work-specs/WS-042-safe-error-logging.md)               | Done        |
| [WI-043](work-items/WI-043-setup-refuses-before-hashing.md)     | First-run setup refuses before hashing                      | Done        | [WS-043](work-specs/WS-043-setup-refuses-before-hashing.md)     | Done        |
| [WI-044](work-items/WI-044-request-body-limit.md)               | Request body size limit                                     | Done        | [WS-044](work-specs/WS-044-request-body-limit.md)               | Done        |
| [WI-045](work-items/WI-045-event-contract-and-publishing.md)    | Event contract and publishing                               | Done        | [WS-045](work-specs/WS-045-event-contract-and-publishing.md)    | Done        |
| [WI-046](work-items/WI-046-event-hub.md)                        | Event hub                                                   | Done        | [WS-046](work-specs/WS-046-event-hub.md)                        | Done        |
| [WI-047](work-items/WI-047-events-endpoint.md)                  | Events endpoint                                             | Done        | [WS-047](work-specs/WS-047-events-endpoint.md)                  | Done        |
| [WI-050](work-items/WI-050-setup-token.md)                      | Optional setup token for the first-run setup                | Done        | [WS-050](work-specs/WS-050-setup-token.md)                      | Done        |
| [WI-051](work-items/WI-051-cursor-date-validation.md)           | Creation-time cursors are checked as dates                  | Done        | [WS-051](work-specs/WS-051-cursor-date-validation.md)           | Done        |
| [WI-052](work-items/WI-052-e2e-admin-isolation.md)              | End-to-end tests do not deactivate each other's Admins      | Done        | [WS-052](work-specs/WS-052-e2e-admin-isolation.md)              | Done        |
| [WI-053](work-items/WI-053-esbuild-advisory.md)                 | No vulnerable esbuild in the dependency tree                | Done        | [WS-053](work-specs/WS-053-esbuild-advisory.md)                 | Done        |
| [WI-054](work-items/WI-054-e2e-parallel-stability.md)           | A keyboard move lands where announced; stable parallel E2E  | Done        | [WS-054](work-specs/WS-054-e2e-parallel-stability.md)           | Done        |
| [WI-055](work-items/WI-055-setup-fail-closed.md)                | Production setup requires a setup token                     | Done        | [WS-055](work-specs/WS-055-setup-fail-closed.md)                | Done        |
| [WI-056](work-items/WI-056-hashing-concurrency.md)              | Password hashing cannot starve the server                   | Done        | [WS-056](work-specs/WS-056-hashing-concurrency.md)              | Done        |

## Follow-ups

Deferred decisions that need a work-item before they are acted on.

Planning gaps found in the review of 2026-11-12. Each needs an owner decision:

- **No way back in if the only Admin loses their password.** A reset link can only be
  created by another Admin (WT-02 decision 6). Candidate: a command-line script, run on
  the server, that issues a reset link for an Admin.
- **An email can be neither corrected nor freed** once its invitation was accepted. An
  invitation that was never accepted can now be revoked, which frees its email (WI-024).
  Changing the email of an account that has signed in remains undecided.
- **No work-track covers production deployment.** WT-01 excluded the app's Dockerfile and
  the reverse proxy, and no later track picks them up, although Opanel is self-hosted and
  its first usable release is the end of WT-04. It also decides how `CLIENT_IP_HEADER` and
  https are documented for operators. `Strict-Transport-Security` waits for it too (see WI-041).
  The reverse proxy must accept JSON bodies of at least 512 KiB and should refuse larger
  ones itself (WI-044). It also decides log access and retention, and whether the logs
  of Better Auth and Next.js can hold request data (WS-042, question 2: not examined).

Other follow-ups:

- Give WS-009, WS-010 and WS-012 the "Implementation record" and "Deviations" sections that
  every other finished work-spec has (audit of 2026-11-13). Format only.

- Weigh moving authentication, permission and origin checks into the `route()` wrapper at
  the start of WT-03 (see WS-023, question 1). Done in WI-025.
- Make `pnpm typecheck` independent of a stale `.next` directory (for example by
  generating route types first). Until then see the note in `CONTRIBUTING.md`.
- Declare the bearer-token security scheme in the OpenAPI document with WT-05.
- Add a browsable API documentation page once there are real endpoints (see WS-006).
- Give the shared `destructive` button style enough contrast in light mode: red text on its
  pale red background is 4:1, below the 4.5:1 of WCAG AA (found by axe in WI-035). It
  affects the confirmation buttons of the People and Teams pages.
- Document every `409` of the operations that check `version` (WS-036, question 4). Their
  documented `409` schema requires `code: "version_conflict"` and `current`, but they also
  answer `project_archived`, and a column `PATCH` answers `last_done_column`; those bodies
  do not match the documented schema. Needs its own work-item: `versionConflictResponse`
  should document "a version conflict, or another problem" for projects, columns, tasks
  and epics.
- The project settings dialogs (Add column, Edit column) have no `DialogTrigger`, so on
  close Radix moves the focus to the page body instead of the button that opened them
  (seen in a browser while checking WI-037; the board's "Add task" dialog returns it
  explicitly, see WS-037 "Deviations"). Needs its own work-item.
- The audit of 2026-11-14 proposed three security items that exist only on unmerged
  branches: WI-042 (log errors without their message), WI-043 (refuse the first-run setup
  before hashing once the install has accounts) and WI-044 (bound the JSON request body,
  `413 payload_too_large`). On 2026-11-16 the owner decided to redo them on `main` before
  WT-04. All three are done.
- Delete the superseded remote branches `claude/wi-038-task-detail`,
  `claude/wi-038-task-detail-spec` and `claude/wi-041-security-headers` (owner's decision
  in WS-038, question 6), `claude/wi-044-request-body-limit` (WS-044, question 5) and
  `claude/wi-042-safe-error-logging` (WS-042, question 4) and
  `claude/wi-043-setup-refuses-before-hashing` (WS-043, question 5).
- Upgrade drizzle-kit to 1.0 once it is stable (it drops the deprecated `@esbuild-kit`
  packages), then delete the esbuild override in `pnpm-workspace.yaml` (WS-053,
  question 2).
- `pnpm audit` without `--prod` reports GHSA-g3hv-75wg-m249 (`minimatch`, a denial of
  service, under `eslint`), a development dependency (found in WI-053). Decide whether
  development advisories are audited too.
- ESLint lints `.claude/worktrees/` (other sessions' worktrees), so `pnpm lint` can crash
  or report another branch's files while one is open (found in WI-053). Candidate: add it
  to `globalIgnores` in `eslint.config.mjs`, and check Prettier and Vitest likewise.
- Create the first Admin through a command run on the server instead of the public setup
  page, a candidate for the production deployment track (WS-055, question 3). It belongs
  with the last-Admin recovery command above.
- Upgrade Node.js from 22 to 24 LTS (`engines`, `.nvmrc`, `@types/node`, CI).
- Upgrade pnpm from 10 to 12 (`packageManager`, CI).
- Upgrade Playwright from 1.63.0 to the latest release (see WS-007).
- Add Firefox and WebKit to the end-to-end tests once there is real UI to protect.
- Return from TypeScript 6.0 to 7 once `typescript-eslint` supports it (see WS-002).
