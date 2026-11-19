# WS-073 — Project restrictions enforced in every service, with the coverage test

- Status: Done (approved by the owner on 2026-11-19, questions 1 to 5 as proposed)
- Work-item: [WI-073](../work-items/WI-073-project-restrictions.md)
- Canonical docs: [0001](../canonical/0001-ai-qa-agents-and-triage.md) (sections 3 and 4:
  an agent restricted to projects gets `403` elsewhere);
  [WT-05](../work-tracks/WT-05-agent-accounts-and-tokens.md) (decision 7; question 5:
  `403`, not `404`); [0002](../canonical/0002-realtime-sync.md) and
  [WS-047](WS-047-events-endpoint.md) (the events stream re-checks on each heartbeat);
  [WS-025](WS-025-route-declares-access.md) (the model for the coverage test);
  `AGENTS.md` hard rule 6

## Approach

### 1. Where things stand (checked on 2026-11-19, `main` at `adea79f`)

- `Actor` is `HumanActor | AgentActor` (WI-071). A human has `projectIds: null`; an agent
  has `projectIds: ReadonlySet<string> | null`, `null` meaning all projects. Nothing reads
  `projectIds` yet. No request can carry an agent actor until item B (`authenticate()`
  accepting tokens); `createTestAgent` and `loadAgentActor` build real ones for tests.
- Every service function checks a permission with `requirePermission`, then resolves its
  target. Projects are resolved by id or key in `projects.ts`: `findProject` (private),
  and three exported resolvers used by the other services, `lockWritableProject`,
  `findProjectRef` and `claimTaskNumber`. Columns, tasks, epics and comments are found by
  their own id (or task key) and carry their `project_id`.
- Only five service modules act inside a project: `projects`, `columns`, `tasks`, `epics`,
  `comments`. No other service reads `projects`, `columns`, `tasks`, `epics`, `comments` or
  `task_events` (searched: no such `from` clause elsewhere). Teams, people, accounts,
  sign-in, setup, profile, health and maintenance are not project-scoped.
- The only list that spans projects is `listProjects`. Tasks, epics, columns and comments
  are listed inside one project or task.
- Agents never hold `projects:manage`, `epics:manage` or a `tasks:delete_*` permission
  (decision 1, a database check since WI-071), so the project, column and epic writes and
  task delete and restore are unreachable for an agent today.
- The events route (`src/app/api/v1/projects/[projectId]/events/route.ts`) calls
  `getProject` before `openEventStream`; the stream re-authenticates on every heartbeat
  and keeps going while the actor has `tasks:read` (`event-stream.ts`, line 120).
- The WS-025 guard-rail test (`src/lib/openapi/routes.test.ts`) imports every route module
  and checks each export against reviewed constants. No test looks at service exports.

### 2. The helper, in `src/server/auth/actor.ts`

```ts
/** Whether the actor may reach the project (WT-05 decision 7). Humans always may. */
export function canAccessProject(actor: Actor, projectId: string): boolean {
  return actor.projectIds === null || actor.projectIds.has(projectId);
}

/** Throws the `forbidden` API error; its detail names neither the project nor the list. */
export function requireProjectAccess(actor: Actor, projectId: string): void {
  if (!canAccessProject(actor, projectId)) throw forbidden();
}
```

`projectId` is always the project's UUID, never its key: the helper is called once the
project is resolved, so a key and an id reach the same answer. The error is the existing
`forbidden()` with its default detail, the same `403` a missing permission gives (doc 0004
section 4); a restricted agent cannot tell which project list it has from the body.

### 3. Where the check sits

**Inside the three project resolvers**, which gain a required `actor` parameter, and
**explicitly** in the functions that resolve a project another way. A resolver is how a
service reaches a project for a write, so a new write that uses one cannot forget the
check; the coverage test (section 5) catches the rest.

Order everywhere: the permission (`403`, unchanged), then an unknown id (`404`,
unchanged: existence is not secret, question 5 of WT-05), then the restriction (`403`),
then everything else (`409 project_archived`, `409 version_conflict`, `422` field errors).
So a restricted agent learns nothing about another project's state, archived or not.

| Resolver (`projects.ts`)                          | Change                                                                                                                                                                                                                                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lockWritableProject(executor, actor, ref, mode)` | after the row is found and locked, and before the archived check: `requireProjectAccess(actor, project.id)`                                                                                                                                                                  |
| `findProjectRef(executor, actor, ref)`            | when found: `requireProjectAccess` before returning; unknown still returns `undefined` (the caller's `404`)                                                                                                                                                                  |
| `claimTaskNumber(executor, actor, ref)`           | claimed: `requireProjectAccess(actor, claimed.id)`, which throws inside the caller's transaction, so the increment is rolled back; not claimed: find, `404`, `requireProjectAccess`, then `409`. It must only ever run inside a transaction, which `createTask` already does |

The parameter comes second, after the executor, the order every service function uses
(actor before the target).

| Function                                              | How the project is resolved                | Where the check is                                                       |
| ----------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------ |
| `getProject`                                          | `findProject`                              | explicit, after the `404`                                                |
| `updateProject`                                       | `findProject` in the transaction           | explicit, after the `404`                                                |
| `archiveProject`, `unarchiveProject`                  | `setArchived` → `findProject … for update` | explicit in `setArchived`, after the `404`, before the idempotent return |
| `listColumns`                                         | `getProject`                               | in `getProject`                                                          |
| `createColumn`                                        | `lockWritableProject`                      | in the resolver                                                          |
| `updateColumn`, `moveColumn`, `deleteColumn`          | `lockForColumn` → `lockWritableProject`    | in the resolver (`lockForColumn` passes the actor)                       |
| `getTask`                                             | `findTask` (task row)                      | explicit on `row.project_id`, after the `404`                            |
| `listTasks`                                           | `findProjectRef`                           | in the resolver                                                          |
| `createTask`                                          | `claimTaskNumber`                          | in the resolver                                                          |
| `updateTask`, `moveTask`, `deleteTask`, `restoreTask` | `findTask` → `lockWritableProject`         | in the resolver                                                          |
| `listEpics`                                           | `findProjectRef`                           | in the resolver                                                          |
| `getEpic`                                             | `findEpic` (epic row)                      | explicit on `row.project_id`, after the `404`                            |
| `createEpic`, `updateEpic`                            | `lockWritableProject`                      | in the resolver                                                          |
| `listComments`                                        | `findLiveTask` (task row)                  | explicit on `task.projectId`, after the `404`                            |
| `createComment`                                       | `findLiveTask` → `lockWritableProject`     | in the resolver                                                          |

`findLiveTask` keeps its signature: it returns the task's `projectId`, and both its
callers check it (above). A deleted task stays `404` before anything else, as today.

Not changed: `createProject` (there is no project yet, and it needs `projects:manage`).
A restricted agent that could create a project would not reach it afterwards; no agent can
(decision 1), and if that ever changes, the coverage test's classification of
`createProject` is where the decision would be revisited.

### 4. The projects list filters

`listProjects` adds, when `actor.projectIds !== null`,
`and p.id = any(${[...actor.projectIds]}::uuid[])` to its `where`. An empty set gives an
empty array and so an empty page, with `nextCursor: null`. The `archived` filter, the
order and the name cursor are unchanged; the filter sits before `limit`, so pages are full
and the cursor stays correct. No other list spans projects (section 1).

### 5. The coverage test, `src/server/services/project-access.integration.test.ts`

In the spirit of WS-025: it imports the modules and checks them against reviewed
constants, and a behavioural check makes each entry prove itself.

**Classification (static).** The test globs `src/server/services/*.ts` (leaving out
`*.test.ts` and `*-testing.ts`), imports each module, and collects every export whose value
is a function, named `module.export` (`tasks.getTask`). Three reviewed constants must
together hold exactly that set, each name in one of them:

- `PROJECT_SCOPED`: name → a call that runs the function against a target project with a
  given actor (25 entries: the 22 of section 3 and the 3 resolvers).
- `PROJECT_FILTERED`: `projects.listProjects`.
- `NOT_PROJECT_SCOPED`: name → the reason, in one line. Today: the account, sign-in,
  setup, profile, health, maintenance, rate-limit and audit functions; `people.*`;
  `teams.*` (teams and people are not project-scoped, decision 7); `agents.loadAgentActor`;
  `event-hub.*` (the stream checks, section 6); `events.publishEvent`,
  `task-events.recordTaskEvent` (called inside a service that has checked);
  `tasks.findLiveTask` (its callers check); `projects.createProject` (section 3).

An export missing from all three fails with a message naming it and saying that a
work-spec decides its class, as for WS-025's reviewed lists. An entry that no longer
exists fails too, so the lists cannot rot. WT-06 to WT-10, and items B and C of this
track, add their exports to one of the lists.

**Behaviour.** A `beforeEach` builds, through the services as an Admin, two projects `A`
and `B`, each with its default columns, an extra column, a task (and a deleted one), an
epic and a comment. Each `PROJECT_SCOPED` entry then runs, with `it.each`:

1. With an actor restricted to `A`, against `B`: rejects with an `ApiError` of status
   `403` and code `forbidden`. A fingerprint of the database (row counts and the greatest
   `version` and `updated_at` of `projects`, `columns`, `tasks`, `epics`, `comments`;
   counts of `task_events` and `audit_log`; `projects.next_task_number`) is the same
   before and after. Events are `pg_notify` inside the transaction (WS-045), so a refused
   call sends none; the fingerprint covers every write that would accompany one.
2. The same with `B` archived: still `403`, never `409`.
3. With the same actor against `A`: does not reject with `forbidden` (it may succeed or
   fail for its own reasons, such as an already archived project; only the restriction is
   under test).

The actor is a literal `AgentActor` holding **every** permission of the catalogue and
`projectIds: new Set([A.id])`, not one built by `agentActor`, which refuses `*:manage`
scopes. The point is to test the restriction on every function, including those an agent
cannot reach today because of decision 1 (question 3). `claimTaskNumber` and
`lockWritableProject` run inside `db.transaction`, as their callers do.

`PROJECT_FILTERED` gets its own cases (test plan 6).

### 6. The events stream

- **Opening** another project's stream: the route calls `getProject(auth.actor, …)`
  first, which now answers `403` (covered by section 5). No change to the route.
- **Heartbeat**: `event-stream.ts` line 120 becomes
  `if (can(actor, "tasks:read") && canAccessProject(actor, projectId)) write(…) else finish()`.
  `projectId` is already the project's UUID (the route passes `project.id`). When an Admin
  removes a project from an agent's list (item C), item B's `authenticate()` builds the
  actor from the rows again on the next heartbeat, so the stream closes within 25
  seconds, as for a revoked token.
- The comment on `openEventStream` ("without `tasks:read`") gains "or without the
  project".

### 7. Nothing else changes

- No migration, no schema change, no API contract change: every non-public operation
  already declares `403` (WS-025), so the OpenAPI document is unchanged.
- `route()` is unchanged (decision 7: the check belongs to the services, which know the
  project).
- Humans: `projectIds` is `null`, `canAccessProject` is `true`, every test of WT-02 to
  WT-04 passes unchanged apart from the new `actor` argument where a test calls a
  resolver directly.

## Files

| Path                                                     | Change                                                                   |
| -------------------------------------------------------- | ------------------------------------------------------------------------ |
| `src/server/auth/actor.ts` (+ `actor.test.ts`)           | modify: `canAccessProject`, `requireProjectAccess`                       |
| `src/server/services/projects.ts`                        | modify: resolvers take the actor; explicit checks; `listProjects` filter |
| `src/server/services/columns.ts`                         | modify: pass the actor to `lockWritableProject` (`lockForColumn` too)    |
| `src/server/services/tasks.ts`                           | modify: pass the actor; `getTask` checks                                 |
| `src/server/services/epics.ts`                           | modify: pass the actor; `getEpic` checks                                 |
| `src/server/services/comments.ts`                        | modify: pass the actor; `listComments` checks                            |
| `src/server/http/event-stream.ts`                        | modify: the heartbeat condition and its comment                          |
| `src/server/services/project-access.integration.test.ts` | create: the coverage test (section 5)                                    |
| `src/server/services/projects.integration.test.ts`       | modify: the list filter, real agents (test plan 6 and 7)                 |
| `src/server/http/event-stream.integration.test.ts`       | modify: the heartbeat cases                                              |
| any test that calls a resolver directly                  | modify: the new `actor` argument only                                    |
| `docs/canonical/0001-ai-qa-agents-and-triage.md`         | modify: section 4, one sentence on the order of `404`, `403`, `409`      |
| `docs/README.md`, WT-05, WI-073, WS-073                  | modify: statuses                                                         |

## Data model changes

None.

## API contract

No change to any schema or to the OpenAPI document. Behaviour, for an agent restricted to
a list of projects (none can authenticate before item B):

- `GET /projects` lists only its projects.
- Every operation on another project, or on a column, task, epic or comment of one,
  answers `403 forbidden` where it used to succeed, after the `401`, the permission's
  `403`, request validation (`400`) and an unknown id's `404`, which are unchanged.
- `GET /projects/{projectId}/events` of another project answers `403`; an open stream
  ends at the heartbeat after the project leaves the list.

Humans and agents with all projects see no change.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                                                                                                                                             | Covers criterion |
| --- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit        | `canAccessProject`: `true` for a human, for an agent with `null`, for a listed project; `false` for an unlisted one and for an empty set                                                                                                                                                                         | 1                |
| 2   | unit        | `requireProjectAccess`: throws `ApiError` 403 `forbidden` with the default detail (not naming the project) exactly when `canAccessProject` is `false`                                                                                                                                                            | 1                |
| 3   | integration | coverage, static: the exported functions of `src/server/services/*.ts` are exactly `PROJECT_SCOPED ∪ PROJECT_FILTERED ∪ NOT_PROJECT_SCOPED`, disjoint; a stale entry fails                                                                                                                                       | 6                |
| 4   | integration | coverage, behaviour, for each of the 25 `PROJECT_SCOPED` entries: `403` on `B`, nothing written (fingerprint); `403` on archived `B`; not `forbidden` on `A`                                                                                                                                                     | 2, 3, 6          |
| 5   | integration | order: an unknown project (id and key), task, column and epic id → `404` for the restricted actor, as for anyone                                                                                                                                                                                                 | 2                |
| 6   | integration | `listProjects` for an agent restricted to `A` and `C` among `A`, `B`, `C` (archived): live list `[A]`, archived list `[C]`; with `limit: 1` the cursor walks only listed projects; restricted to none: empty page                                                                                                | 4                |
| 7   | integration | with real agents (`createTestAgent` + `loadAgentActor`), a `worker_agent` restricted to `A`: creates, moves and comments on a task in `A`; gets `403` on `getTask`, `createTask`, `createComment` in `B`, by id and by key (`B-1`); an agent with all projects reaches both; a Member and a Viewer are unchanged | 2, 3, 4          |
| 8   | integration | event stream (`openEventStream` with an injected `authenticate`): the first heartbeat's actor reaches the project → heartbeat written; the next returns the agent without it → the stream closes and gives its place back                                                                                        | 5                |
| 9   | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; existing tests unchanged apart from the resolver argument                                                                                                                                                                                               | 7                |

## Risks and open questions

For the owner:

1. **The check inside the three project resolvers** (`lockWritableProject`,
   `findProjectRef`, `claimTaskNumber`, each given a required `actor`), plus explicit calls
   in the six places that resolve a project from a row (`getProject`,
   `updateProject`, `setArchived`, `getTask`, `getEpic`, `listComments`), rather than an
   explicit call in each of the 22 functions. Every write goes through a resolver, so a
   new write cannot skip it, and the check lands before `409 project_archived` without
   reordering each function. The cost is a wider signature on three internal helpers.
   **Recommend: in the resolvers.**
2. **Order `404`, then `403`, then `409`/`422`.** An unknown id stays `404` (existence of
   an id is not secret, WT-05 question 5); the restriction comes before any state of the
   project, so a restricted agent cannot learn that another project is archived or that a
   version moved. Request validation (`400`) still comes first, in `route()`, as for every
   permission. **Recommend: as proposed.**
3. **The coverage test's actor holds every permission**, built as a literal, not through
   `agentActor`, which would refuse `*:manage`. This tests the restriction on all 25
   functions, including those decision 1 keeps out of an agent's reach today; the real
   agents of test 7 cover the reachable ones end to end. **Recommend: as proposed.**
4. **Classify every exported function of every service module** (about 60 entries), not
   only the five project modules. A new module (WT-06's bug reports) is then caught on its
   first export; the price is that items B and C, and every later item adding a service
   export, add one line to the test. **Recommend: every module.**
5. **Doc 0001 section 4 gains one sentence** on that order (an unknown id is `404`,
   another project `403`, before any other refusal). It is the one behaviour this item
   settles that agent authors will see. **Recommend: amend in this item.**

Risks:

- **Merge order with items B and G.** Item B adds service exports (tokens, and
  `authenticate()` changes outside `services/`); whichever of B and D lands second adds
  B's exports to `NOT_PROJECT_SCOPED`. Item G may touch the task and comment queries
  (reporter and author `kind`); the changes here are a few lines per function and the
  resolver signatures, so G rebases on D as planned.
- **The heartbeat re-check depends on item B** re-building the agent actor from the rows
  on every `authenticate()` call, as WT-05 decision 5 implies and `loadAgentActor` is
  built for. Test 8 injects the actor, so this item does not wait for B.
- **A future read that finds a row by id** (as `getTask` does) without a resolver must call
  the helper itself; the coverage test is what catches a forgotten one, which is why
  every project-scoped export must have a behavioural entry.

## Deviations from the approved spec

1. **The projects-list filter is `p.id in (…)`, or `and false` for an empty list**, not
   `p.id = any(${ids}::uuid[])` (section 4). Drizzle's `sql` template sends a JavaScript
   array as one parameter per element, which PostgreSQL refuses as an array literal
   (`malformed array literal`). The result is the same: one bound parameter per project id,
   and an empty page for an agent restricted to no project.
2. **Test 7 (real agents) is in `project-access.integration.test.ts`**, next to the
   coverage test, rather than in `projects.integration.test.ts`: it spans tasks, comments
   and projects, and reuses that file's two-project fixture. Test 6 (the list filter) is in
   `projects.integration.test.ts`, as planned.
3. **Test 8 uses a real API token** after the rebase onto WI-072, rather than an injected
   `authenticate`: an agent restricted to the project opens the stream with
   `bearerRequest`, and the stream closes at the heartbeat after its `agent_projects` row
   is deleted. This exercises item B's `authenticate()` re-building the agent's actor on
   each heartbeat, the dependency named under Risks. The injected-actor version no longer
   type-checked (`Authenticated` gained `via`). With the heartbeat's project check
   disabled, the test fails (it times out on a stream that stays open).

## Implementation record

- Red (commit `9140130`, `fd42578` after the rebase): 59 tests failed for the right reasons: `canAccessProject` and
  `requireProjectAccess` did not exist; every project-scoped function answered with
  success, `404` (the resolvers received the actor as their `ref`) or `409
project_archived` instead of `403`; `listProjects` returned every project; the stream
  test timed out because the stream stayed open. The classification test already passed:
  the reviewed lists matched the 73 exported service functions on `main`.
- Green: the helper in `actor.ts`; `lockWritableProject`, `findProjectRef` and
  `claimTaskNumber` take the actor; explicit checks in `getProject`, `updateProject`,
  `setArchived`, `getTask`, `getEpic`, `listComments`; the list filter; the heartbeat
  condition. The four touched test files: 117 of 117. No other caller of the resolvers
  existed (`tsc` found none), and no existing test changed apart from the resolver
  argument in `projects.integration.test.ts`.
- Doc 0001 section 4 gains the sentence on the order of refusals (question 5); its header
  names WI-073.
- Gate on 2026-11-19 (private databases `opanel_wi073_test` and `opanel_wi073_e2e_test`
  on port 5433, so as not to collide with the sessions running items B and G):
  - typecheck, lint and Prettier pass;
  - Vitest 1430 of 1434 in the full run: 4 tests each failed on `Test timed out in
5000ms` while other sessions loaded the machine (`people-page`, `sign-in-form`, the
    `audit_log` index test, and the event stream's unchanged 64 KiB case); those four
    files run alone: 41 of 41;
  - `pnpm test:e2e` 79 of 79;
  - Windows, Node 24, pnpm 10.28.0, Compose PostgreSQL on port 5433.
- Rebased on 2026-11-19 onto `main` at `82294c8` (WI-072 merged). Only the docs
  conflicted (`docs/README.md`, the WT-05 table); WI-072 added no service export, so the
  coverage test's lists were unchanged. Test 8 was rewritten (deviation 3). Gate after the
  rebase, same databases:
  - typecheck, lint and Prettier pass;
  - Vitest 1457 of 1457;
  - `pnpm test:e2e` 78 of 79: `people.spec.ts` "an Admin invites, changes a role,
    deactivates and reactivates" failed on a strict-mode violation (the invited
    account's row twice), the People page Follow-up of `docs/README.md`; this item does
    not touch people; `people.spec.ts` alone then passed 6 of 6.
