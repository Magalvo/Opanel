# WS-074 — Agents where humans see them: the "Agent" badge

- Status: Done (approved by the owner on 2026-11-19, questions 1 to 4 as proposed)
- Work-item: [WI-074](../work-items/WI-074-agent-badge.md)
- Canonical docs: [WT-05](../work-tracks/WT-05-agent-accounts-and-tokens.md) (decision
  10); [0003](../canonical/0003-task-management.md) (section 9: history names human or
  agent); [0004](../canonical/0004-api-conventions.md) (additive response fields);
  [0001](../canonical/0001-ai-qa-agents-and-triage.md) section 3 (agents are accounts);
  [WS-026](WS-026-teams-and-people.md) (`isPerson`), [WS-038](WS-038-task-detail.md)
  (the task detail); `AGENTS.md` hard rule 9

## Approach

### 1. Where things stand (checked on 2026-11-19, `main` at `adea79f`)

Every place the UI or the API names an account other than the signed-in one:

| Where                                   | Data                                                | Has `kind`? |
| --------------------------------------- | --------------------------------------------------- | ----------- |
| Task `reporter` (`Task`, `TaskSummary`) | inline `{ id, name }` in `src/lib/schemas/tasks.ts` | no          |
| Comment `author` (`Comment`)            | `CommentAuthor` `{ id, name }`, nullable            | no          |
| Task `assignee`                         | `Person`: only humans (`isPerson`)                  | not needed  |
| Team members, `GET /people`             | `Person`: only humans                               | not needed  |
| `GET /me`, sign-in response             | `AccountSummary`                                    | yes         |
| Events (`actorAccountId`)               | an id only; the UI shows no name from it            | not needed  |
| Task history (`task_events`)            | written, never read: no endpoint, no UI             | —           |

Where the UI renders those accounts:

- `src/components/task/details-section.tsx`: the "Reporter" row, twice (the read view and
  the edit form). Used by the task dialog and the task page alike.
- `src/components/task/comments-section.tsx`: each comment's author, or "Opanel" for a
  `system` comment.
- The board card (`task-card.tsx`) shows the assignee team and person, never the reporter.
  The epics page and its dialog show no account. The account menu shows only the signed-in
  account, always a human (an agent cannot sign in). None of these change.
- The activity timeline is WT-08 ("Search, filters, list view, activity timeline"). Doc
  0003 section 9 says history records "who (human or agent)"; the rows already carry
  `actor_account_id`. WT-08 will read them through the schema and the component of this
  item (section 6).

The services build those fields in raw SQL:

- `src/server/services/tasks.ts`: `TASK_SELECT` joins `accounts r on r.id =
t.reporter_account_id` and selects `r.id as reporter_id, r.name as reporter_name`;
  `toTask`/`toSummary` map them to `reporter`.
- `src/server/services/comments.ts`: `COMMENT_SELECT` left-joins `accounts a on a.id =
c.author_account_id` and selects `a.name as author_name`; `toComment` maps it.

`isPerson` (`src/server/services/people.ts`) already keeps agents out of the people
directory (tested in `people.integration.test.ts`) and team membership (tested in
`teams.integration.test.ts`). Assignment (`assertAssignablePerson` in `tasks.ts`) uses
it too, but **no test assigns an agent**: this item adds it (test 8).

No agent can write through the API yet (tokens are item B), but the services already
accept an `AgentActor` (WI-071): `createTask` and `addComment` called with one record the
agent as reporter or author. The tests use that, with `createTestAgent` and `agentActor`.

### 2. One schema: `AccountRef`

New file `src/lib/schemas/account-ref.ts`:

```ts
export const accountKindSchema = z.enum(["human", "agent"]).meta({ id: "AccountKind" });
export type AccountKind = z.infer<typeof accountKindSchema>;

/** An account named by a task or a comment: a person or an agent (WT-05 decision 10). */
export const accountRefSchema = z
  .strictObject({
    id: z.uuid(),
    name: z.string(),
    kind: accountKindSchema.meta({ description: "`agent` for an AI agent account." }),
  })
  .meta({ id: "AccountRef" });
export type AccountRef = z.infer<typeof accountRefSchema>;
```

- `tasks.ts`: `reporter: accountRefSchema`.
- `comments.ts`: `commentAuthorSchema` is removed; `author: accountRefSchema.nullable()`.
  The OpenAPI component `CommentAuthor` is replaced by `AccountRef` (open question 1).
- `auth.ts`: `accountSummarySchema.kind` uses `accountKindSchema`; same values, so `GET
/me` does not change on the wire.

`kind` is required in the response: every reporter and every author is an account, and
every account has a kind. On the wire this only adds a field, which doc 0004 counts as
non-breaking; no request schema changes.

### 3. Services

- `tasks.ts`: `TASK_SELECT` adds `r.kind as reporter_kind`; the row type gains
  `reporter_kind: AccountKind`; the mapping gives `reporter: { id, name, kind }`.
- `comments.ts`: `COMMENT_SELECT` adds `a.kind as author_kind`; the mapping gives
  `author: { id, name, kind }` when `author_account_id` is not null. A `user` comment's
  author always exists (foreign key), so `author_kind` is never null then.
- No other service changes. The `createTask` and `addComment` responses go through the
  same select, so they carry `kind` too, as do the task lists and the live refetches.

### 4. The component: `AccountName`

New file `src/components/account-name.tsx`, beside `markdown.tsx` (used by more than one
feature folder later):

```tsx
export function AccountName({ account }: Readonly<{ account: Pick<AccountRef, "name" | "kind"> }>) {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="break-words">{account.name}</span>
      {account.kind === "agent" && (
        <Badge variant="secondary">
          <Bot aria-hidden="true" />
          Agent
        </Badge>
      )}
    </span>
  );
}
```

- Built on the existing shadcn `Badge` (`src/components/ui/badge.tsx`), variant
  `secondary`, which uses the theme tokens of both modes; no new colours, no new variant.
- Accessible: the word "Agent" is visible text, so a screen reader reads "QA Bot Agent";
  the `Bot` icon (lucide-react, already a dependency) is decorative and hidden. Meaning
  never rests on colour alone. No tooltip, nothing focusable.
- A human gets their name and nothing else, exactly as rendered today.

### 5. Where it is used

- `details-section.tsx`: both "Reporter" rows render `<AccountName account={task.reporter} />`.
- `comments-section.tsx`: `comment.author === null ? "Opanel" : <AccountName
account={comment.author} />`, inside the existing bold span.
- `task-detail.tsx` keeps comparing `task.reporter.id` with the signed-in account for
  "Delete"; an agent's task is never "own" for a human, as today.
- UI test fixtures (`board/test-data.ts`, `board/moves.test.ts`, `task-detail.test.tsx`,
  and any other fixture that builds a task or a comment) gain `kind: "human"`; `tsc` lists them.

### 6. History and later items

No history endpoint or timeline is added here (WT-08 owns it). What WT-08 must reuse is
written down when this item is done, as one Follow-up line in `docs/README.md`: "The
activity timeline (WT-08) returns each event's actor as `AccountRef` and renders it with
`AccountName`." The same holds for the reporter of bug reports (WT-06), which reuses the
task's `reporter`.

### 7. Agents are not people

Nothing changes in `isPerson`. Tests added where one is missing:

- assigning a task to an agent, on create and on update, is `400` with the field
  `assigneeAccountId` (test 8);
- the people directory and team membership tests stay as they are; test 9 adds an agent
  made with `createTestAgent` to the assignee search the UI uses (`GET /people?q=`), which
  is the source of the assignee picker (`person-field.tsx`).

### 8. End-to-end seeding

The E2E process has no app environment, so `createTestAgent` (which uses `getDb()`)
cannot run there; `tests/e2e/seed.ts` already mirrors `createTestAccount` with its own
connection for the same reason. This item adds `seedAgent({ name })` there, inserting the
same rows as `createTestAgent` (an agent account, all projects, the `qa_agent` scopes),
and `seedAgentWork({ agentId, projectKey, title, comment })`, which inserts one task
reported by the agent and one `user` comment authored by it, directly in the E2E database
(open question 2).

## Files

| Path                                                                                              | Change                                       |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `src/lib/schemas/account-ref.ts` (+ test)                                                         | create: `AccountKind`, `AccountRef`          |
| `src/lib/schemas/tasks.ts`                                                                        | modify: `reporter` is `AccountRef`           |
| `src/lib/schemas/comments.ts`                                                                     | modify: `author` is `AccountRef`             |
| `src/lib/schemas/auth.ts`                                                                         | modify: `kind` uses `accountKindSchema`      |
| `src/lib/openapi/document.test.ts`                                                                | modify: `AccountRef` in the document         |
| `src/server/services/tasks.ts` (+ integration test)                                               | modify: `reporter_kind`; assignment test     |
| `src/server/services/comments.ts` (+ integration test)                                            | modify: `author_kind`                        |
| `src/server/services/people.integration.test.ts`                                                  | modify: an agent is never found by `q`       |
| `src/app/api/v1/tasks/[taskId]/route.integration.test.ts`, `…/comments/route.integration.test.ts` | modify: `kind` in the JSON                   |
| `src/components/account-name.tsx` (+ test)                                                        | create                                       |
| `src/components/task/details-section.tsx`                                                         | modify: both "Reporter" rows                 |
| `src/components/task/comments-section.tsx`                                                        | modify: the author                           |
| `src/components/task/task-detail.test.tsx`, board test data                                       | modify: `kind` in fixtures; agent cases      |
| `tests/e2e/seed.ts`                                                                               | modify: `seedAgent`, `seedAgentWork`         |
| `tests/e2e/agent-badge.spec.ts`                                                                   | create                                       |
| `docs/README.md`, WT-05, WI-074, WS-074                                                           | modify: statuses; the Follow-up of section 6 |

## Data model changes

None.

## API contract

Additive response fields only; no endpoint, status code, permission or request schema
changes.

- New components `AccountKind` (`human` | `agent`) and `AccountRef` (`id`, `name`,
  `kind`, all required).
- `Task.reporter` and `TaskSummary.reporter` (every task response, including list pages,
  create, update, move, delete and restore) become `AccountRef`: they gain `kind`.
- `Comment.author` becomes `AccountRef | null` (list and create): it gains `kind`. The
  component name `CommentAuthor` goes away; the JSON keeps its shape plus `kind`.
- `AccountSummary.kind` references `AccountKind`; same values.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                                                    | Covers criterion |
| --- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit        | `accountRefSchema` accepts `human` and `agent`, refuses a missing `kind`, another value and an extra key; `taskSummarySchema` and `commentSchema` refuse a reporter or author without `kind`                            | 1                |
| 2   | unit        | the OpenAPI document has `AccountRef` with the `kind` enum; `Task.reporter`, `TaskSummary.reporter` and `Comment.author` reference it                                                                                   | 1                |
| 3   | unit        | `AccountName`: a human shows the name only, no "Agent"; an agent shows the name and the text "Agent"; the icon is `aria-hidden`; the accessible text of the whole is "QA Bot Agent"                                     | 2                |
| 4   | unit        | task detail (RTL): an agent reporter shows "Agent" in the Details region, in the read view and the edit form; a human reporter shows none                                                                               | 3                |
| 5   | unit        | comments (RTL): an agent author shows "Agent"; a human author none; a `system` comment shows "Opanel" with no badge                                                                                                     | 3                |
| 6   | integration | tasks service: a task created by a human has `reporter.kind` `human`; a task created with the `AgentActor` of a `createTestAgent` agent (`worker_agent`) has `agent`, in `getTask`, `listTasks` and the create response | 1                |
| 7   | integration | comments service: a comment added with an agent's `AgentActor` has `author.kind` `agent` in the create response and in `listComments`; a human's has `human`                                                            | 1                |
| 8   | integration | tasks service: `createTask` and `updateTask` with `assigneeAccountId` of an agent are `400` on `assigneeAccountId`                                                                                                      | 5                |
| 9   | integration | people service: an agent whose name matches `q` is not listed                                                                                                                                                           | 5                |
| 10  | integration | route handlers: `GET /api/v1/tasks/{taskId}` and `GET /api/v1/tasks/{taskId}/comments` return `kind` in the JSON, validated by the contract's schema                                                                    | 1                |
| 11  | e2e         | a Manager opens a task reported by a seeded agent, with one agent comment and one of their own: "Agent" follows the reporter and the agent's comment only; axe finds no violation on the dialog, in light and dark mode | 3, 4             |
| 12  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`                                                                                                                                                                 | 6                |

## Risks and open questions

For the owner:

1. **One `AccountRef` component** for the reporter and the comment author, replacing the
   `CommentAuthor` component name, rather than adding `kind` to each shape separately and
   keeping the name. The JSON gains only `kind` either way; a generated client sees a
   renamed type. WT-06 and WT-08 then reuse one schema for every account they name.
   **Recommend: one `AccountRef`.**
2. **E2E seeding through a `seedAgent` in `tests/e2e/seed.ts`**, which inserts the same
   rows as `createTestAgent`, rather than calling `createTestAgent` itself, which needs the
   app's database client and environment that the E2E process does not have (the reason
   `seedAccount` exists). Integration tests use `createTestAgent` as asked.
   **Recommend: `seedAgent`.**
3. **The badge text "Agent", secondary style, with a robot icon**, no tooltip and no link
   to the agent's page (the Agents page is item F, Admins only; a link would be dead for
   everyone else). **Recommend: as proposed.**
4. **History stays in WT-08**: this item adds no history endpoint, only the schema and the
   component that WT-08 must use, recorded as a Follow-up when done (section 6).
   **Recommend: as proposed.**

Risks:

- **Overlap with item D (WI-073).** D adds `requireProjectAccess` calls to every service,
  including `tasks.ts` and `comments.ts` and their integration tests, the files whose
  selects and mappings this item changes. The edits touch different lines but the same
  files. **Merge order: D first, then G rebased on it.** Item B (WI-072) touches
  `authenticate.ts` and token files only: no overlap found.
- `TaskSummary` is in every list page and live refetch; the added column is read from an
  already joined row, so no query plan changes.
- UI fixtures without `kind` fail to typecheck once the schema changes; that is the
  intended guard, and section 5 lists them.

## Deviations from the approved spec

1. **`AccountRef.kind` is a `$ref` to the `AccountKind` component**, not an inline enum,
   because `accountKindSchema` carries its own id. Test 2 checks the reference and the
   enum of `AccountKind`. `AccountSummary.kind` references it too; same values.
2. **Tests 8 and 9 passed at Red.** They guard behaviour that `isPerson` already gave
   (section 7 asked for them because no test covered it); no code changed for them.
3. **Test 11 runs once per colour scheme** (two tests, as `accessibility.spec.ts` does),
   rather than one test checking both.
4. **`seedAgentWork` writes no `task_events` row** for the seeded task and comment: nothing
   reads history yet, and the board and the dialog do not need it.
5. **A comment's `author_kind` falls back to `human`** when the joined row lacks it, like
   `author_name` falls back to `""`; it cannot happen while the foreign key holds.

## Implementation record

- Red, unit: `account-ref.test.ts` could not import `./account-ref`; the OpenAPI test found
  no `AccountRef`; `account-name.test.tsx` could not import the component; every
  `task-detail.test.tsx` test failed, since the fixtures now carry `kind` and the strict
  response schemas refused it.
- Red, integration: the reporter and author tests failed with `{ id, name }` where
  `{ id, name, kind }` was expected (services and both route handlers), as did the existing
  author assertions given `kind`; tests 8 and 9 passed (deviation 2).
- Green: `account-ref.ts`; `reporter` and `author` as `AccountRef`, `CommentAuthor` gone;
  `r.kind` and `a.kind` in the two selects; `AccountName`; the two "Reporter" rows and the
  comment author; `kind: "human"` in four UI fixtures; `docs/api/openapi.json` regenerated;
  `seedAgent`, `seedAgentWork` and `agent-badge.spec.ts`.
- Gate on 2026-11-19, against this item's own databases (`opanel_wi074_test`,
  `opanel_wi074_e2e_test`), since parallel sessions share the Compose PostgreSQL:
  - typecheck, lint and Prettier pass;
  - Vitest 1363 of 1364: the sign-in limiter test timed out at 5 s while other sessions
    loaded the machine; that file alone then passed 11 of 11;
  - `pnpm test:e2e --retries=0` 77 of 81: four timeouts (`projects.spec.ts` "a Manager
    creates a project…", three of `task-detail.spec.ts`), none on an assertion about this
    item; those two files with `agent-badge.spec.ts` then passed 15 of 15. Both new E2E
    tests passed in the full run too;
  - Windows, Node 24, pnpm 10.28.0, Compose PostgreSQL on port 5433.
