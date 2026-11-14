# WS-031 — Move a task between and within columns

- Status: Done (approved by the owner on 2026-11-14, questions 1 to 3 as proposed)
- Work-item: [WI-031](../work-items/WI-031-move-task.md)
- Canonical docs: [0002](../canonical/0002-realtime-sync.md) section 4;
  [0003](../canonical/0003-task-management.md) sections 5, 9;
  [0004](../canonical/0004-api-conventions.md) section 6;
  [WT-03](../work-tracks/WT-03-board-core.md) decisions 4, 5, 6, 7, 13

## Approach

### 1. The operation

| Operation                          | Access        | Success | Specific errors                                                     |
| ---------------------------------- | ------------- | ------- | ------------------------------------------------------------------- |
| `POST /api/v1/tasks/{taskId}/move` | `tasks:write` | `200`   | `400`, `404`, `409 version_conflict`, `409 project_archived`, `415` |

`taskId` is the id or the key, as for every task path (WS-030). The response is the task
after the move (`Task`). A move is its own operation, not a `PATCH` field (decision 6), so
WT-04 can announce it as `task.moved`.

```ts
moveTask = {
  columnId: uuid,              // a column of the task's project; may be its current column
  afterTaskId?: uuid,          // place right after this task of that column
  beforeTaskId?: uuid,         // or right before this one
  version: int >= 1,
}                              // strict; at most one of afterTaskId / beforeTaskId
```

- **Neither anchor**: the task goes to the end of the column.
- **One anchor, not both.** Decision 6 lists both as optional. Sending both would let a
  client with a stale view name two tasks that are no longer next to each other, and a key
  computed between them could land on another task's key. With one anchor the server reads
  the anchor's actual neighbour inside the transaction: "after X" means between X and the
  task now following X; "before Y" means between the task now preceding Y and Y. The board
  sends `afterTaskId` for a drop below a card and `beforeTaskId` for a drop above the first
  loaded card of a column it has only partly loaded. Sending both is a `400`.
- **Anchor checks**: the anchor must be a task, not deleted, in the target column, and not
  the moved task itself; otherwise `400` with the field error on the anchor. `columnId`
  must be a column of the task's project; otherwise `400` on `columnId`.
- **No workflow rules** (doc 0003 section 5): any column of the project may be the target.

### 2. Steps, in one transaction

1. Find the task (not deleted; `404` otherwise) and take the project's shared lock
   (`lockWritableProject`, `409 project_archived` if archived).
2. **Lock the target column row** (`select ... from columns where id = $1 and project_id =
$2 for no key update`). Moves and creations into one column run one at a time from
   here, and the statements that follow see every task committed into it before.
3. Lock the task row (`for update of t`) and compare `version`; a mismatch is
   `409 version_conflict` with the task as `current` (the WS-030 edit pattern).
4. Compute the new position from the anchor and its actual neighbour in the target
   column, leaving the moved task out: `positionBetween(previous, next)`.
5. If the task would land where it already is (same column, same neighbours), keep its
   position. Either way, update `column_id`, `position`, `version + 1`, `updated_at`.
6. If the column changed, record a `moved` event: `old_value` `{ "columnId": from }`,
   `new_value` `{ "columnId": to }`, the actor recorded (hard rule 8).

Deleted tasks keep their positions (WI-032 restores them in place), so neighbours and
"end of column" are computed over all of a column's tasks, deleted or not, while anchors
must be live tasks.

### 3. Creations take the same column lock

`createTask` (WS-030) computes "end of column" too. Without the column lock, a creation
and a move to the end of the same column could compute the same key and one of them would
fail on `tasks_column_position_idx`. `createTask` therefore also locks its target column
row (`for no key update`) after `claimTaskNumber`, before reading the column's last task.
Lock order is the same everywhere: project row, then column row, then task row, so moves,
creations and edits cannot deadlock. Column writes (WI-029) take the project row in
`no key update` mode, which already excludes moves and creations in that project.

Doc 0002 says "concurrent moves of different cards do not conflict". They still do not
fail: moves into the same column wait for each other for the length of a short
transaction; moves into different columns do not wait at all.

### 4. History

Only a change of column is recorded, as `moved`. Reordering inside a column bumps
`version` (so other clients see their view is stale) but records no event: the activity
history of doc 0003 section 9 describes what happened to the work, and "moved one place
up" would drown it. The live notification of WT-04 is separate and will be sent for both.

## Files

| Path                                                | Change                                          |
| --------------------------------------------------- | ----------------------------------------------- |
| `src/lib/schemas/tasks.ts` (+ `.test.ts`)           | modify: `moveTaskRequestSchema`, contract       |
| `src/lib/openapi/contracts.ts`                      | modify: one contract                            |
| `src/server/services/tasks.ts` (+ integration test) | modify: `moveTask`; column lock in `createTask` |
| `src/app/api/v1/tasks/[taskId]/move/route.ts`       | create                                          |
| route integration test next to it                   | create                                          |
| `docs/api/openapi.json`                             | regenerate                                      |
| `docs/README.md`, WI-031, WS-031, WT-03             | modify: statuses                                |

No migration, no new dependency, no new problem code.

## Data model changes

None.

## API contract

Section 1. Additive: one operation, the schema `MoveTaskRequest`, and `409` documented
with `TaskVersionConflict`.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                             | Covers criterion |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| 1   | unit        | schema: `columnId` and `version` required; both anchors together refused; anchors are UUIDs; unknown fields refused; contract access                                                             | validation       |
| 2   | integration | to the end of another column; right after a task; right before the first task; the list order follows each move                                                                                  | place            |
| 3   | integration | within a column: up, down, to the end; its own place keeps the position and bumps version; no `moved` event within a column                                                                      | reorder, history |
| 4   | integration | between columns: one `moved` event with old and new `columnId` and the actor                                                                                                                     | history          |
| 5   | integration | errors: anchor in another column, anchor deleted (inserted directly), anchor is the task, column of another project → `400`; unknown task `404`; stale version `version_conflict` with `current` | errors           |
| 6   | integration | archived project: `project_archived`; Viewer: `403`                                                                                                                                              | permissions      |
| 7   | integration | concurrency: ten moves to the end of one column and ten creations in it at once: all succeed, positions distinct, every task present                                                             | concurrency      |
| 8   | integration | concurrency: two moves right after the same task at once both succeed with distinct positions                                                                                                    | concurrency      |
| 9   | integration | route: `200` with the task; `400`, `404`, `409` bodies; `401` without a session                                                                                                                  | endpoint         |

## Risks and open questions

1. **One anchor instead of both** (section 1). Proposed because it cannot place a task on
   another task's key, whatever the client last saw.
2. **Reordering within a column is not in the history** (section 4). The alternative is a
   `moved` event for every reorder.
3. **Moves into one column wait for each other** (section 3). With short transactions this
   is milliseconds; the alternative, retrying on a duplicate key, makes failures possible.

## Deviations from the approved spec

None.

## Implementation record

- Red: the schema, contract and OpenAPI tests failed on the missing `moveTaskRequestSchema`
  and contract; the integration tests on the missing `moveTask` and route (committed before
  any code).
- Green: 661 Vitest tests (up from 651) and 28 Playwright tests pass, with no unhandled
  errors. Typecheck, lint and format pass; `pnpm db:generate` leaves no diff (no
  migration); `pnpm openapi:generate` adds the operation and `MoveTaskRequest`.
- The two concurrency tests (ten moves and ten creations into one column; two moves right
  after the same task) and the task tests passed three runs in a row.
- "Already in that gap" is decided in JavaScript with `<` on the keys (code-unit order,
  amendment A2); neighbour reads in SQL compare under `collate "C"`.
- Locally the database was PostgreSQL 16 (no Docker in the sandbox); CI runs the
  PostgreSQL 18 of `compose.yaml`.
