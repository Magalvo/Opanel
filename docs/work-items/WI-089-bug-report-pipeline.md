# WI-089 — The bug report endpoint and the triage pipeline

- Status: Done (2026-11-20)
- Work-track: [WT-06](../work-tracks/WT-06-bug-reports-and-triage.md) (item D)
- Depends on: WI-086, WI-087, WI-088 (done)
- Work-spec: [WS-089](../work-specs/WS-089-bug-report-pipeline.md)

## Outcome

An agent with `reports:write` sends a bug report to
`POST /api/v1/projects/{projectId}/bug-reports`. In one transaction Opanel keeps the
report and either counts it on the open bug with the same fingerprint or creates a `bug`
task at the top of the project's first column. The task is assigned to the team of the
report's layer, has the evidence in its description, and links to the closed bug it
regresses, if there is one. Boards see the change live; the agent is the actor of every
history entry and of the audit entry.

## Acceptance criteria

- [x] A valid report on a project with no open bug of that fingerprint answers `201
{ outcome: "created", taskId, taskKey, assignedTeamId }`. The new task is a `bug` with
      the report's title and severity, the agent as reporter, `occurrences` 1, the
      fingerprint and `lastReportedAt`, no person assigned, at the top of the first
      column.
- [x] The team is the rule of the report's layer; `unknown` or a layer with no rule goes to
      the triage team. With neither, the task has no team, and its system comment says no
      team owns the layer.
- [x] A report whose fingerprint matches an open bug (not deleted, not in a `done` column)
      answers `200 { outcome: "deduplicated", taskId, taskKey, occurrences }`: the
      count grows by one and `lastReportedAt` is set. Column, team, assignee and severity
      do not change, and no task is created.
- [x] Ten identical reports sent at once leave one task with `occurrences` 10. Ten reports
      with different fingerprints sent at once create ten tasks with distinct keys, and
      none fails.
- [x] A report that matches only a closed bug creates a new bug with a `regression_of`
      link to the most recently updated closed one, named in the system comment. A
      soft-deleted bug is never matched or linked.
- [x] A repeat adds a system comment only when the previous report on that task is more
      than an hour old or has another `runId`.
- [x] Every report is stored in `bug_reports` as validated, with its outcome and task.
      The audit log gains `bug_report.triaged` with the agent as actor. History has
      `created` or `reported_again` with the agent as actor. `task.created` or
      `task.updated` and `comment.created` are published.
- [x] The description renders `summary` and `evidence` under fixed headings, every value
      in a fence longer than any backtick run inside it. Hostile input (fences, headings,
      links, HTML, control characters) cannot change the Markdown structure.
- [x] The body is validated as WT-06 decision 12 describes (`400` naming the field). A
      person gets `403`, as does an agent without `reports:write` or outside its project
      restriction. An unknown project is `404`, an archived one `409 project_archived`.
- [x] The coverage test of `requireProjectAccess` covers the new service. The OpenAPI
      document describes the operation and both answers. The full quality gate passes.

## Notes

WT-06 decisions 3, 6 to 14, and questions 1 to 6. Reading the reports (item E), the UI
(item F), the guide and the amendments to docs 0001 and 0003 (item H) come later.
