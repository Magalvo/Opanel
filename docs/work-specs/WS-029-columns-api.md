# WS-029 — Columns API

- Status: Proposed (must be `Approved` by the owner before any code is written)
- Work-item: [WI-029](../work-items/WI-029-columns-api.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) sections 3, 5;
  [0004](../canonical/0004-api-conventions.md) sections 5, 6;
  [WT-03](../work-tracks/WT-03-board-core.md) decisions 4, 5, 7, 10, 16

## Approach

The `columns` table exists since WI-028 (with `position text collate "C"`, unique per
project, and `version`). This item adds the service and the endpoints. No migration.

### 1. Paths

A project's collection is nested under the project; a single column has its own path,
as tasks will (decision 6):

| Operation                                   | Access            | Success | Specific errors                                                                             |
| ------------------------------------------- | ----------------- | ------- | ------------------------------------------------------------------------------------------- |
| `GET /api/v1/projects/{projectId}/columns`  | `projects:read`   | `200`   | `400`, `404`                                                                                |
| `POST /api/v1/projects/{projectId}/columns` | `projects:manage` | `201`   | `400`, `404`, `409 project_archived`, `415`                                                 |
| `PATCH /api/v1/columns/{columnId}`          | `projects:manage` | `200`   | `400`, `404`, `409 version_conflict`, `409 last_done_column`, `409 project_archived`, `415` |
| `POST /api/v1/columns/{columnId}/move`      | `projects:manage` | `200`   | `400`, `404`, `409 version_conflict`, `409 project_archived`, `415`                         |
| `DELETE /api/v1/columns/{columnId}`         | `projects:manage` | `204`   | `400`, `404`, `409 last_done_column`, `409 project_archived`                                |

`projectId` is the project's id or key (WS-028 section 3). Configuring columns is
`projects:manage` (doc 0003 section 3: "configure columns").

### 2. Schemas (`src/lib/schemas/columns.ts`)

```ts
columnCategory = "todo" | "in_progress" | "done"                       // "ColumnCategory"
column         = { id, projectId, name, category, version, createdAt, updatedAt }  // "Column"
columnList     = { items: column[], nextCursor: null }                 // "ColumnList"
createColumn   = { name, category, afterColumnId?: uuid | null }       // strict
updateColumn   = { name?, category?, version }                         // strict, one of name/category
moveColumn     = { afterColumnId: uuid | null, version }               // strict
```

- **Name**: trimmed, 1 to 100 characters, not unique within a project.
- **Position is not exposed.** The list is returned in board order, and clients place a
  column by naming its neighbour, never by sending a key (decision 5). Keeping keys out of
  responses also keeps clients from sorting them with a language collation.
- **One anchor, `afterColumnId`.** A project's columns are few and always returned whole,
  so the server knows the full order: "after column X" (or `null`, "first") identifies the
  place exactly, and the next column is read inside the transaction. Tasks, which are
  paginated, will take both neighbours (decision 6).
  - Create: `afterColumnId` absent means "at the end", `null` means "first".
  - The anchor must be another column of the same project; otherwise `400` with the field
    error `afterColumnId`.
- **The list** is returned whole: `{ items, nextCursor: null }`, as doc 0004 section 5
  allows for naturally bounded collections (decision 10).

### 3. Rules

- **At least one `done` column** (doc 0003 section 5). Deleting a `done` column, or changing
  its category, when it is the project's only `done` column is `409 last_done_column`. A
  project therefore never has zero columns either.
- **Archived projects** (decision 4): every write first calls `lockWritableProject` from
  WS-028, so it is `404` for an unknown project and `409 project_archived` for an archived
  one. For the paths under `/columns/{columnId}`, the service reads the column's project id
  first, then locks the project.
- **Serialised per project.** After `lockWritableProject`, every column write locks all
  of the project's column rows (`select ... from columns where project_id = $1 order by
position for update`). Column changes are rare and a project has few columns, so this
  costs nothing and makes three things safe under concurrency: the `done` rule (two
  concurrent deletes of the last two `done` columns cannot both succeed), the neighbours a
  new position is computed from, and the uniqueness of positions.
- **Versions** (decision 7, WS-027 pattern): `PATCH` and move send `version`; the update
  is `... where id = $id and version = $expected`. No row: `404` if the column is gone,
  otherwise `409 version_conflict` with the column as `current`. A `PATCH` that changes
  nothing still bumps `version`, with no audit entry, as for projects.
- **Moving** computes `positionBetween(after?.position ?? null, next?.position ?? null)`,
  where `next` is the column following the anchor once the moved column is left out. Moving
  a column to the place it already has bumps `version`, changes no key and writes no audit
  entry. `afterColumnId` equal to the moved column itself is a `400`.
- **Deleting** takes no `version` (doc 0004 section 6 gives `DELETE` no body). A column that
  still holds tasks will be refused from WI-030 on, with `409 column_not_empty`; that item
  creates the reference and maps it, as WS-026 did for teams.

New problem code: `last_done_column` (`409`).

### 4. Audit

Entity `column`, entity id the column id.

| Action           | `data`                                         |
| ---------------- | ---------------------------------------------- |
| `column.created` | `{ projectId, name, category }`                |
| `column.updated` | `{ projectId, changed: ["name", "category"] }` |
| `column.moved`   | `{ projectId }`                                |
| `column.deleted` | `{ projectId, name, category }`                |

## Files

| Path                                                        | Change                                           |
| ----------------------------------------------------------- | ------------------------------------------------ |
| `src/lib/schemas/columns.ts` (+ `.test.ts`)                 | create: schemas and contracts                    |
| `src/lib/schemas/problem.ts`, `audit.ts` (+ tests)          | modify: one code, four actions                   |
| `src/lib/openapi/contracts.ts`                              | modify: five contracts                           |
| `src/server/http/errors.ts`                                 | modify: `lastDoneColumn()`                       |
| `src/server/services/columns.ts` (+ `.integration.test.ts`) | create                                           |
| `src/app/api/v1/projects/[projectId]/columns/route.ts`      | create                                           |
| `src/app/api/v1/columns/[columnId]/route.ts`                | create                                           |
| `src/app/api/v1/columns/[columnId]/move/route.ts`           | create                                           |
| route integration tests next to the routes                  | create                                           |
| `docs/api/openapi.json`                                     | regenerate                                       |
| `docs/README.md`, WI-029, WS-029, WT-03                     | modify: statuses; WI-030 row: `column_not_empty` |

No new dependency, no migration.

## Data model changes

None (the table is from WI-028).

## API contract

Section 1 and 2. All additive. The OpenAPI document gains five operations, the schemas
`ColumnCategory`, `Column`, `ColumnList` and `ColumnVersionConflict`, and the code
`last_done_column`.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                       | Covers criterion |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| 1   | unit        | schemas: name trimmed 1..100; category enum; `afterColumnId` UUID or null; update needs `version` and a field; unknown fields refused      | validation       |
| 2   | unit        | contracts declare the access of section 1; `PATCH` and move document `ColumnVersionConflict`                                               | permissions      |
| 3   | integration | `listColumns`: the three default columns in order, by project id and by key; `404` unknown project                                         | list             |
| 4   | integration | `createColumn`: at the end by default, first with `null`, after a given column; audit; anchor from another project is `400`                | create, order    |
| 5   | integration | `updateColumn`: rename and recategorise with audit of changed fields; stale `version` is `version_conflict` with `current`                 | update, version  |
| 6   | integration | the last `done` column cannot be recategorised or deleted (`last_done_column`); with two `done` columns one can                            | done rule        |
| 7   | integration | `moveColumn`: to first, between two, to last; the list order follows; moving to its own place writes no audit; anchor itself is `400`      | move             |
| 8   | integration | `deleteColumn`: removed with audit; unknown is `404`                                                                                       | delete           |
| 9   | integration | archived project: create, update, move and delete are `project_archived`; list still works                                                 | archived         |
| 10  | integration | concurrency: two `done` columns deleted at once leave one; ten concurrent creates at the end give ten distinct, ordered positions          | serialised       |
| 11  | integration | a failing audit write rolls back each of the four writes                                                                                   | audit            |
| 12  | integration | routes: success status and body of each operation; Viewer and Member `403` on the four writes and `200` on the list; `401` without session | endpoints        |

## Risks and open questions

1. **One anchor (`afterColumnId`) instead of both neighbours.** Proposed because columns
   are always loaded whole. Tasks still take both neighbours (decision 6).
2. **No limit on the number of columns.** A board with dozens of columns is unusual but
   harmless; a limit can be added later without breaking the contract.
3. **Column names are not unique** within a project, like project names. The UI shows them
   in order, so two "Review" columns are distinguishable by place.
