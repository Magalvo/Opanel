# WI-131 — Search and filters end to end, the agents guide, the exit check

- Status: Done (approved by the owner on 2026-11-26, with WS-131; done on 2026-11-26)
- Work-track: [WT-08](../work-tracks/WT-08-search-filters-list-timeline.md) (item G)
- Depends on: [WI-130](WI-130-task-list-view.md) (item E) and
  [WI-119](WI-119-task-timeline.md) (item F), both done
- Work-spec: [WS-131](../work-specs/WS-131-search-exit-check.md)

## Outcome

WT-08 is closed. One end-to-end test finds work as a team does: a Member searches and
filters the list view and reads a task's timeline in the UI, and an agent restricted to
one project searches, filters and reads the activity through the API, seeing nothing of
the other project. `docs/agents.md` tells agent authors about text search, the filters,
the list across projects with its sort, and a task's activity, and its doc check keeps that
true. Docs 0003 and 0004 carry the approved proposals P1 to P3. Each WT-08 exit criterion
is ticked, with a link to the test that covers it.

## Acceptance criteria

- [x] An end-to-end test, through the running app: a Member searches the list view across
      two projects by a word's prefix, filters it and opens a task whose timeline names an
      agent with its badge. A `worker_agent` restricted to one of the projects, with its
      token, searches `GET /api/v1/tasks` by key and by words, filters and sorts it, finds
      only its project's tasks, reads `GET /api/v1/tasks/{taskId}/activity` naming the
      Member, and gets `403` for the other project's list and activity.
- [x] `docs/agents.md` describes `q`, every filter parameter, `none` and `me`, repeated
      parameters, `GET /api/v1/tasks` with `projectId` and `sort`, and
      `GET /api/v1/tasks/{taskId}/activity`.
- [x] The doc check fails when the guide's filter parameters differ from the API's, its
      sort fields differ from `TASK_SORTS`, or it leaves out the two endpoints.
- [x] Doc 0004 section 5 states the filter rules (P1); doc 0003 section 8 says search uses
      the `simple` configuration, a key finds its task, the list view spans projects and
      the sprint filter comes with WT-10 (P2); doc 0003 section 4 says the board is
      filtered by epic (P3).
- [x] Every WT-08 exit criterion is ticked, with a link to the test that covers it. A
      criterion found without a test gets one, failing first when the behaviour is
      missing.
- [x] The full quality gate passes, and `pnpm db:generate` and `pnpm openapi:generate`
      leave no diff. WT-08's `Status:` line says Done.

## Notes

- No feature is added. The MCP tools for search and activity are a separate WT-11
  work-item (the follow-up on `main`, WT-08 question 8).
