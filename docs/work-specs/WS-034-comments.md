# WS-034 — Comments

- Status: Approved (approved by the owner on 2026-11-15, questions 1 and 2 as proposed)
- Work-item: [WI-034](../work-items/WI-034-comments.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) sections 3 and 9;
  [0001](../canonical/0001-ai-qa-agents-and-triage.md) sections 3, 6 and 7 (`comments`,
  `comments:write`, system comments); [0002](../canonical/0002-realtime-sync.md) section 3
  (`comment.created`, added in WT-04); [0004](../canonical/0004-api-conventions.md) sections
  3, 5 and 6; [WT-03](../work-tracks/WT-03-board-core.md) decisions 4, 13, 14, 16, 19 and
  question 2

## Approach

### 1. Data model

```
comments  id uuid pk,
          task_id uuid not null → tasks (restrict),
          kind text not null default 'user'  check in ('user', 'system'),
          author_account_id uuid → accounts (restrict),
          check comments_author_kind: kind <> 'user' or author_account_id is not null,
          body text not null,
          created_at timestamptz not null default now()
          index comments_task_idx on (task_id, created_at, id)
```

- `kind` and a nullable author come from decision 19. A `user` comment always has an
  author (the check); a `system` comment, which WT-06 adds, may have none. This track
  writes `user` only. The column follows doc 0001 section 7.
- **Append-only**, like `task_events` (WS-030): a trigger refuses `UPDATE` and `DELETE`,
  because editing and deleting are not planned (question 2 of WT-03). Tasks are only
  soft-deleted, so `restrict` on `task_id` never fires in practice; on the author it keeps
  the account that wrote a comment, as `task_events` does. An invited account that never
  chose a password, the only kind that can be deleted (WS-024), cannot have commented.
- No `version` and no `updated_at`: a comment never changes.

Migrations: `0011_comments` (generated) and `0012_comments_append_only` (custom,
`pnpm drizzle-kit generate --custom`), as WS-030 did for `task_events`.

### 2. Fields and rules

- **Body**: Markdown (decision 14), kept as written. Refused with `400` on `body` when it
  is empty or only whitespace, or longer than 10 000 characters (question 1).
- **Kind**: `user` for every comment created through this endpoint; the request has no
  `kind` field (a strict body refuses it with `400`).
- **Author**: the acting account. Shown as `{ id, name }`, the shape of `reporter` on a
  task, not `Person`, because WT-05 agents will comment too and `Person` is a human.

### 3. Creating a comment

One transaction, in the order every task write already uses:

1. `requirePermission(actor, "comments:write")`.
2. Find the task by id or key, not deleted, else `404`.
3. `lockWritableProject(tx, projectId)` (shared): an archived project is
   `409 project_archived`.
4. Read the task again with `for share of t`, else `404`. This waits for a delete of the
   same task that is in flight (deleting takes `for update`), so a comment is never added
   to a task deleted in the same instant.
5. Insert the comment; record the history event `commented` with the actor and
   `newValue: { commentId }` (decision 13: the event points at the comment, it does not
   copy it).
6. The single place where WT-04 adds the `comment.created` notification.

The task's `version` and `updated_at` do not change (question 2). No audit entry: comment
changes are recorded in the task history (decision 16, hard rule 8).

### 4. Listing comments

Oldest first, by `created_at`, then `id`, with the creation-time cursor of
`src/server/http/pagination.ts` (`encodeCursor`, microsecond precision), the same as the
accounts list. Default page 50, at most 100 (doc 0004 section 5). A deleted task is `404`,
like reading it. Comments of every kind are listed; `author` is `null` only for a system
comment.

### 5. Endpoints

| Operation                              | Access           | Success | Specific errors                             |
| -------------------------------------- | ---------------- | ------- | ------------------------------------------- |
| `GET /api/v1/tasks/{taskId}/comments`  | `tasks:read`     | `200`   | `400`, `404`                                |
| `POST /api/v1/tasks/{taskId}/comments` | `comments:write` | `201`   | `400`, `404`, `409 project_archived`, `415` |

`{taskId}` is the task's id or key (`taskRefSchema`), as on every task endpoint. Both
declare their access through `route()` (decision 1); the guard-rail test covers them.

```ts
commentKind    = "user" | "system"                                      // "CommentKind"
commentAuthor  = { id: uuid, name: string }                              // "CommentAuthor"
comment        = { id, taskId, kind, author: commentAuthor | null,
                   body, createdAt }                                     // "Comment"
commentPage    = page of comment                                         // "CommentPage"
createComment  = { body }                                                // "CreateCommentRequest"
```

### 6. Out of scope

Editing and deleting comments (WT-03 question 2); showing comments on the task page and
one timeline with history (WI-038, WT-08); the live event (WT-04); system comments and
agents commenting (WT-06, WT-05); mentions and notifications (no notifications in v1).

## Files

| Path                                                                                   | Change                                                                         |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `src/server/db/schema/comments.ts`, `index.ts`                                         | create, modify                                                                 |
| `src/server/db/migrations/0011_comments.sql`, `0012_comments_append_only.sql` (+ meta) | create                                                                         |
| `src/lib/schemas/comments.ts` (+ `.test.ts`)                                           | create: schemas and contracts                                                  |
| `src/lib/openapi/contracts.ts`                                                         | modify: two contracts                                                          |
| `src/server/services/comments.ts` (+ `.integration.test.ts`)                           | create                                                                         |
| `src/server/services/tasks.ts`                                                         | modify: export the task finder the comments service needs, no behaviour change |
| `src/app/api/v1/tasks/[taskId]/comments/route.ts` (+ `.integration.test.ts`)           | create                                                                         |
| `docs/api/openapi.json`                                                                | regenerate                                                                     |
| `docs/README.md`, WI-034, WS-034, WT-03                                                | modify: statuses                                                               |

No new dependency, no new problem code, no new permission (`comments:write` exists).

## Data model changes

Section 1: migrations `0011_comments` and `0012_comments_append_only`.

## API contract

Section 5. All additive: two operations and the schemas `CommentKind`, `CommentAuthor`,
`Comment`, `CommentPage` and `CreateCommentRequest`.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                        | Covers criterion |
| --- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit        | schemas: body kept as written, blank and whitespace-only refused, 10 000 accepted and 10 001 refused; unknown fields (`kind`) refused; kind enum            | body             |
| 2   | unit        | contracts: list `tasks:read`, create `comments:write`; `201` with `Comment`; documented `404`, `409`, `415`                                                 | access           |
| 3   | integration | database: a `user` comment without an author is refused by the check; `UPDATE` and `DELETE` on `comments` are refused by the trigger                        | no edit/delete   |
| 4   | integration | `createComment` by key and by id: stored as written with kind `user` and the actor as author; one `commented` event with `{ commentId }` and the actor      | create, history  |
| 5   | integration | the task's `version` and `updated_at` are unchanged after a comment                                                                                         | create           |
| 6   | integration | Viewer `403`; deleted and unknown task `404`; archived project `409 project_archived`; nothing written in each case                                         | errors           |
| 7   | integration | a failing history write rolls the comment back                                                                                                              | history          |
| 8   | integration | a comment and a delete of the same task at the same time: either the comment lands before the delete, or it is `404`; never a comment after `deleted_at`    | locks            |
| 9   | integration | `listComments`: oldest first, pages of 2 join up with no gap or repeat, comments created in the same transaction keep a stable order, a bad cursor is `400` | list             |
| 10  | integration | routes: `201` and `200` bodies; Viewer `403` on create and `200` on list; `401` without a session; `415` and `400` bodies; foreign Origin `403`             | endpoints        |
| 11  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm db:generate` and `pnpm openapi:generate` leave no diff                                       | gate             |

The database is not mocked. Test 7 makes the history write fail with a trigger, as the
audit tests do.

## Risks and open questions

1. **Body limit: 10 000 characters.** Proposed as a comment is shorter than a description
   (50 000). Bug reports rendered into comments by WT-06 can be checked against it then.
   **Owner: 10 000, or the 50 000 of descriptions?**
2. **A comment does not change the task's `version` or `updated_at`.** Proposed so that
   someone editing a task is not answered `409 version_conflict` because another person
   commented. WT-04 sends `comment.created` on its own, so clients still learn of it. The
   cost: sorting tasks by "last activity" (WT-08) must look at comments too.
   **Owner: acceptable?**
3. **Comments on an archived project can still be read**, like everything in it; only
   writing is refused (decision 4).
