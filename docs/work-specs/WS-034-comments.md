# WS-034 — Comments

- Status: Done (approved by the owner, with the proposals of questions 1 to 5)
- Work-item: [WI-034](../work-items/WI-034-comments.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) sections 2, 3 and 9;
  [0001](../canonical/0001-ai-qa-agents-and-triage.md) sections 3 and 6;
  [0004](../canonical/0004-api-conventions.md) sections 3, 5 and 6;
  [WT-03](../work-tracks/WT-03-board-core.md) decisions 12, 13, 14, 16, 19

## Approach

### 1. Data model

```
comments  id uuid pk,
          task_id uuid not null → tasks (restrict),
          kind text not null default 'user'  check in ('user'),
          author_account_id uuid → accounts (restrict),     -- nullable (decision 19)
          body text not null  check length(body) between 1 and 10000,
          created_at timestamptz not null default now()
          check comments_user_has_author: kind <> 'user' or author_account_id is not null
          index comments_task_idx on (task_id, created_at, id)
```

Migration `0011_comments`. There is no `updated_at` and no `version`: comments are not
edited (WT-03 question 2). Like `task_events`, the table is append-only: a trigger refuses
updates and deletes, the way migration `0009` does for events.

`kind` allows only `user` in this track. WT-06 adds `system` by changing the check in its
own migration; nothing else about the table has to change. The author is nullable for that
reason, and the `comments_user_has_author` check keeps every `user` comment attributed.

### 2. Fields and rules

- **Body**: Markdown (decision 14), stored exactly as written, never trimmed or rewritten.
  A body that is empty or only whitespace is `400` on `body`; otherwise 1 to 10 000
  characters. It is rendered in the browser (WI-038), never here.
- **Author**: the acting account, set by the server. The request cannot name one.
- **Order**: oldest first, by `created_at` then `id`.
- A comment is not a change of the task: it does not change `version`, `updated_at` or any
  field, so a person editing the task is not told "someone changed it" because of a comment
  (question 2).

### 3. Endpoints

| Operation                              | Access           | Success | Specific errors                             |
| -------------------------------------- | ---------------- | ------- | ------------------------------------------- |
| `GET /api/v1/tasks/{taskId}/comments`  | `tasks:read`     | `200`   | `400`, `404`                                |
| `POST /api/v1/tasks/{taskId}/comments` | `comments:write` | `201`   | `400`, `404`, `409 project_archived`, `415` |

`{taskId}` is the id or the key, as on the other task routes. A deleted task is `404` for
both operations (decision 12); restoring it brings its comments back unchanged.

```ts
commentKind   = "user"                                          // "CommentKind"
commentAuthor = { id, name }                                    // "CommentAuthor"
comment       = { id, taskId, kind, author: commentAuthor | null, body, createdAt }  // "Comment"
commentPage   = page of comment                                 // "CommentPage"
createComment = { body }                                        // strict object
```

`author` is `null` only for comments that have no account, which this track never creates.
The name comes from the account as it is now. The list uses the creation-time cursor of
doc 0004 section 5 (`encodeCursor`), microsecond precision, so pages never repeat or skip.

### 4. Writing a comment

One transaction:

1. Find the task (not deleted), else `404`.
2. `lockWritableProject(tx, task.project_id)` (shared): an archived project is
   `409 project_archived`, as for every other write in a project.
3. Insert the comment with the actor as author.
4. `recordTaskEvent(tx, { taskId, actor, type: "commented", newValue: { commentId } })`
   (decision 13: the event only points at the comment; the type already exists in the
   table's check).

If step 4 fails, step 3 rolls back. No audit-log entry: task and comment changes are
recorded in the task history (decision 16, hard rule 8).

### 5. Out of scope

Editing and deleting comments (WT-03 question 2); a comment count on the task and on cards
(additive, added by WI-037 and WI-038 if they need it); the timeline that merges events and
comments (WT-08); mentions and notifications (not in v1); the comment form (WI-038); system
comments (WT-06).

## Files

| Path                                                                   | Change                                        |
| ---------------------------------------------------------------------- | --------------------------------------------- |
| `src/server/db/schema/comments.ts`, `index.ts`                         | create, modify                                |
| `src/server/db/migrations/0011_comments.sql` (+ meta)                  | create (`pnpm db:generate`, plus the trigger) |
| `src/lib/schemas/comments.ts` (+ `.test.ts`)                           | create: schemas and contracts                 |
| `src/lib/openapi/contracts.ts`                                         | modify: two contracts                         |
| `src/server/services/comments.ts` (+ `.integration.test.ts`)           | create                                        |
| `src/app/api/v1/tasks/[taskId]/comments/route.ts` (+ integration test) | create                                        |
| `docs/api/openapi.json`                                                | regenerate                                    |
| `docs/README.md`, WI-034, WS-034, WT-03                                | modify: statuses                              |

No new dependency, no new problem code.

## Data model changes

Section 1, migration `0011_comments`.

## API contract

Section 3. All additive: two operations and the schemas `CommentKind`, `CommentAuthor`,
`Comment`, `CommentPage`, `CreateCommentRequest`. `pnpm openapi:generate` is run.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                      | Covers criterion         |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 1   | unit        | schemas: body 1 to 10 000 characters, blank or whitespace-only refused on `body`, unknown fields refused, the body is not trimmed, page and comment shapes                | body rules               |
| 2   | unit        | contracts: read is `tasks:read`, write is `comments:write`; both documented in OpenAPI with their errors                                                                  | access                   |
| 3   | integration | database: a `user` comment with no author is refused; a body of 0 or 10 001 characters is refused; an update and a delete of a comment are refused by the trigger         | schema, append-only      |
| 4   | integration | `createComment`: returns the comment with the author as `{ id, name }`; the body is stored exactly as sent, with its newlines and surrounding spaces                      | create                   |
| 5   | integration | one `commented` event with the author as actor, the comment id as `newValue`, and no `field`; the task's `version` and `updated_at` are unchanged                         | history, no version bump |
| 6   | integration | a trigger that fails the event insert (created in the test, dropped after) leaves no comment                                                                              | atomic                   |
| 7   | integration | Viewer: `403` on create, allowed to list; Member, Manager and Admin create; `401` without a session                                                                       | permissions              |
| 8   | integration | a deleted task and an unknown id or key: `404` on both operations; after restore the earlier comments are listed again                                                    | deleted task             |
| 9   | integration | an archived project: create is `409 project_archived`, list still works                                                                                                   | archived project         |
| 10  | integration | list: oldest first; 120 comments in pages of 50 join up with no repeat and no gap, including several created in the same microsecond range; a bad cursor is `400`         | order, cursor            |
| 11  | integration | concurrency: 10 simultaneous comments on one task all succeed and are all listed once, and a concurrent `PATCH` of the task that sends the version it read still succeeds | no version conflict      |
| 12  | integration | routes: `201` with the body and `Cache-Control: no-store`; `415` for non-JSON; `400` with the field error and no echoed body on a blank comment; `404` problem body       | endpoints                |
| 13  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm db:generate` and `pnpm openapi:generate` leave no diff                                                     | gate                     |

The database is not mocked; the comments go through the real routes and services.

## Risks and open questions

For the owner:

1. **Maximum length 10 000 characters.** A task description allows 50 000; a comment is
   shorter by nature. Alternative: the same 50 000. The limit can be raised later without a
   migration problem, but lowering it cannot.
2. **A comment does not bump the task's `version`.** Proposed, so that commenting never
   makes someone's edit of the task fail with `409`. The cost: `version` no longer counts
   everything that happens to a task; the history does.
3. **Commenting in an archived project is `409 project_archived`**, like every other write
   in a project. Alternative: allow it, since a comment changes no configuration.
4. **Oldest first** (a conversation, and the timeline of doc 0003 section 9). A "newest
   first" view, if the UI wants it, can be a query option added later.
5. **`kind` allows only `user` now** and WT-06 changes the check to add `system`. Alternative:
   allow both values now and never create `system` until WT-06. Proposed is stricter, so
   no code can write a system comment by mistake before the pipeline exists.

## Deviations from the approved spec

None. One note on section 4: a comment and a concurrent delete of the same task are not
ordered by a task row lock (the comment holds the project's shared lock, as every write
does). A comment that lands just as its task is deleted exists but is hidden, and shows
again if the task is restored; nothing is lost.

## Implementation record

- Red: committed first (`4d7f7d2`); the schema, service and route tests failed on the
  missing module and table.
- Green: 730 Vitest tests (up from 705) and 28 Playwright tests pass. Typecheck, lint and
  format pass; `pnpm db:generate` leaves no diff after `0011_comments` (the trigger was
  appended to the generated file); `pnpm openapi:generate` adds the two operations and the
  comment schemas.
- `findTaskRef` was added to `tasks.ts` so the comments service can find a live task without
  repeating its query.
- One of my tests expected the manager's name to be `manager`; the test helper's default name
  is `Ada`, so the test now names the account.
- Locally the database was PostgreSQL 16 (no Docker in the sandbox); CI runs the
  PostgreSQL 18 of `compose.yaml`.
