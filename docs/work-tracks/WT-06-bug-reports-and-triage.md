# WT-06 — Bug reports and automated triage

- Status: Approved (by the owner on 2026-11-19: decisions 1 to 16 and questions 1 to 8 as
  recommended). Items get numbers from WI-086 when each starts.
- Canonical docs: [0001](../canonical/0001-ai-qa-agents-and-triage.md) (sections 5 and 6:
  the bug report contract and the triage pipeline; section 7: the data model sketch;
  amended by this track, see decisions 3, 6 and 9), [0003](../canonical/0003-task-management.md)
  (section 3: Managers edit routing rules; section 4: severity; section 5: the `done`
  category; section 7: the `regression of` link; section 13: placement),
  [0002](../canonical/0002-realtime-sync.md) (boards see triaged bugs live),
  [0004](../canonical/0004-api-conventions.md) (errors, `200` versus `201`),
  [0005](../canonical/0005-mcp-server.md) (WT-11's `opanel_submit_bug_report` wraps this
  track's endpoint)

## Goal

An external QA agent with `reports:write` sends a structured bug report to
`POST /api/v1/projects/{projectId}/bug-reports`. Opanel keeps the report, and in the same
transaction either counts it against the open bug with the same fingerprint or creates a
`bug` task on the board, assigned to the team that owns the reported layer, with the
evidence in its description. Managers set which team owns each layer; everyone with
`tasks:read` sees a bug's severity, how often it was reported, and every report behind it.

## Depends on

- **WT-05** (agent accounts and tokens): the agent `Actor`, `reports:write`, project
  restrictions (`requireProjectAccess`), the per-token rate limit, `docs/agents.md`.
- **WT-03** (board core): tasks, columns and their categories, teams, system comments,
  task history, `team_in_use`.
- **WT-04** (live sync): `task.created`, `task.updated` and `comment.created` events reach
  open boards with no new event type.
- **WT-12**: done; this track adds no operational setting.

## Starting point

Checked on 2026-11-19 against `main` (`4cfb4d0`):

- `reports:write` is in the permission catalogue and in the `qa_agent` and `worker_agent`
  scope presets; no human role holds it (`src/server/auth/roles.ts`). Nothing checks it
  yet.
- `tasks.type` already allows `bug` (`tasks_type_check`). `tasks` has no `severity`,
  `fingerprint`, `occurrences` or `last_reported_at`; `projects` has no triage team.
- Comments already have `kind: "system"` with no author, shown as "Opanel" (WS-034,
  WS-074): the system comment of a repeated report needs nothing new there.
- Columns have a category (`todo`, `in_progress`, `done`); "open" for dedupe means a task
  that is not deleted and not in a `done` column (doc 0003 section 5).
- `teams:manage` is the permission of doc 0003's row "Manage teams and team membership;
  edit triage routing rules", held by Managers and Admins.
- There are no task links yet (WT-09) and no backlog or sprints (WT-07, WT-10).
- Every service that takes a project-scoped id calls `requireProjectAccess`, and a test
  fails when a new one does not (WT-05 decision 7). The new services must too.

## In scope

- The data model: bug fields on `tasks`, the project's triage team, `routing_rules`,
  `bug_reports`, and a minimal `task_links` for `regression of`.
- The routing rules API and its settings section, for Managers and Admins, audited.
- The bug report endpoint and the triage pipeline of doc 0001 section 6.
- Reading the reports behind a bug, and severity on tasks.
- Bugs where people see them: the card and the task detail.
- The guide for agent authors (`docs/agents.md`): filing reports, layers, fingerprints.
- The amendments to doc 0001 that decisions 3, 6 and 9 make.

## Out of scope

- Any classification of the origin layer by Opanel (doc 0001 section 9): the agent's
  `originLayer` is taken as sent.
- The backlog and sprints (WT-07, WT-10): until they exist, a new bug goes on the board.
  WT-10 must place agent-filed bugs at the top of the backlog in sprint projects (doc 0003
  section 13); this track leaves one function for it to change (decision 7).
- Other link types and linking by hand (WT-09); this track creates `regression of` links
  only, from the pipeline.
- Priority (WT-07): an agent-filed bug arrives with priority `none` once priority exists.
- File attachments, notifications, webhooks (doc 0001 section 9).
- The MCP tool (WT-11), which calls this endpoint.

## Design decisions

Choices the canonical docs leave open. Each is detailed in the work-spec of the item that
implements it.

1. **Bug fields on `tasks`.** `severity` (`low | medium | high | critical`, nullable,
   allowed only when `type = 'bug'`, by a check), `fingerprint` (text, up to 128
   characters, nullable), `occurrences` (integer, default 0; 1 for a task the pipeline
   creates) and `last_reported_at` (nullable). The task schema and the task's `GET`
   return them; a person with `tasks:write` may set or clear `severity` on a bug through
   `PATCH /tasks/{taskId}` (doc 0003 section 4 lets severity be corrected), but never
   `fingerprint`, `occurrences` or `last_reported_at`, which only the pipeline writes.
   Changing a task's type away from `bug` clears its severity.

2. **The project's triage team.** `projects.triage_team_id`, nullable, the fallback of doc
   0001 section 6 for `unknown` and for a layer without a rule. A new project has none.

3. **When there is no team to route to** (no rule for the layer and no triage team), the
   bug is created with no assignee team, and its first system comment says that no team
   owns the layer, so a person triages it from the board. The report is never refused for
   a configuration gap on Opanel's side. This fills a case doc 0001 does not cover, as an
   amendment.

4. **`routing_rules(project_id, origin_layer, team_id)`**, primary key
   `(project_id, origin_layer)`, `origin_layer` in `frontend | api | backend` (`unknown`
   always goes to the triage team). Read and replaced as one document:
   `GET` and `PUT /api/v1/projects/{projectId}/triage` return and take
   `{ triageTeamId, rules: { frontend, api, backend }, version }`, each a team id or
   `null`. `PUT` needs `teams:manage`, checks `version` (the project's, which it bumps, so
   two Managers editing at once get `409 version_conflict`), answers `409
project_archived` on an archived project, and is audited as `project.triage_updated`
   with the old and new team ids. `GET` needs `projects:read`.

5. **Deleting a team that triage uses** is refused with `409 team_in_use`, like a team
   with tasks (WS-030), naming the projects. Routing rules never point at a missing team.

6. **Dedupe is serialised by a transaction-level advisory lock, not by a partial unique
   index.** Doc 0001 section 6 asks for "a unique partial index on `(project_id,
fingerprint)` for open tasks", but whether a task is open depends on its column's
   category, which a partial index on `tasks` cannot see, and a column can change category
   with many tasks in it. Proposal: the pipeline takes
   `pg_advisory_xact_lock(hashtextextended(project_id || ':' || fingerprint, 0))`, then
   looks for an open task with that fingerprint (`not deleted`, column category not
   `done`), then creates or counts, all in one transaction. Two reports with the same
   fingerprint therefore run one after the other, and the second sees the first's task. A
   non-unique index on `(project_id, fingerprint)` keeps the lookup fast. Doc 0001 is
   amended to say so (question 1).

7. **Placement.** A new bug goes to the **top** of the project's first column (lowest
   position), where a team looking at the board sees it first. One function,
   `placeNewBug(project)`, decides it, so WT-10 changes only that for sprint projects. If
   the first column is `done`, it still goes there: column order is the project's choice.

8. **The task the pipeline creates.** Type `bug`; title from the report; `severity` from
   the report; reporter the agent; `assignee_team_id` from decision 4 or 3; no person
   assigned; `fingerprint`, `occurrences = 1`, `last_reported_at = now`. The description
   is Markdown rendered by the server from `summary` and `evidence`: headed sections
   (Steps to reproduce, Expected, Actual, URL, HTTP, Console errors, Diagnosis), with
   every value the agent sent placed in a fenced block whose fence is longer than any
   run of backticks inside it, so a report cannot inject Markdown structure. Rendering is
   pure and unit-tested. People may edit the description afterwards; the report itself
   stays unchanged in `bug_reports`.

9. **A report that matches a closed bug.** When no open task matches but a task with the
   same fingerprint is in a `done` column (the most recently updated one), the new task
   gets a `regression of` link to it, and its first system comment names it ("Regression
   of OPA-12"). `task_links(from_task_id, to_task_id, type, created_by, created_at)` is
   created by this track with the one type `regression_of`, and its `GET` is part of the
   task detail; WT-09 adds the other types and linking by hand to the same table. A
   soft-deleted task neither matches nor is linked: a report about it creates a new task.
   This is written into doc 0001 section 6 (it already says "regression of" link) and
   doc 0003 section 7 notes that WT-06 creates the table (question 2).

10. **A repeated report** (an open task matches): the task's `occurrences` grows by one and
    `last_reported_at` is set; its column, assignee and severity do not change (doc 0001
    section 6). A system comment is added only when the previous report on that task is
    more than an hour old, or came with another `runId`, so an agent that re-runs its
    suite every few minutes does not bury the task's comments (question 3). The change is
    a task change: `version` grows, a `reported_again` entry goes into the task history
    with the agent as actor, and `task.updated` is published.

11. **`bug_reports`** keeps every report as sent: `id`, `project_id`, `agent_account_id`,
    `task_id`, `outcome` (`created | deduplicated`), `origin_layer`, `confidence`,
    `severity`, `fingerprint`, `run_id`, `payload` (the validated body, `jsonb`) and
    `created_at`. It is append-only for the runtime role, like `audit_log` and
    `task_events` (canonical doc 0006 section 5), with a test. Reports are kept as long as
    the task; `maintenance` removes nothing from it in v1 (question 6).

12. **Validation and size.** The body is the Zod schema of doc 0001 section 5, strict:
    `title` 1 to 200 characters; `fingerprint` 1 to 128 characters of printable ASCII;
    `confidence` 0 to 1; `summary` up to 10 000 characters; `evidence` fields each bounded
    (`stepsToReproduce` up to 50 items of 1 000 characters; `expected`, `actual`,
    `diagnosis` up to 4 000; `url` an `http(s)` URL up to 2 000; `http.responseSnippet` up
    to 4 000; `consoleErrors` up to 50 items of 2 000); `runId` up to 128. The whole body
    stays under the 512 KiB of every request (WS-044). `originLayer` defaults to
    `unknown`, `severity` to `medium`, `confidence` is optional.

13. **Answers.** `201 { outcome: "created", taskId, taskKey, assignedTeamId }` and
    `200 { outcome: "deduplicated", taskId, taskKey, occurrences }`, as doc 0001 section 5,
    with the task's key added for agents and people reading logs. `400` invalid body,
    `401`/`403` (no `reports:write`, or a project outside the agent's restriction),
    `404` unknown project, `409 project_archived`, `413`, `415`, `429` (WS-083 documents
    `rate_limited` and `Retry-After` for every token operation). Only agents hold
    `reports:write`, so a person gets `403`; filing a bug by hand is creating a `bug` task.

14. **Attribution and audit.** The task's creation and every repeat are task-history
    entries with the agent as actor (hard rule 8); the system comments have no author, as
    WS-034 decided. The audit log gains `bug_report.triaged` with `{ reportId, taskId,
outcome, assignedTeamId }` and the agent as actor, so the report is traceable even
    when the task is later deleted.

15. **Reading reports.** `GET /api/v1/tasks/{taskId}/bug-reports` (`tasks:read`, paged,
    newest first) returns the reports behind a task: agent (as `AccountRef`, with the
    "Agent" badge), time, outcome, layer, confidence, severity, run id and evidence. The
    task detail of a bug shows severity (editable, decision 1), "Reported N times, last
    …", the regression link if any, and a "Reports" section listing them. A bug's card
    shows its severity as a small badge and its count when above 1. A project's settings
    gain a "Triage" section: the triage team and one team per layer, for those with
    `teams:manage` (decision 4).

16. **The guide.** `docs/agents.md` gains "Filing bug reports": the endpoint and body, the
    two outcomes, the layer table of doc 0001 section 5, and the fingerprint guidance
    (hash of layer, normalised route or endpoint and error signature; never timestamps or
    ids). Its doc check (WS-078) then checks the new endpoint and codes.

## Work-items (outline)

Letters until each item starts; numbers from WI-086 then, each with its work-spec.

| Item                                                    | Title                                                                                                                           | Status   | Depends on |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------- |
| [WI-086](../work-items/WI-086-triage-data-model.md) A   | Data model: bug fields on `tasks`, `projects.triage_team_id`, `routing_rules`, append-only `bug_reports`, `task_links`          | Done     | WT-05      |
| [WI-087](../work-items/WI-087-triage-settings-api.md) B | The triage settings API (`GET`/`PUT /projects/{projectId}/triage`), audited; `team_in_use` covers triage                        | Done     | A          |
| [WI-088](../work-items/WI-088-task-severity.md) C       | Severity on tasks: the task schema, `PATCH`, history, OpenAPI                                                                   | Done     | A          |
| [WI-089](../work-items/WI-089-bug-report-pipeline.md) D | The bug report endpoint and the triage pipeline: validation, lock and dedupe, routing, creation, regression link, events, audit | Done     | A, B, C    |
| [WI-090](../work-items/WI-090-reading-bug-reports.md) E | Reading reports (`GET /tasks/{taskId}/bug-reports`) and the regression link in the task's `GET`                                 | Done     | D          |
| F                                                       | Bugs in the UI: severity and count on the card; severity, reports and regression link in the task detail                        | Approved | C, E       |
| [WI-092](../work-items/WI-092-triage-section.md) G      | The project's "Triage" settings section                                                                                         | Done     | B          |
| H                                                       | End-to-end triage flow, the guide's "Filing bug reports", and the amendments to docs 0001 and 0003                              | Approved | D, E, F, G |

## Exit criteria

- [ ] An agent with `reports:write` files a report; a `bug` task appears at the top of the
      project's first column of every open board, assigned to the team of the report's
      layer, with the evidence in its description and the agent as reporter.
- [ ] A second report with the same fingerprint while the task is open answers
      `deduplicated`, counts on that task and creates nothing; ten such reports sent at
      once leave exactly one task with `occurrences` 10 (an integration test).
- [ ] A report whose fingerprint matches only a closed bug creates a new bug with a
      `regression of` link to it; a soft-deleted bug is not matched.
- [ ] `unknown`, or a layer with no rule, goes to the triage team; with no triage team the
      bug is created unassigned and its comment says why.
- [ ] Managers and Admins set the triage team and the team of each layer from the
      project's settings; the change is audited and a concurrent change is a
      `409 version_conflict`; a team in use cannot be deleted.
- [ ] Every report is kept as sent, append-only for the runtime role; the reports behind a
      task are listed in its detail.
- [ ] A restricted agent cannot file into another project (`403`); a person cannot use the
      endpoint (`403`); an archived project answers `409 project_archived`; the coverage
      test of `requireProjectAccess` includes the new services.
- [ ] Report values cannot inject Markdown structure into the task description (unit
      tests on hostile input).
- [ ] `docs/agents.md` documents filing reports and its doc check passes; the OpenAPI
      document describes the endpoint and its answers; docs 0001 and 0003 carry the
      amendments.
- [ ] The full quality gate passes; an end-to-end test files, repeats and triages a bug
      through the API and sees it on a board.

## Risks and open questions

For the owner (decisions 1 to 16 are each approved or changed; these need an explicit
answer):

1. **Dedupe by advisory lock instead of the partial unique index of doc 0001** (decision
   6). A partial index cannot know a column's category; keeping a denormalised "open"
   flag on every task would make every move, delete, restore and column category change
   maintain it. The lock gives the same guarantee for concurrent reports with one
   statement. **Recommend: the advisory lock, and amend doc 0001.**
2. **WT-06 creates `task_links` with the one type `regression_of`** (decision 9), rather
   than recording the closed task only in a system comment until WT-09. A real link is
   what doc 0003 section 7 describes and needs no migration of data later.
   **Recommend: create the table now, the other types in WT-09.**
3. **System comment on a repeat only after an hour or with another `runId`** (decision 10).
   The alternatives are a comment on every report (noisy for agents that poll) or never
   (the count only). **Recommend: as proposed.**
4. **No team to route to creates an unassigned bug** (decision 3), rather than refusing
   the report with `409`. A refused report would be lost by agents that do not retry.
   **Recommend: create it, unassigned, and say why.**
5. **New bugs at the top of the first column** (decision 7), rather than at the end.
   **Recommend: top.**
6. **Keep every report for as long as its task** (decision 11). A busy agent may file
   thousands of repeats; a later item can let `maintenance` thin them. **Recommend: keep
   them in v1, and add a Follow-up on growth to `docs/operations.md`'s table list.**
7. **People may correct a bug's severity** (decision 1), as doc 0003 section 4 allows
   ("set by the reporter" describes where it comes from, not who may change it).
   **Recommend: allowed, with `tasks:write`, recorded in the history.**
8. **Track order:** WT-06 now, then WT-11 (the MCP server), then WT-07 to WT-10, as
   `docs/README.md` plans. **Recommend: as planned.**

Risks:

- **The pipeline is the first service that writes on behalf of agents at volume.** Its
  transaction takes the lock, reads the open task, writes up to five tables and publishes
  events; item D's work-spec measures it with ten concurrent identical reports and with
  reports for ten different fingerprints at once.
- **Evidence is untrusted text shown to people.** Decision 8 confines it to fenced blocks,
  and Markdown is already rendered without raw HTML (WS-038); item D's tests feed it
  hostile input (fences, headings, links, HTML, control characters).
- **WT-10 must remember decision 7.** This track adds a Follow-up so WT-10's work-spec
  places agent-filed bugs at the top of the backlog in sprint projects.
