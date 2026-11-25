# WS-122 — Task lists stop reading descriptions

- Status: In progress (approved by the owner on 2026-11-25, as proposed)
- Work-item: [WI-122](../work-items/WI-122-task-list-summary-select.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) (a task and its summary);
  [0004](../canonical/0004-api-conventions.md) section 5 (lists);
  [WS-101](WS-101-backlog-api.md), [WS-116](WS-116-task-filters-search.md) and
  [WS-118](WS-118-task-list-across-projects.md) (the three lists)

## Approach

### 1. Starting point, checked against `main` (`14f1de7`)

`src/server/services/tasks.ts` builds one select, `taskSelect()` (as `TASK_SELECT`), with
every column of a task's answer, `t.description` included, and one row type, `TaskRow`.
Three lists use it and map each row with `toSummary` or `toListItem`, which leave the
description out:

- `listTasks` (board order and the deleted list), `TASK_SELECT`;
- `listBacklog`, `TASK_SELECT`;
- `listAllTasks` (WS-118), `taskSelect(sortValues)`.

The single-task reads (`findTask`, `findAnyTask`) also use it, and their callers need the
description: `getTask` and the answers of create, update, move, delete and restore
(`toTask`), and `updateTask`, which keeps `before.description` when the request leaves it
out. Text search reads `t.search` in the `where` clause (WS-116), not the description, so
it is untouched.

### 2. The change

The select is split in two, sharing everything else:

- `taskSelect(extra, { description })`: the column list gains `t.description` only when
  asked. Two constants follow: `TASK_SELECT` (with the description, for `findTask` and
  `findAnyTask`, unchanged) and `SUMMARY_SELECT` (without). `listAllTasks` calls
  `taskSelect(sortValues)`, which leaves the description out by default; `findTask` and
  `findAnyTask` use `TASK_SELECT`.
- The row types split the same way: `SummaryRow` holds every column but the description,
  and `TaskRow extends SummaryRow` adds `description: string`. `toSummary` and
  `toListItem` take a `SummaryRow`; `toTask` takes a `TaskRow`.
- The three lists execute `SUMMARY_SELECT` (or `taskSelect(sortValues)`) as
  `execute<SummaryRow>`. Reading `row.description` in a list is then a type error.

The joins, the label aggregate, the positions and the time formats stay as they are, so
the order, the filters, the cursors and the answers are unchanged. `findLiveTask`, which
returns only an id and a project, still uses `findTask`: one row, not worth a third select
here.

### 3. How the test sees the database

What a list reads from PostgreSQL is not visible in its answer, so the tests wrap the
database the services already accept as their last argument (`db: Database = getDb()`).
A small helper in the test file, `recordingDb()`, returns a `Proxy` of `getDb()` whose
`execute` calls the real one, against the real test database, and keeps the rows it
returned. The test then asserts that no row a list read has a `description` key. Today
every row has one, so the tests fail for the right reason before the change.

### 4. Measurement

Once green, the implementation record gives one measurement, not a gate: with 100 tasks of
50 000-character descriptions, the JSON size of the rows a `limit=100` page of each list
reads, before and after, through the same recording wrapper. No index or plan change is
expected, and none is made.

## Files

| Path                                                | Change                                                   |
| --------------------------------------------------- | -------------------------------------------------------- |
| `src/server/services/tasks.ts`                      | modify: summary select and `SummaryRow` for the lists    |
| `src/server/services/tasks.integration.test.ts`     | modify: tests 1 and 4                                    |
| `src/server/services/backlog.integration.test.ts`   | modify: test 2                                           |
| `src/server/services/all-tasks.integration.test.ts` | modify: test 3                                           |
| WI-122, WS-122                                      | modify: statuses, implementation record with measurement |

No dependency, no migration, no route change. `docs/README.md` changes only by index
commits on `main`: follow-up C05 is marked answered by WI-122 once it is done.

## Data model changes

None.

## API contract

None. The three lists answer the same fields; the generated OpenAPI document is unchanged
(`pnpm openapi:generate` is run to confirm it).

## Test plan (written first, in this order)

Each test creates tasks with a non-empty description and calls the service with
`recordingDb()` (section 3), against the real test database.

| #   | Level       | Test                                                                                                                                                                              | Covers criterion |
| --- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | integration | `tasks.integration.test.ts`: `listTasks`, unfiltered, with a filter and `q`, on a second page by cursor, and the deleted list: no row read has a `description`. Fails today       | 1                |
| 2   | integration | `backlog.integration.test.ts`: `listBacklog`, first and second page and with a filter: no row read has a `description`. Fails today                                               | 1                |
| 3   | integration | `all-tasks.integration.test.ts`: `listAllTasks` for each sort, first and second page: no row read has a `description`. Fails today                                                | 1                |
| 4   | integration | `tasks.integration.test.ts`: `getTask`, and the answers of create, update (without `description`, so it is kept), move, delete and restore, still carry the description they hold | 2                |

Criterion 3 is covered by the existing contract and route tests of the three lists, which
stay as they are, and by the generator's empty diff. Criterion 4 is checked by
`pnpm typecheck` and in review.

## Risks and open questions

1. **The recording wrapper relies on the services' `db` argument.** All three lists take
   one; the wrapper changes nothing but what the test can see. If the owner prefers not to
   proxy the client, the alternative is to export the summary select and check its SQL
   text, which tests the query rather than what is read.
2. **Single-task reads keep reading the description**, including `findLiveTask` for
   comments and activity. They read one row each; a narrower select there can be a later
   item if a measurement shows it matters.

## Deviations from the approved spec

None yet.

## Implementation record

Not started.
