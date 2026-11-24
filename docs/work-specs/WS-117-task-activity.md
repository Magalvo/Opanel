# WS-117 — Task activity: history and comments in one list

- Status: Proposed
- Work-item: [WI-117](../work-items/WI-117-task-activity.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) section 9;
  [0004](../canonical/0004-api-conventions.md) section 5 (cursors with microsecond
  precision); [WT-08](../work-tracks/WT-08-search-filters-list-timeline.md) decisions 10,
  11 and 13, question 7; the follow-up on `main` from WS-074 section 6 (actors as
  `AccountRef`)

## Approach

### 1. Starting point, checked against `main` (`44c9c40`)

What the history holds today, by writer:

| Writer                                    | `type`                | `field`, values                                                                                                                               |
| ----------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `createTask` (`services/tasks.ts`)        | `created`             | new: `{ key, type, title, columnId, severity?, priority?, dueDate?, labels? }`                                                                |
| `updateTask`                              | `field_changed`       | `title`, `description`, `type`, `severity`, `priority`, `dueDate`: the values; `assigneeTeamId`, `assigneeAccountId`, `epicId`: ids or `null` |
| `updateTask`, `deleteLabel` (`labels.ts`) | `field_changed`       | `labels`: lists of `{ id, name }`                                                                                                             |
| `moveTask`                                | `moved`               | `{ columnId }` old and new, `null` for the backlog; a move within one column writes nothing                                                   |
| `deleteTask`, `restoreTask`               | `deleted`, `restored` | none                                                                                                                                          |
| `createComment`, `addSystemComment`       | `commented`           | none; the comment is the record                                                                                                               |
| the triage pipeline (`bug-reports.ts`)    | `reported_again`      | new: `{ reportId, occurrences }`                                                                                                              |

- `task_events` has `task_events_task_idx` on `(task_id, created_at, id)`; `comments` has
  `comments_task_idx` on the same columns. `id` is a `bigint` in one and a `uuid` in the
  other.
- `listComments` (`services/comments.ts`) reads comments with `COMMENT_SELECT` and
  `toComment`, which are private to that file.
- Accounts are never deleted (the foreign keys `restrict`). Teams and empty columns can be
  deleted; epics cannot today, but the reader does not rely on it.

### 2. The list

`listActivity(actor, taskRef, query)` in a new `src/server/services/activity.ts`:

1. `requirePermission(actor, "tasks:read")`; `findLiveTask`, else `404`;
   `requireProjectAccess(actor, task.projectId)`. The same order and answers as
   `listComments`.
2. One query for the page's keys, over a `union all`:

   ```sql
   select 'comment' as kind, c.id::text as id, c.created_at from comments c
     where c.task_id = $task
   union all
   select 'event', e.id::text, e.created_at from task_events e
     where e.task_id = $task and e.type <> 'commented'
   ```

   ordered by `(created_at, kind, id)` and cut after the cursor and at `limit + 1`. Each
   branch uses its index; the sort is over one task's items.

3. The comments of the page, by id, with `COMMENT_SELECT` and `toComment`, which
   `comments.ts` exports for this; the events of the page, by id, with the actor joined
   as `AccountRef`.
4. The names (section 3), then the items in the page's order.

The cursor is `{ createdAt, kind, id }`, `createdAt` as text with microseconds (doc 0004
section 5), encoded by a new `encodeActivityCursor` and `decodeActivityCursor` beside
the board and backlog cursors in `src/server/http/pagination.ts`; a tampered cursor is a
`400` with the field error `cursor`. Comparing `id` as text gives
a stable total order within a timestamp and kind, which is all a keyset needs; it is not
the insertion order, which only matters for two items of one kind written in the same
microsecond. `limit` is 50 by default, at most 100 (the shared page schema).

### 3. Named values

From the page's events, collect the ids of accounts (`assigneeAccountId`), teams
(`assigneeTeamId`), epics (`epicId`) and columns (`moved` and `created`'s `columnId`), then
read each kind in one query (at most four per page). An event's values are then answered
as:

| Stored                                      | Answered                                                         |
| ------------------------------------------- | ---------------------------------------------------------------- |
| `assigneeAccountId` old or new, an id       | `AccountRef` (`{ id, name, kind }`)                              |
| `assigneeTeamId` old or new, an id          | `{ id, name }`, `name: null` for a deleted team                  |
| `epicId` old or new, an id                  | `{ id, name }` with the epic's title, `name: null` if it is gone |
| `moved` `{ columnId }`                      | `{ column: { id, name } }`, `column: null` for the backlog       |
| `created`'s `columnId`                      | replaced by `column`, as for `moved`                             |
| `null`                                      | `null`                                                           |
| anything else (text, dates, labels, counts) | as stored                                                        |

`field` keeps its stored name (`assigneeAccountId`, `epicId`, …), so a reader knows which
shape to expect. Names are read now, not when the change happened: a renamed team shows its
new name in old entries (question 1).

### 4. The schemas

In a new `src/lib/schemas/activity.ts`:

- `namedRefSchema`: `{ id: uuid, name: string | null }`, id `NamedRef`.
- `activityEventSchema`: `kind: "event"`, `id` (a string: a `bigint` does not fit a JSON
  number safely), `type` (the event types except `commented`), `field` (string or `null`),
  `oldValue` and `newValue` (`z.json()` or `null`, described field by field in the
  schema's description, from the table of section 3), `actor` (`AccountRef` or `null`),
  `createdAt`. Id `TaskActivityEvent`.
- `activityCommentSchema`: `kind: "comment"`, `comment: commentSchema`. Id
  `TaskActivityComment`.
- `activityItemSchema`: a discriminated union on `kind`; `activityPageSchema` its page;
  `activityQuerySchema` the shared page query.
- `listActivityContract`: `GET /api/v1/tasks/{taskId}/activity`, `tasks:read`, `200`,
  `400`, `403`, `404`, registered with the other contracts.

### 5. The route

`src/app/api/v1/tasks/[taskId]/activity/route.ts`: read the params and query, call
`listActivity`, answer the page. No other logic (`AGENTS.md` section 3).

## Files

| Path                                                               | Change                                          |
| ------------------------------------------------------------------ | ----------------------------------------------- |
| `src/lib/schemas/activity.ts`                                      | create: section 4                               |
| `src/lib/schemas/activity.test.ts`                                 | create: the item union refuses a wrong `kind`   |
| `src/lib/openapi/contracts.ts`                                     | modify: register `listActivityContract`         |
| `src/server/services/comments.ts`                                  | modify: export `COMMENT_SELECT` and `toComment` |
| `src/server/services/activity.ts`                                  | create: `listActivity`                          |
| `src/server/services/activity.integration.test.ts`                 | create: tests 2 to 8                            |
| `src/app/api/v1/tasks/[taskId]/activity/route.ts`                  | create                                          |
| `src/app/api/v1/tasks/[taskId]/activity/route.integration.test.ts` | create: test 9                                  |
| `src/server/http/pagination.ts`                                    | modify: the activity cursor                     |
| `src/server/services/project-access.integration.test.ts`           | modify: `listActivity` in the coverage list     |
| `src/lib/openapi/document.test.ts`                                 | modify: test 10                                 |
| `docs/work-items/WI-117-...`, this file                            | modify: statuses, implementation record         |

## Data model changes

None. The two indexes it reads exist.

## API contract

`GET /api/v1/tasks/{taskId}/activity`, permission `tasks:read`.

- Query: `limit` (1 to 100, default 50), `cursor`.
- `200`: `{ items: (TaskActivityComment | TaskActivityEvent)[], nextCursor }`, oldest first.
- `400`: a bad path, `limit` or cursor. `403`: the task's project is outside a restricted
  agent's reach. `404`: no such task, or it is deleted.
- New endpoint: not breaking.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                           | Covers criterion |
| --- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit        | `activityItemSchema` reads both kinds and refuses an unknown `kind` and a `commented` event                                                    | 2                |
| 2   | integration | a task created, edited, commented and moved lists `created`, the changes and the comment in order, with no `commented` entry                   | 1, 2             |
| 3   | integration | each `field_changed` field reads back: the scalars as stored, assignee as `AccountRef`, team and epic as `{ id, name }`, labels as stored      | 3, 4             |
| 4   | integration | `moved` to the backlog and back, `deleted` and `restored`, `reported_again` from a repeated bug report, and labels removed by deleting a label | 4                |
| 5   | integration | a deleted team and a deleted column are answered with `name: null`; a renamed team with its new name                                           | 3                |
| 6   | integration | an agent's change has the agent as `AccountRef` with `kind: "agent"`                                                                           | 2                |
| 7   | integration | pages of 2 over items with equal timestamps, and a comment added between pages, give every item once                                           | 5                |
| 8   | integration | `404` for a deleted or unknown task; `403` for a restricted agent; `403` without `tasks:read`                                                  | 1                |
| 9   | integration | the route answers the page by key and by id, and `400` for a bad cursor                                                                        | 1                |
| 10  | unit        | the OpenAPI document has the operation, its permission and both item schemas                                                                   | 6                |

## Risks and open questions

Questions for the owner, each with a recommendation:

1. **Names now or names then.** A renamed team or column shows its current name in old
   entries, since the history stores ids. Storing names in each entry would keep the old
   name but changes every writer and leaves the entries written so far without one.
   **Recommend: names now, as WT-08 decision 11 says;** labels already keep their old
   names.
2. **Raw values for every other field.** `oldValue` and `newValue` stay JSON whose shape
   depends on `field`, documented in the schema, rather than one typed schema per field.
   A typed union would be exact in OpenAPI but would make every new field a schema
   change. **Recommend: JSON values, documented per field.**

Risks:

- **History written before WT-07** has no `priority`, `dueDate` or `labels` entries;
  nothing reads them differently. `created` entries from before WI-101 always have a
  `columnId`.
- **A comment and its `commented` entry share a timestamp**; leaving `commented` out
  avoids a double. Test 2 checks it.
- **Raw SQL** (follow-up D08): the union and the name reads are raw `sql`; tests 3 to 5
  cover every column they read.
