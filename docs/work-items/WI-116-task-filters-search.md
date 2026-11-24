# WI-116 — Task filters and text search on the project lists

- Status: Proposed
- Work-track: [WT-08](../work-tracks/WT-08-search-filters-list-timeline.md) (item A)
- Depends on: none
- Work-spec: [WS-116](../work-specs/WS-116-task-filters-search.md)

## Outcome

A project's board list and backlog can be narrowed to the tasks someone is looking for.
People and agents with `tasks:read` send the filters of WT-08 decision 1 and a text search
`q` as query parameters, and get only the matching tasks, in the usual order and pages. One
filter schema and one SQL builder serve both lists now and the list across projects (item
B) later. Searching stays fast on a project with 50 000 tasks.

## Acceptance criteria

- [ ] `taskFilterSchema` in `src/lib/schemas/tasks.ts` accepts each parameter of WT-08
      decision 1 except `projectId`, once or repeated (at most 20 values), and refuses
      unknown values, `dueFrom` after `dueTo`, and a `q` with no letter or digit, with
      `400` and the field's error.
- [ ] `GET /projects/{projectId}/tasks` and `GET /projects/{projectId}/backlog` apply every
      filter: a repeated parameter keeps tasks matching any value, different parameters
      must all hold, and order and cursors are unchanged (a filter only leaves tasks out).
- [ ] `none` matches an empty assignee team, assignee or epic; `me` matches the calling
      account, person or agent; `columnId=backlog` matches tasks with no column;
      `done=false` counts backlog tasks as not done.
- [ ] A `columnId`, `labelId` or `epicId` that is not the project's is a `400`; an unknown
      account or team id matches nothing.
- [ ] `q` that is a task key (any case) finds that task only; otherwise every word of `q`
      must be a word of the title or description, the last as a prefix, with the `simple`
      configuration. A task's new words are found as soon as its write commits.
- [ ] A migration adds the generated search column, its GIN index and indexes on
      `due_date` and `reporter_account_id`; existing tasks are searchable after it.
- [ ] The measurements of WS-116 section 6, with 50 000 tasks, are within its limits and
      recorded in WS-116.
- [ ] The OpenAPI document describes every new parameter, repeatable ones as arrays.
- [ ] The full quality gate passes, with `pnpm db:generate` and `pnpm openapi:generate`
      leaving no diff.

## Notes

- No UI: the filter bar is item D. `docs/agents.md` is item G.
- The list across projects, `sort` and project restrictions in SQL are item B.
