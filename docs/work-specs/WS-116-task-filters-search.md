# WS-116 — Task filters and text search on the project lists

- Status: In progress (approved by the owner on 2026-11-24, questions 1 and 2 as recommended)
- Work-item: [WI-116](../work-items/WI-116-task-filters-search.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) section 8;
  [0004](../canonical/0004-api-conventions.md) section 5 (filters, the `400` of a query);
  [WT-08](../work-tracks/WT-08-search-filters-list-timeline.md) decisions 1, 2, 3, 6,
  questions 1 and 4

## Approach

### 1. Starting point, checked against `main` (`44c9c40`)

- `listTasks` (`src/server/services/tasks.ts`) takes `columnId` (one column, checked to
  belong to the project, else `400`) and `deleted`; `listBacklog` takes a page only. Both
  build raw `sql` on `TASK_SELECT`, whose aliases are `t` (tasks), `p` (projects), `c`
  (columns, a left join), `r` (reporter), `tm`, `a` and `e`.
- `readQuery` (`src/server/http/route.ts`) already turns a repeated parameter into an
  array and a single one into a string.
- `task_labels` already has `task_labels_label_idx` on `label_id`; nothing covers
  `due_date` or `reporter_account_id`; there is no search column.
- The next migration is `0022`.

### 2. The filter schema

In `src/lib/schemas/tasks.ts`:

- `oneOrMany(value)`: `z.union([value, z.array(value).min(1).max(20)])`, transformed to an
  array, so `priority=high` and `priority=high&priority=urgent` read the same. The
  OpenAPI document shows it as an array parameter (risk 1).
- `taskFilterSchema`, a strict object of optional fields:

  | Field               | Schema                                                                         |
  | ------------------- | ------------------------------------------------------------------------------ |
  | `q`                 | trimmed, 1 to 200 characters, with at least one letter or digit (`\p{L}\p{N}`) |
  | `type`              | `oneOrMany(taskTypeSchema)`                                                    |
  | `category`          | `oneOrMany` of the column categories                                           |
  | `done`              | `"true"` or `"false"`, read as a boolean                                       |
  | `assigneeTeamId`    | `oneOrMany(uuid or "none")`                                                    |
  | `assigneeAccountId` | `oneOrMany(uuid, "none" or "me")`                                              |
  | `reporterAccountId` | `oneOrMany(uuid or "me")`                                                      |
  | `reporterKind`      | `"human"` or `"agent"`                                                         |
  | `labelId`           | `oneOrMany(uuid)`                                                              |
  | `epicId`            | `oneOrMany(uuid or "none")`                                                    |
  | `priority`          | `oneOrMany(prioritySchema)`                                                    |
  | `severity`          | `oneOrMany(severitySchema)`                                                    |
  | `dueFrom`, `dueTo`  | `calendarDateSchema`; a refinement refuses `dueFrom` after `dueTo` (`dueTo`)   |

- `taskListQuerySchema` becomes the page, `deleted`, `taskFilterSchema` and
  `columnId: oneOrMany(uuid or "backlog")`. `backlogQuerySchema` becomes the page and
  `taskFilterSchema` (no `columnId`: every backlog task has none).
- `TaskFilter`, the parsed type, is what the service takes.

### 3. One SQL builder

A new `src/server/services/task-filter.ts` exports
`taskFilterWhere(filter, { actor, projectId }): Promise<SQL>`, which returns `and ...`
conditions over the aliases of `TASK_SELECT`, one per present field, each with bound
parameters only:

| Field               | Condition                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| `type`              | `t.type in (...)`                                                                                   |
| `columnId`          | `t.column_id in (...)`, or `t.column_id is null` for `backlog`, joined by `or`                      |
| `category`          | `c.category in (...)` (a backlog task has no category, so never matches)                            |
| `done`              | `c.category is not distinct from 'done'` when true; `c.category is distinct from 'done'` when false |
| `assigneeTeamId`    | `t.assignee_team_id in (...)`, `or t.assignee_team_id is null` for `none`                           |
| `assigneeAccountId` | as above, `me` replaced by the actor's account id                                                   |
| `reporterAccountId` | `t.reporter_account_id in (...)`, `me` replaced                                                     |
| `reporterKind`      | `r.kind = ...`                                                                                      |
| `labelId`           | `exists (select 1 from task_labels tl where tl.task_id = t.id and tl.label_id in (...))`            |
| `epicId`            | `t.epic_id in (...)`, `or t.epic_id is null` for `none`                                             |
| `priority`          | `t.priority in (...)`                                                                               |
| `severity`          | `t.severity in (...)`                                                                               |
| `dueFrom`, `dueTo`  | `t.due_date >= ...`, `t.due_date <= ...` (a `null` due date never matches)                          |
| `q`                 | section 4                                                                                           |

Before building, it checks in one query that every `columnId`, `labelId` and `epicId`
belongs to `projectId`, and throws `400` with the field's path and "Not a column (label,
epic) of this project." otherwise, as `columnId` does today. Account and team ids are not
checked: an unknown one matches nothing, and checking would tell a restricted agent which
ids exist. `listTasks` and `listBacklog` add the result to their `where`, after the
project condition and before the cursor; nothing else in them changes (WT-08 decision 3).
The existing single-column check moves into the builder.

### 4. Text search

**The column.** `tasks.search`, a stored generated `tsvector`:

```sql
setweight(to_tsvector('simple', title), 'A') ||
setweight(to_tsvector('simple', description), 'B')
```

with `tasks_search_idx`, a GIN index. Drizzle has no `tsvector` type, so the schema uses
a `customType` and `generatedAlwaysAs` (hard rule 13: read the installed Drizzle's
documentation for both first). Being generated, it is never written by the services and
is current as soon as a write commits; `TASK_SELECT` does not read it.

**The query.** In the builder:

1. If `q`, upper-cased, is a task key (`taskKeySchema`), the condition is that key:
   `p.key = ... and t.number = ...`. The word search is not used.
2. Otherwise, split `q` on whitespace. If its last piece is letters and digits only, the
   condition is
   `t.search @@ (plainto_tsquery('simple', <the rest>) && to_tsquery('simple', <last> || ':*'))`;
   otherwise `t.search @@ plainto_tsquery('simple', q)`. With one word, the rest is empty
   and only the `to_tsquery` part is used.

`plainto_tsquery` parses the words exactly as `to_tsvector` parsed the task, so dashes,
emails and versions match as they were indexed; it never reads operators from `q`.
`to_tsquery` sees only letters and digits, so `q` cannot inject query syntax; both are
bound parameters. The schema already refuses a `q` with no letter or digit, which
`simple` (no stop words) always turns into at least one lexeme, so no search silently
matches everything.

### 5. Other indexes

`tasks_due_date_idx` on `due_date` and `tasks_reporter_idx` on `reporter_account_id`
(WT-08 decision 6). `labelId` uses the existing `task_labels_label_idx`; type, priority and
severity have few values and are filtered after the project's rows are found, so they get
none unless section 6 shows the need.

### 6. Measurement

A script, `scripts/measure-task-search.ts` (not run by the gate), fills a scratch database
with one project of 50 000 tasks (titles and descriptions from a fixed word list, 20
labels, 5 epics, 3 columns and a backlog), then runs each list with each filter, three
searches (a common word, a rare word, a two-letter prefix) and a combination, under
`explain (analyze, buffers)`, and prints the median of 5 runs. It creates the 50 000
tasks before applying migration `0022`, times it, and checks that a search then finds
them. Limits, on a developer machine (question 2 below):

- a first page of 50, any filter or search: median under 100 ms;
- the migration on 50 000 tasks: under 60 s.

The results and plans go into the "Implementation record". A limit missed is raised with
the owner before adding indexes outside section 5.

### 7. OpenAPI

The two contracts take the new query schemas; their descriptions say that filters only
leave tasks out and that repeated parameters mean any of the values. `document.test.ts`
gains one test for the array parameters.

## Files

| Path                                                                    | Change                                                    |
| ----------------------------------------------------------------------- | --------------------------------------------------------- |
| `src/lib/schemas/tasks.ts`                                              | modify: `oneOrMany`, `taskFilterSchema`, the list queries |
| `src/lib/schemas/task-filter.test.ts`                                   | create: unit tests of the schema                          |
| `src/server/db/schema/tasks.ts`                                         | modify: `search` column and three indexes                 |
| `src/server/db/migrations/0022_task_search.sql` and its snapshot        | create (generated)                                        |
| `src/server/services/task-filter.ts`                                    | create: `taskFilterWhere`                                 |
| `src/server/services/task-filter.integration.test.ts`                   | create: one test per filter, combinations, search         |
| `src/server/services/tasks.ts`                                          | modify: `listTasks`, `listBacklog` use the builder        |
| `src/app/api/v1/projects/[projectId]/tasks/route.integration.test.ts`   | create: the route with filters, `400`s                    |
| `src/app/api/v1/projects/[projectId]/backlog/route.integration.test.ts` | modify: filters on the backlog route                      |
| `src/lib/openapi/document.test.ts`                                      | modify: array query parameters                            |
| `scripts/measure-task-search.ts`                                        | create: section 6                                         |
| `docs/work-items/WI-116-...`, this file                                 | modify: statuses, implementation record                   |

## Data model changes

Migration `0022_task_search`:

- `tasks.search tsvector generated always as (...) stored` (section 4);
- `tasks_search_idx` using `gin (search)`;
- `tasks_due_date_idx` on `(due_date)`, `tasks_reporter_idx` on `(reporter_account_id)`.

Adding a stored generated column rewrites `tasks` under an exclusive lock, once. Its
duration is measured (section 6) and goes to `docs/operations.md`'s upgrade notes in item G
if it is over 10 s on 50 000 tasks.

## API contract

- `GET /api/v1/projects/{projectId}/tasks` (`tasks:read`): the page, `deleted`, every
  filter of section 2 and `columnId` repeatable with `backlog`. Unchanged answer.
- `GET /api/v1/projects/{projectId}/backlog` (`tasks:read`): the page and every filter of
  section 2. Unchanged answer.
- `400` with the field's error: an unknown value, more than 20 values, `dueFrom` after
  `dueTo`, a `q` with no letter or digit or over 200 characters, a column, label or epic
  of another project.
- New parameters are not breaking (doc 0004 section 8).

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                       | Covers criterion |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| 1   | unit        | `taskFilterSchema` reads one value and repeats as arrays, refuses 21 values, unknown values, `dueFrom` after `dueTo`, and `q` of `"--"`    | 1                |
| 2   | integration | each filter alone on the board list, one test per field of section 3, with a task that matches and one that does not                       | 2, 3             |
| 3   | integration | any of a repeated parameter, all of different ones, and a filter across pages keeps the board order and the cursor                         | 2                |
| 4   | integration | `none`, `me` for a person and for an agent, `columnId=backlog` with `deleted=true`, `done=false` on a backlog task                         | 3                |
| 5   | integration | the backlog list with filters keeps the backlog order                                                                                      | 2                |
| 6   | integration | a column, label or epic of another project is a `400` with its path; an unknown account id matches nothing                                 | 4                |
| 7   | integration | search: a key in lower case finds that task only; two words; a prefix; a word only in the description; no match; punctuation in `q`        | 5                |
| 8   | integration | a task renamed in one request is found by its new title in the next                                                                        | 5                |
| 9   | integration | a task inserted by raw SQL, with no service involved, is found: the database computes the column, so rows from before `0022` are found too | 6                |
| 10  | integration | the route: query strings with repeats reach the service, and a `400` names the field                                                       | 1, 2             |
| 11  | unit        | the OpenAPI document shows `priority` and `labelId` as array query parameters                                                              | 8                |
| 12  | manual      | `scripts/measure-task-search.ts`, results recorded                                                                                         | 7                |

## Risks and open questions

Questions for the owner, each with a recommendation:

1. **Should an unknown account or team id be a `400`**, like a column of another project?
   **Recommend: no** (section 3). Matching nothing tells a restricted agent nothing about
   which ids exist, and a shared link that names a deleted team still opens.
2. **The limits of section 6**: a first page under 100 ms and the migration under 60 s on
   50 000 tasks, on a developer machine. **Recommend: these limits**, with a missed limit
   brought back to the owner rather than fixed with unplanned indexes.

Risks:

- **Arrays in query parameters and OpenAPI.** `zod-openapi` 6.0.2 must describe a
  `union` of a value and an array, transformed, as an array parameter. If it does not, the
  schema declares the parameter's OpenAPI shape with `.meta({ override })`; test 11 holds
  either way.
- **The migration rewrites `tasks`** under an exclusive lock, once (Data model changes);
  measured in section 6.
- **The search column grows the table** by about the size of the text; the measurement
  records it.
- **`me` in a link** shows each viewer their own work (WT-08 decision 8); for an agent,
  `me` is the agent. Recorded for item D.
