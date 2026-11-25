# WI-122 — Task lists stop reading descriptions

- Status: Proposed
- Work-track: none: follow-up C05 of the independent audit of 2026-11-24, confirmed in the
  code of `main`
- Depends on: none
- Work-spec: [WS-122](../work-specs/WS-122-task-list-summary-select.md)

## Outcome

The three task lists (the board list, the backlog and the list across projects) read from
PostgreSQL only what their answer holds. Today they share `TASK_SELECT` with the
single-task reads, so every listed task's `description` (up to 50 000 characters) is sent
from the database to Node and dropped by `toSummary`: at the 100-task page limit, up to
about five million characters per page that nobody reads. The answers do not change.

## Acceptance criteria

- [ ] `listTasks`, `listBacklog` and `listAllTasks` read no task description from the
      database, for any filter, sort or cursor.
- [ ] Reading, creating, updating, moving, deleting and restoring one task still answer its
      description, as today.
- [ ] The answers of the three lists and their OpenAPI schemas are unchanged.
- [ ] A list row's type has no `description`, so TypeScript refuses a list that tries to
      read it.
- [ ] The full quality gate passes.

## Notes

This is the smaller first step the audit proposed before any change to how the board
loads (WI-116 and WI-118's follow-up on slow task lists). It does not change what reaches
the browser: lists never answered descriptions.
