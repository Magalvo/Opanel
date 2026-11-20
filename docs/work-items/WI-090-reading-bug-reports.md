# WI-090 — Reading the reports behind a task, and its regression links

- Status: Approved (2026-11-20)
- Work-track: [WT-06](../work-tracks/WT-06-bug-reports-and-triage.md) (item E)
- Depends on: WI-089 (done)
- Work-spec: [WS-090](../work-specs/WS-090-reading-bug-reports.md)

## Outcome

Anyone with `tasks:read` lists the bug reports behind a task, newest first. Each report
shows the agent, its time, outcome, layer, confidence, severity, run id and evidence. A
task's answer names the tasks it is linked to: the closed bug it is a regression of, and
the bugs that are regressions of it.

## Acceptance criteria

- [ ] `GET /api/v1/tasks/{taskId}/bug-reports` (`tasks:read`) answers a page of
      `BugReport`, newest first, with keyset pagination. Each report has its id, the
      agent as `AccountRef`, `createdAt`, `outcome`, `originLayer`, `confidence`,
      `severity`, `fingerprint`, `runId`, and the report's `title`, `summary` and
      `evidence` as sent.
- [ ] A task with no reports answers an empty page. A deleted task or an unknown one is
      `404`; a project outside an agent's restriction is `403`.
- [ ] Reports sharing a creation time are neither repeated nor skipped across pages.
- [ ] `limit` follows the rule section 2 of WS-090 settles, and a value out of range is
      `400`.
- [ ] `Task` (not `TaskSummary`) carries `links`: each link has its `type`
      (`regression_of`), its `direction` (`outgoing` or `incoming`) and the other task's
      `id`, `key` and `title`. Every operation that answers a `Task` includes it, the
      `current` of a `409` too; a task with no links has `[]`.
- [ ] A linked task that is deleted is left out of `links`.
- [ ] The coverage test of `requireProjectAccess` covers the new service function. The
      OpenAPI document describes the operation and the new fields. The full quality gate
      passes.

## Notes

WT-06 decisions 9 and 15. Showing reports and links in the task detail is item F.
