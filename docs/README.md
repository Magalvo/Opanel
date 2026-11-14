# Opanel docs index

The spec system is described in `AGENTS.md` section 4. This file is the index: every doc is
listed here with its current status. Update it whenever a doc is added or changes status.

Statuses: `Draft` → `Proposed` → `Approved` → `In progress` → `Done` (or `Superseded`).

## Where the project stands

Updated at the end of every work-item, so that a new session can start from here.

- **Last finished:** WI-031 (move a task between and within columns), on 2026-11-14.
- **Awaiting the owner's approval:**
  - WI-040 / WS-040, account link hardening (from the audit of 2026-11-13).
  - WI-041 / WS-041, security headers and Content Security Policy. Needed before WI-038.
- **Next:** draft WI-032 (delete and restore a task) and WS-032 as `Proposed`, and stop for
  the owner's approval. WS-030 question 4 proposed how deleted tasks count for the team and
  column rules.
- **Planning gaps awaiting an owner decision** are listed first under
  [Follow-ups](#follow-ups).

## Canonical docs (`canonical/`)

| Doc                                               | Title                                                       | Status   |
| ------------------------------------------------- | ----------------------------------------------------------- | -------- |
| [0001](canonical/0001-ai-qa-agents-and-triage.md) | AI QA agents: identity, authentication and automated triage | Approved |
| [0002](canonical/0002-realtime-sync.md)           | Real-time board sync                                        | Approved |
| [0003](canonical/0003-task-management.md)         | Task management: roles, tickets, boards and planning        | Approved |
| [0004](canonical/0004-api-conventions.md)         | API conventions                                             | Approved |

## Work-tracks (`work-tracks/`)

| Track                                                  | Title                                                   | Status   |
| ------------------------------------------------------ | ------------------------------------------------------- | -------- |
| [WT-01](work-tracks/WT-01-project-boilerplate.md)      | Project boilerplate                                     | Done     |
| [WT-02](work-tracks/WT-02-accounts-and-permissions.md) | Accounts, human sign-in, roles and the permission layer | Done     |
| [WT-03](work-tracks/WT-03-board-core.md)               | Board core: projects, teams, columns, epics, tasks      | Approved |

Planned next, not yet drafted:

- WT-04 Real-time board sync
- WT-05 Agent accounts and API tokens
- WT-06 Bug reports and automated triage
- WT-07 Backlog, priority, due dates, labels
- WT-08 Search, filters, list view, activity timeline
- WT-09 Sub-tasks and task links
- WT-10 Sprints and story points

WT-07 to WT-10 come from canonical doc 0003.

## Work-items (`work-items/`) and work-specs (`work-specs/`)

| Item                                                            | Title                                                     | Item status | Spec                                                            | Spec status |
| --------------------------------------------------------------- | --------------------------------------------------------- | ----------- | --------------------------------------------------------------- | ----------- |
| [WI-001](work-items/WI-001-app-skeleton.md)                     | App skeleton: Next.js, strict TypeScript, Vitest          | Done        | [WS-001](work-specs/WS-001-app-skeleton.md)                     | Done        |
| [WI-002](work-items/WI-002-lint-and-format.md)                  | ESLint and Prettier                                       | Done        | [WS-002](work-specs/WS-002-lint-and-format.md)                  | Done        |
| [WI-003](work-items/WI-003-validated-env.md)                    | Validated environment variables                           | Done        | [WS-003](work-specs/WS-003-validated-env.md)                    | Done        |
| [WI-004](work-items/WI-004-database.md)                         | PostgreSQL, Drizzle and the integration test harness      | Done        | [WS-004](work-specs/WS-004-database.md)                         | Done        |
| [WI-005](work-items/WI-005-health-endpoint.md)                  | Health endpoint: the first vertical slice                 | Done        | [WS-005](work-specs/WS-005-health-endpoint.md)                  | Done        |
| [WI-006](work-items/WI-006-openapi.md)                          | OpenAPI document generated from Zod                       | Done        | [WS-006](work-specs/WS-006-openapi.md)                          | Done        |
| [WI-007](work-items/WI-007-e2e.md)                              | Playwright end-to-end tests                               | Done        | [WS-007](work-specs/WS-007-e2e.md)                              | Done        |
| [WI-008](work-items/WI-008-ui-foundation.md)                    | UI foundation: Tailwind, shadcn/ui and the app shell      | Done        | [WS-008](work-specs/WS-008-ui-foundation.md)                    | Done        |
| [WI-009](work-items/WI-009-ci.md)                               | Continuous integration                                    | Done        | [WS-009](work-specs/WS-009-ci.md)                               | Done        |
| [WI-010](work-items/WI-010-contributor-docs.md)                 | Contributor docs: README and CONTRIBUTING                 | Done        | [WS-010](work-specs/WS-010-contributor-docs.md)                 | Done        |
| [WI-011](work-items/WI-011-api-foundations.md)                  | API foundations: errors, validation helpers, request id   | Done        | [WS-011](work-specs/WS-011-api-foundations.md)                  | Done        |
| [WI-012](work-items/WI-012-permissions-and-actor.md)            | Permission catalogue, human roles and the `Actor` type    | Done        | [WS-012](work-specs/WS-012-permissions-and-actor.md)            | Done        |
| [WI-013](work-items/WI-013-accounts-and-better-auth.md)         | Accounts, sessions schema and Better Auth                 | Done        | [WS-013](work-specs/WS-013-accounts-and-better-auth.md)         | Done        |
| [WI-014](work-items/WI-014-audit-log.md)                        | Audit log table and writer                                | Done        | [WS-014](work-specs/WS-014-audit-log.md)                        | Done        |
| [WI-015](work-items/WI-015-sign-in-and-authentication.md)       | Sign-in, sign-out, me, authentication, limiter            | Done        | [WS-015](work-specs/WS-015-sign-in-and-authentication.md)       | Done        |
| [WI-016](work-items/WI-016-first-run-setup.md)                  | First-run setup: create the first Admin                   | Done        | [WS-016](work-specs/WS-016-first-run-setup.md)                  | Done        |
| [WI-017](work-items/WI-017-sign-in-page-and-protected-shell.md) | Sign-in page, protected shell, account menu               | Done        | [WS-017](work-specs/WS-017-sign-in-page-and-protected-shell.md) | Done        |
| [WI-018](work-items/WI-018-account-management-api.md)           | Account management API                                    | Done        | [WS-018](work-specs/WS-018-account-management-api.md)           | Done        |
| [WI-019](work-items/WI-019-accept-invitation-or-reset-link.md)  | Accept an invitation or reset link                        | Done        | [WS-019](work-specs/WS-019-accept-invitation-or-reset-link.md)  | Done        |
| [WI-020](work-items/WI-020-people-page.md)                      | Admin People page                                         | Done        | [WS-020](work-specs/WS-020-people-page.md)                      | Done        |
| [WI-021](work-items/WI-021-own-profile.md)                      | Own profile: change name and password                     | Done        | [WS-021](work-specs/WS-021-own-profile.md)                      | Done        |
| [WI-022](work-items/WI-022-sign-in-hardening.md)                | Sign-in hardening: bounded audit and limiter growth       | Done        | [WS-022](work-specs/WS-022-sign-in-hardening.md)                | Done        |
| [WI-023](work-items/WI-023-api-guard-rails.md)                  | API guard rails: declared authentication, enforced checks | Done        | [WS-023](work-specs/WS-023-api-guard-rails.md)                  | Done        |
| [WI-024](work-items/WI-024-revoke-invitation.md)                | Revoke an invitation that was never accepted              | Done        | [WS-024](work-specs/WS-024-revoke-invitation.md)                | Done        |
| [WI-025](work-items/WI-025-route-declares-access.md)            | `route()` declares authentication and permission          | Done        | [WS-025](work-specs/WS-025-route-declares-access.md)            | Done        |
| [WI-026](work-items/WI-026-teams-and-people.md)                 | Teams, membership and the people directory                | Done        | [WS-026](work-specs/WS-026-teams-and-people.md)                 | Done        |
| [WI-027](work-items/WI-027-positions-and-version-conflict.md)   | Fractional positions and the `version_conflict` response  | Done        | [WS-027](work-specs/WS-027-positions-and-version-conflict.md)   | Done        |
| [WI-028](work-items/WI-028-projects-and-default-columns.md)     | Projects with default columns                             | Done        | [WS-028](work-specs/WS-028-projects-and-default-columns.md)     | Done        |
| [WI-029](work-items/WI-029-columns-api.md)                      | Columns API                                               | Done        | [WS-029](work-specs/WS-029-columns-api.md)                      | Done        |
| [WI-030](work-items/WI-030-tasks-core.md)                       | Tasks core                                                | Done        | [WS-030](work-specs/WS-030-tasks-core.md)                       | Done        |
| [WI-031](work-items/WI-031-move-task.md)                        | Move a task between and within columns                    | Done        | [WS-031](work-specs/WS-031-move-task.md)                        | Done        |
| [WI-040](work-items/WI-040-account-link-hardening.md)           | Account link hardening                                    | Proposed    | [WS-040](work-specs/WS-040-account-link-hardening.md)           | Proposed    |
| [WI-041](work-items/WI-041-security-headers.md)                 | Security headers and Content Security Policy              | Proposed    | [WS-041](work-specs/WS-041-security-headers.md)                 | Proposed    |

WI-032 to WI-039 are outlined in WT-03 and get their own files when they are started.

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
- **Optional `SETUP_TOKEN` for the first-run setup:** if set, the form and endpoint require
  it, so a freshly deployed install cannot be claimed by the first visitor (see WS-016,
  question 1). Needed before any install is reachable from the internet.

Other follow-ups:

- Give WS-009, WS-010 and WS-012 the "Implementation record" and "Deviations" sections that
  every other finished work-spec has (audit of 2026-11-13). Format only.

- Take the per-account lock of WS-024 (`lockAccount`) in `issueResetLink` too, so issuing a
  new link while the same person accepts the previous one cannot deadlock (see WS-024,
  implementation record). Proposed as part of WI-040.
- Weigh moving authentication, permission and origin checks into the `route()` wrapper at
  the start of WT-03 (see WS-023, question 1). Done in WI-025.
- Make `pnpm typecheck` independent of a stale `.next` directory (for example by
  generating route types first). Until then see the note in `CONTRIBUTING.md`.
- Declare the bearer-token security scheme in the OpenAPI document with WT-05.
- Add a browsable API documentation page once there are real endpoints (see WS-006).
- Upgrade Node.js from 22 to 24 LTS (`engines`, `.nvmrc`, `@types/node`, CI).
- Upgrade pnpm from 10 to 12 (`packageManager`, CI).
- Upgrade Playwright from 1.63.0 to the latest release (see WS-007).
- Add Firefox and WebKit to the end-to-end tests once there is real UI to protect.
- Return from TypeScript 6.0 to 7 once `typescript-eslint` supports it (see WS-002).
