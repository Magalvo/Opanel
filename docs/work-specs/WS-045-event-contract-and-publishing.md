# WS-045 — Event contract and publishing

- Status: Approved (approved by the owner on 2026-11-17, questions 1 to 5 as proposed)
- Work-item: [WI-045](../work-items/WI-045-event-contract-and-publishing.md)
- Canonical docs: [0002](../canonical/0002-realtime-sync.md) sections 3 and 4 (amended
  here); [WT-04](../work-tracks/WT-04-realtime-board-sync.md) decisions 1 to 4;
  [0004](../canonical/0004-api-conventions.md) (ids, timestamps); `AGENTS.md` hard rules
  4, 8 and 13

## Approach

### 1. Where things stand

- Every write runs in one `db.transaction` in its service: `tasks.ts` (create, update,
  move, delete, restore), `comments.ts` (create), `columns.ts` (create, update, move,
  delete), `epics.ts` (create, update) and `projects.ts` (create, update, archive,
  unarchive). Each bumps `version` on the row it changes (comments have none).
- Some calls write nothing: `restoreTask` on a task that is not deleted, and `setArchived`
  when the project is already in the asked state, return early. `updateTask`,
  `updateColumn`, `moveColumn`, `updateEpic` and `moveTask` always write and bump
  `version`, even when no field changes.
- `deleteColumn` moves the column's soft-deleted tasks to the first remaining column,
  bumping their `version`, before it deletes the column (WS-032 section 3).
- `comments.ts` has the comment `// WT-04 adds the comment.created notification here.`
- The database client is `postgres` 4.1.1. Its installed `README.md` ("Listen & notify")
  says `NOTIFY` can be sent "as usual in SQL"; `sql.listen` opens one dedicated connection
  for every listener of a client. PostgreSQL delivers a notification only when its
  transaction commits, and notifications of different transactions in commit order.

### 2. The contract: `src/lib/schemas/events.ts`

One strict object per event type, joined in a discriminated union on `type`:

| `type`            | `entity`  | `entityId` is | `version`                                         | extra    |
| ----------------- | --------- | ------------- | ------------------------------------------------- | -------- |
| `task.created`    | `task`    | the task      | the task's, after the write                       |          |
| `task.updated`    | `task`    | the task      | the task's, after the write                       |          |
| `task.moved`      | `task`    | the task      | the task's, after the write                       |          |
| `task.deleted`    | `task`    | the task      | the task's, after the write                       |          |
| `task.restored`   | `task`    | the task      | the task's, after the write                       |          |
| `comment.created` | `comment` | the comment   | `null` (comments have no version)                 | `taskId` |
| `column.changed`  | `column`  | the column    | the column's after the write; `null` when deleted |          |
| `epic.changed`    | `epic`    | the epic      | the epic's, after the write                       |          |
| `project.changed` | `project` | the project   | the project's, after the write                    |          |

Every event also carries:

- `id`: a new UUID (`crypto.randomUUID()`), so two events are never identical (PostgreSQL
  drops identical payloads sent in one transaction);
- `projectId`: the project the entity belongs to (for `project.changed`, its own id);
- `actorAccountId`: the acting account (`actor.accountId`), as the history and audit log
  record it (hard rule 8);
- `at`: when the event was built, as an ISO 8601 UTC timestamp with milliseconds (doc
  0004), from the app's clock (question 2).

All ids are lowercase UUIDs; `version` is a positive integer or `null` only where the
table says. Exported: `projectEventSchema` (the union), `ProjectEvent`,
`PROJECT_EVENT_TYPES`, and `EVENTS_CHANNEL = "opanel_events"`. The schemas get a `meta({ id
})` so that WI-047 can reference them from the OpenAPI document; they are not referenced by
any operation yet, so the generated document does not change.

### 3. Publishing: `src/server/services/events.ts`

```ts
/** What a service gives; `id` and `at` are added here. */
export type ProjectEventInput = DistributiveOmit<ProjectEvent, "id" | "at">;

/** Sends the event on EVENTS_CHANNEL inside the caller's transaction. */
export async function publishEvent(tx: Executor, event: ProjectEventInput): Promise<void>;
```

It adds `id` and `at`, validates the whole event with `projectEventSchema.parse` (a
mistake in a service fails the write in tests rather than sending a malformed event), and
runs `select pg_notify(${EVENTS_CHANNEL}, ${JSON.stringify(event)})` on the given
transaction. It takes the transaction, never the pool, so an event cannot be sent outside
the write it describes. Services are the only callers (they are the only code that touches
the database).

### 4. Which call sends which event

Each call is placed in the service's transaction after the write and its history event or
audit entry, using the version the write returned:

| Service call                                 | Event             | When                               |
| -------------------------------------------- | ----------------- | ---------------------------------- |
| `createTask`                                 | `task.created`    | always                             |
| `updateTask`                                 | `task.updated`    | always (it always bumps `version`) |
| `moveTask`                                   | `task.moved`      | always, also within one column     |
| `deleteTask`                                 | `task.deleted`    | always                             |
| `restoreTask`                                | `task.restored`   | only when the task was deleted     |
| `createComment`                              | `comment.created` | always                             |
| `createColumn`, `updateColumn`, `moveColumn` | `column.changed`  | always                             |
| `deleteColumn`                               | `column.changed`  | always, with `version: null`       |
| `createEpic`, `updateEpic`                   | `epic.changed`    | always                             |
| `updateProject`                              | `project.changed` | always                             |
| `archiveProject`, `unarchiveProject`         | `project.changed` | only when the state changes        |
| `createProject`                              | none              | no board of it can be open yet     |

The soft-deleted tasks that `deleteColumn` moves send no task events (question 1): no
board, task detail or epics page shows a deleted task, and the deleted-tasks list of the
project settings reloads on the `column.changed` that follows (WI-049).

The comment in `comments.ts` is replaced by the call.

### 5. Canonical doc 0002, amended

Section 3: the event example gains `type` and `projectId`; the list of types becomes the
nine of section 2 above; a short table states `entity`, `version` (`null` for comments and
for a deleted column) and `taskId` on `comment.created`; one paragraph says every write
sends its event in its own transaction, the channel is `opanel_events`, and the hub routes
by `projectId`. Section 4 gains the echo rule of WT-04 decision 4: a client ignores an
event whose `version` is not newer than what it holds, and refetches otherwise; it does not
compare `actorAccountId`, so the same person's other tabs stay in sync. A line under the
status records the amendment (WT-04, 2026-11-16) and points to this work-spec.

### 6. Test helper: `src/server/services/events-testing.ts`

`listenForEvents()` opens its own `postgres` client (from `DATABASE_URL`, one connection),
calls `sql.listen(EVENTS_CHANNEL, ...)`, and returns:

- `events()`: what was received so far, each parsed with `projectEventSchema`;
- `settle()`: sends a sentinel notification on the same channel from the pool, after the
  call under test returned, and waits until it arrives. Because notifications of
  different transactions are delivered in commit order, every event committed before it
  has then arrived, without timers. The sentinel is not a valid event and is filtered out;
- `close()`: ends the client.

It is used by the integration tests only, like `src/server/auth/testing.ts`.

## Files

| Path                                                                                   | Change                                   |
| -------------------------------------------------------------------------------------- | ---------------------------------------- |
| `src/lib/schemas/events.ts`                                                            | create                                   |
| `src/lib/schemas/events.test.ts`                                                       | create (unit, tests first)               |
| `src/server/services/events.ts`                                                        | create                                   |
| `src/server/services/events-testing.ts`                                                | create (integration test helper)         |
| `src/server/services/events.integration.test.ts`                                       | create (real database, tests first)      |
| `src/server/services/tasks.ts`, `comments.ts`, `columns.ts`, `epics.ts`, `projects.ts` | modify: `publishEvent` calls             |
| `docs/canonical/0002-realtime-sync.md`                                                 | modify: the amendment of section 5 above |
| `docs/README.md`, WT-04, WI-045, WS-045                                                | modify: statuses                         |

No new dependency, no migration, no API change.

## Data model changes

None. `NOTIFY` needs no table.

## API contract

None in this item. The event schemas are written here and documented by the events
endpoint (WI-047).

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                                                          | Covers criterion |
| --- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit        | `projectEventSchema` accepts a valid example of each of the nine types, and `PROJECT_EVENT_TYPES` lists exactly them                                                                                                          | contract         |
| 2   | unit        | it refuses: a type with the wrong `entity`; `comment.created` without `taskId`; `taskId` on another type; `version: null` on a task, epic or project event; an unknown field; a non-UUID id; a non-ISO `at`                   | contract         |
| 3   | unit        | the largest valid event serialises to far less than PostgreSQL's 8 000-byte payload limit (under 1 000 bytes)                                                                                                                 | payload size     |
| 4   | integration | `publishEvent` inside a committed transaction: one notification on `opanel_events`, parsed by the schema, with a fresh `id` and an `at` within the test's time; two calls send two distinct events                            | publishing       |
| 5   | integration | `publishEvent` inside a transaction that rolls back: nothing arrives                                                                                                                                                          | rollback         |
| 6   | integration | an event that does not match the schema throws, and the transaction rolls back                                                                                                                                                | validation       |
| 7   | integration | for each row of the table of section 4 with "always": the call sends exactly one event of its type, with the right `projectId`, `entityId`, `version` (equal to the one the call returned, or `null` where stated), and actor | mapping          |
| 8   | integration | `comment.created` carries the task's id as `taskId`; `project.changed` has `entityId` equal to `projectId`                                                                                                                    | mapping          |
| 9   | integration | an `updateTask` that changes no field and a `moveTask` within one column each send their event, with the bumped version                                                                                                       | no-op writes     |
| 10  | integration | `restoreTask` on a task that is not deleted, `archiveProject` on an archived project and `unarchiveProject` on an active one send nothing; `createProject` sends nothing                                                      | nothing written  |
| 11  | integration | `deleteColumn` with soft-deleted tasks in it sends one `column.changed` with `version: null`, and no task event                                                                                                               | column delete    |
| 12  | integration | refused calls send nothing: a stale `version`, a Viewer's write, a write to an archived project                                                                                                                               | refusal          |
| 13  | integration | a write whose audit write fails (`failAuditFor("column.created")`) or whose history write fails (a trigger on `task_events`, as in WS-030) sends nothing                                                                      | rollback         |
| 14  | integration | a service call made inside an outer transaction that then rolls back sends nothing                                                                                                                                            | rollback         |
| 15  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm db:generate` and `pnpm openapi:generate` leave no diff                                                                                                         | gate             |

The existing tests of every service keep passing unchanged: an event is an addition to
the transaction, not a change of what it writes or returns.

## Risks and open questions

For the owner:

1. **Deleted tasks moved by a column delete send no task events.** They are invisible
   everywhere except the deleted-tasks list, which reloads on `column.changed`. Sending
   one `task.moved` per deleted task would tell open boards about tasks they do not show.
   **Recommend: as proposed.**
2. **`at` comes from the app's clock**, when the event is built, not from the database's
   commit time. It is informative only: ordering and freshness come from `version`.
   **Recommend: as proposed.**
3. **`type` is in the payload** as well as being the SSE event name in WI-047, so the hub
   and the client parse one self-describing object. **Recommend: as proposed.**
4. **A failed `NOTIFY` fails the write.** PostgreSQL refuses a commit when its
   notification queue (8 GB by default) is full, which only happens if a listener stops
   reading for a long time. The write is then refused rather than silently unannounced.
   **Recommend: accept; WI-046's hub reads continuously.**
5. **Timing of the integration tests.** The helper of section 6 relies on PostgreSQL
   delivering notifications in commit order, as documented, instead of waiting a fixed
   time. **Recommend: as proposed.**
