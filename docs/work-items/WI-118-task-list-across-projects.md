# WI-118 — The list of tasks across projects, with sort

- Status: Proposed
- Work-track: [WT-08](../work-tracks/WT-08-search-filters-list-timeline.md) (item B)
- Depends on: [WI-116](WI-116-task-filters-search.md) (item A, done)
- Work-spec: [WS-118](../work-specs/WS-118-task-list-across-projects.md)

## Outcome

Anyone with `tasks:read` lists the live tasks of every project they may read, board and
backlog together, with the filters of WI-116, a `projectId` filter and a `sort`, through
`GET /api/v1/tasks`. Each item names its project and its column, so the list view (item E)
can show them without another request. An agent restricted to some projects sees only
theirs, and every page is full.

## Acceptance criteria

- [ ] `GET /api/v1/tasks` (`tasks:read`) lists live tasks of the projects the caller may
      read, leaving out archived projects unless `projectId` names one; items are
      `TaskListItem`: `TaskSummary` with `project` (`{ id, key, name }`) and `column`
      (`{ id, name, category }`, or `null` in the backlog).
- [ ] It takes every filter of WI-116 except `columnId`, and `projectId` (an id or a key,
      repeatable). An unknown project is a `404`; a project outside a restricted agent's
      reach is a `403`, as on every project route; a label or epic of a project not in the
      list's scope is a `400`.
- [ ] `sort` is one of `key`, `title`, `priority`, `dueDate`, `created`, `updated`, each
      also with `-`; the default is `-updated`. Tasks with no due date come last both ways.
      A cursor from another `sort` is a `400`.
- [ ] Pages hold no task twice and miss none for every `sort`, both ways, also when tasks
      share the sort value and while tasks are written between pages.
- [ ] A restricted agent's pages are full: the restriction is in the query, not applied to
      a page afterwards.
- [ ] The measurement of WS-118 section 7 is recorded.
- [ ] The OpenAPI document describes the endpoint, its parameters and `TaskListItem`.
- [ ] The full quality gate passes, with `pnpm db:generate` and `pnpm openapi:generate`
      leaving no diff.

## Notes

- No UI: the list view is item E. `docs/agents.md` is item G. The MCP tool over this
  endpoint is a WT-11 follow-up already recorded on `main`.
