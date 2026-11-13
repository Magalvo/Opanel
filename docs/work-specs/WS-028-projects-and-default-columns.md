# WS-028 — Projects with default columns

- Status: Approved (approved by the owner on 2026-11-13, questions 1 to 4 as proposed)
- Work-item: [WI-028](../work-items/WI-028-projects-and-default-columns.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) sections 2, 3, 5;
  [0004](../canonical/0004-api-conventions.md) sections 3, 5, 6;
  [WT-03](../work-tracks/WT-03-board-core.md) decisions 2, 3, 4, 7, 10, 16, amendment A2

## Approach

### 1. Data model

```
projects  id uuid pk, key text not null unique, name text not null,
          description text not null default '',
          next_task_number int not null default 1,          -- decision 3, used from WI-030
          archived_at timestamptz,                          -- decision 4
          version int not null default 1,                   -- decision 7
          created_by uuid → accounts (set null), created_at, updated_at
          check projects_key_format: key ~ '^[A-Z][A-Z0-9]{1,9}$'
          check projects_version_positive: version >= 1

columns   id uuid pk, project_id uuid not null → projects (restrict),
          name text not null,
          category text not null  check in ('todo', 'in_progress', 'done'),
          position text collate "C" not null,               -- amendment A2
          version int not null default 1,
          created_at, updated_at
          unique index columns_project_position_idx on (project_id, position)
```

- **Collation.** Drizzle ORM 0.45 has no collation option on `text`, so `position` is a
  small custom column type whose SQL type is `text collate "C"`; `pnpm db:generate` then
  writes the collation into the migration. A test reads `information_schema.columns` to
  confirm the column's collation is `C`.
- **Unique position per project.** Two writers inserting between the same neighbours at
  the same moment could compute the same key; the unique index turns that into an error
  instead of two columns with an undefined order. WI-029 decides how a column write
  reacts to it.
- **Projects are never deleted** (decision 4), so `restrict` on `columns.project_id` only
  guards against a mistake.
- `next_task_number` is created now, unused until WI-030, so WI-030 adds no column to a
  table that already holds data.

Migration `0007_projects_and_columns`.

### 2. Keys, names and descriptions

- **Key**: `^[A-Z][A-Z0-9]{1,9}$`, checked by Zod and by the database. Not normalised: a
  lowercase key is a `400`; the UI upper-cases as the person types. Immutable: `PATCH` has
  no `key` field, so sending one is an unknown-field `400` (doc 0004 section 3).
- **Name**: trimmed, 1 to 100 characters (the `accountNameSchema` rule, as for teams). Not
  unique: two projects may share a name, never a key.
- **Description**: Markdown text (decision 14 renders it, in WI-036), 0 to 10 000
  characters, not trimmed.

### 3. Id or key in the path

Doc 0004 lets task endpoints take an id or a key; projects do the same, so a page at
`/projects/OPA` can call the API with the key. Every project path parameter, here and in
later items (`/projects/{projectId}/columns`, `/projects/{projectId}/tasks`), is
`projectId: z.union([z.uuid(), projectKeySchema])`, described as "The project's id or its
key". The service resolves it with one query (`where id = $1` for a UUID, `where key = $1`
otherwise). A value that is neither is a `400`; an unknown one a `404`.

### 4. Endpoints

| Operation                                     | Access            | Success | Specific errors                                                     |
| --------------------------------------------- | ----------------- | ------- | ------------------------------------------------------------------- |
| `GET /api/v1/projects`                        | `projects:read`   | `200`   | `400` query                                                         |
| `POST /api/v1/projects`                       | `projects:manage` | `201`   | `400`, `409 project_key_taken`, `415`                               |
| `GET /api/v1/projects/{projectId}`            | `projects:read`   | `200`   | `400`, `404`                                                        |
| `PATCH /api/v1/projects/{projectId}`          | `projects:manage` | `200`   | `400`, `404`, `409 version_conflict`, `409 project_archived`, `415` |
| `POST /api/v1/projects/{projectId}/archive`   | `projects:manage` | `200`   | `400`, `404`                                                        |
| `POST /api/v1/projects/{projectId}/unarchive` | `projects:manage` | `200`   | `400`, `404`                                                        |

Schemas in `src/lib/schemas/projects.ts`:

```ts
project        = { id, key, name, description, archivedAt: datetime | null,
                   version: int, createdAt, updatedAt }                     // "Project"
projectQuery   = paginationQuery & { archived?: "true" | "false" }          // default "false"
createProject  = { key, name, description? }                                // strict
updateProject  = { name?, description?, version }                           // strict, at least one of name/description
```

- **List**: ordered by name ignoring case under `"C"`, then id, with the name cursor of
  WS-026. `archived=false` (default) lists active projects, `archived=true` only archived
  ones, so the UI shows them in a separate "Archived" section.
- **Create**: inserts the project and its three columns (`positionsBetween(null, null, 3)`
  gives `a0`, `a1`, `a2`) in one transaction. A taken key, caught by
  `insert ... on conflict do nothing` on the key, is `409 project_key_taken`.
- **Update**: the update pattern of WS-027: `update projects set ..., version = version + 1
where id = $id and version = $expected and archived_at is null returning ...`. No row:
  read the project; gone is `404`, archived is `409 project_archived`, otherwise
  `409 version_conflict` with the project as `current`. A `PATCH` whose values equal the
  current ones still bumps `version` but writes no audit entry.
- **Archive / unarchive**: set or clear `archived_at` and bump `version`. They take no body
  and no `version`: each is idempotent (archiving an archived project returns it
  unchanged, with no audit entry), and the state it sets does not depend on what the
  caller last saw. See question 3.

New problem codes: `project_key_taken` and `project_archived`, both `409`.

### 5. Writes inside an archived project

Decision 4 makes everything in an archived project read-only. This item's only such write
is `PATCH`. For WI-029 onwards, `src/server/services/projects.ts` exports
`lockWritableProject(tx, projectRef)`: it resolves the project, takes `for share` on its
row (so an archive cannot commit in between), and throws `404` or `409 project_archived`.
Every later write inside a project calls it first in its transaction. Archiving takes
`for update`, so it waits for writes in flight.

### 6. Audit

| Action               | `data`                                              |
| -------------------- | --------------------------------------------------- |
| `project.created`    | `{ key, name }` (the default columns are implied)   |
| `project.updated`    | `{ changed: ["name", "description"] }` (names only) |
| `project.archived`   | `{ key }`                                           |
| `project.unarchived` | `{ key }`                                           |

Entity `project`, entity id the project id. Descriptions are not copied into the audit
log: they can be long and are not security information.

## Files

| Path                                                              | Change                                 |
| ----------------------------------------------------------------- | -------------------------------------- |
| `src/server/db/schema/projects.ts`, `columns.ts`, `index.ts`      | create, create, modify                 |
| `src/server/db/schema/collated-text.ts`                           | create: `text collate "C"` column type |
| `src/server/db/migrations/0007_projects_and_columns.sql` (+ meta) | create (`pnpm db:generate`)            |
| `src/lib/schemas/projects.ts` (+ `.test.ts`)                      | create: schemas and contracts          |
| `src/lib/schemas/problem.ts`, `audit.ts` (+ their tests)          | modify: two codes, four actions        |
| `src/lib/openapi/contracts.ts`                                    | modify: six contracts                  |
| `src/server/http/errors.ts`                                       | modify: two constructors               |
| `src/server/services/projects.ts` (+ `.integration.test.ts`)      | create                                 |
| `src/server/db/schema/columns.integration.test.ts`                | create: collation and order (A2)       |
| `src/app/api/v1/projects/route.ts`                                | create                                 |
| `src/app/api/v1/projects/[projectId]/route.ts`                    | create                                 |
| `src/app/api/v1/projects/[projectId]/archive/route.ts`            | create                                 |
| `src/app/api/v1/projects/[projectId]/unarchive/route.ts`          | create                                 |
| route integration tests next to the routes                        | create                                 |
| `docs/api/openapi.json`                                           | regenerate                             |
| `docs/README.md`, WI-028, WS-028, WT-03                           | modify: statuses                       |

No new dependency.

## Data model changes

Section 1, migration `0007_projects_and_columns`.

## API contract

Section 4. All additive. The OpenAPI document gains six operations, the schemas `Project`,
`ProjectPage` and `ProjectVersionConflict`, and the two problem codes.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                             | Covers criterion       |
| --- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 1   | unit        | key schema: accepts `OP`, `OPA1`, `A123456789`; refuses `O`, `opa`, `1OP`, `OP-1`, 11 characters                                                                 | keys                   |
| 2   | unit        | create and update schemas: name trimmed 1..100, description up to 10 000, unknown fields (including `key` in update) refused, update needs `version` and a field | validation             |
| 3   | unit        | path parameter accepts a UUID or a key, refuses anything else; contracts declare the access of section 4                                                         | id or key, access      |
| 4   | integration | columns table: `position` has collation `C`; keys `aZ` and `aa` (from `position.ts`) come back from `order by position` as `aZ`, `aa`                            | A2                     |
| 5   | integration | `createProject`: project, three columns in order with their categories, audit `project.created`; a failing audit write leaves no project and no column           | default columns        |
| 6   | integration | `createProject` with a taken key is `project_key_taken`; two concurrent creations of one key give one of each                                                    | unique keys            |
| 7   | integration | `getProject` by id and by key; unknown is `404`                                                                                                                  | id or key              |
| 8   | integration | `updateProject`: bumps `version`, audit lists changed fields; stale `version` is `version_conflict` with `current`; same values bump without audit               | version                |
| 9   | integration | archive: `archivedAt` set, `version` bumped, audit; again is a no-op; `PATCH` then is `project_archived`; unarchive restores writes                              | archived               |
| 10  | integration | `listProjects`: active by default, only archived with `archived=true`, ordered by name ignoring case, pages join up                                              | list                   |
| 11  | integration | `lockWritableProject`: `404` unknown, `409 project_archived` archived, returns the project otherwise                                                             | archived (later items) |
| 12  | integration | routes: success status and body of each operation; `version_conflict` body validates against `ProjectVersionConflict`                                            | endpoints              |
| 13  | integration | routes: Viewer and Member `403` on the four writes, `200` on the reads; no session `401` everywhere                                                              | permissions            |
| 14  | unit        | OpenAPI document: `PATCH /projects/{projectId}` documents `409` with `ProjectVersionConflict`                                                                    | contract               |

## Risks and open questions

1. **`archived=true` lists only archived projects**, rather than all projects. Proposed so
   the default list and the archive are two separate, simple views.
2. **Lowercase keys are refused**, not upper-cased by the server. Proposed so a key is
   always exactly what was sent; the UI makes typing them easy.
3. **Archive and unarchive take no `version`.** Proposed because they are idempotent and
   their outcome does not depend on the state the caller saw. The alternative is to treat
   them like any other change and require `version`.
4. **Positions are unique per project** (section 1). If the owner prefers, the index can be
   dropped and ties broken by id, accepting that two concurrent inserts may sit in an
   arbitrary order.
