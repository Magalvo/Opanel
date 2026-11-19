# WI-086 — The data model of bug reports and triage

- Status: Proposed
- Work-track: [WT-06](../work-tracks/WT-06-bug-reports-and-triage.md) (item A)
- Depends on: WT-05 (done)
- Work-spec: [WS-086](../work-specs/WS-086-triage-data-model.md)

## Outcome

The database holds everything WT-06 needs, with every rule the database can enforce
enforced there: the bug fields of a task, a project's triage team, the routing rules, every
bug report as sent (append-only), and `regression of` links between tasks. No endpoint,
service or screen changes yet: the later items of WT-06 use these tables.

## Acceptance criteria

- [ ] `tasks` has `severity` (`low | medium | high | critical`, allowed only on a `bug`),
      `fingerprint` (1 to 128 characters), `occurrences` (not negative, default 0) and
      `last_reported_at`; existing tasks are unchanged by the migration.
- [ ] `projects.triage_team_id` names a team or nothing.
- [ ] `routing_rules` holds at most one team per project and layer (`frontend`, `api`,
      `backend`; never `unknown`).
- [ ] A team named by a triage team or a routing rule cannot be deleted (the existing
      `409 team_in_use` path).
- [ ] `bug_reports` stores a report of an agent (never of a human) against a task, with its
      outcome, layer, confidence (0 to 1), severity, fingerprint, run id and payload; the
      runtime role can insert and read it but not update or delete it, and a trigger
      refuses both to everyone.
- [ ] `task_links` stores a `regression_of` link between two different tasks, at most once.
- [ ] The task history accepts a `reported_again` entry.
- [ ] Each check is proven by an integration test against PostgreSQL; the runtime-role test
      lists `bug_reports` among the append-only tables.
- [ ] The full quality gate passes; the API and the OpenAPI document do not change.

## Notes

Decisions 1, 2, 4, 5, 9, 10 and 11 of WT-06 are the source of each column. The
`reported_again` history type and the `bug_reports` indexes serve items D and E.
