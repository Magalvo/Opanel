# WS-138 — WT-09 end-to-end flow, agents guide and exit check

- Status: Done (approved by the owner on 2026-11-27, questions 1 to 4 as recommended; done on 2026-11-27)
- Work-item: [WI-138](../work-items/WI-138-links-exit-check.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) sections 3 and 7 (P1 to P3);
  [WT-09](../work-tracks/WT-09-subtasks-and-links.md) decision 13, proposals P1 to P3, exit
  criteria; [WS-078](WS-078-agent-flow-and-guide.md) (the guide and its doc check);
  [WS-131](WS-131-search-exit-check.md) (how WT-08 closed)

## Approach

Items A to E built sub-tasks, links, their UI and the MCP tools, each with its own tests.
Item F adds no feature. As WS-131 did for WT-08, it does five things, in this order.

### 1. The exit check

Each WT-09 exit criterion is ticked with a link to the test that covers it. A survey of
`main` on 2026-11-27 (`facceb6`) found:

| Exit criterion                                                     | Covered by (found on `main`)                                                                                                                       |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sub-task and back on create and edit; `400` on `parentId`; history | `subtasks.integration.test.ts` (WS-133 tests 2 and 3); `activity.integration.test.ts` (the `parentId` change); `tests/e2e/subtasks.spec.ts` test 2 |
| Parent's answer, card and page show sub-tasks; live progress       | `subtasks.integration.test.ts` (WS-133 tests 6 and 7); `task-card.test.tsx`; `tests/e2e/subtasks.spec.ts` test 1                                   |
| Epic follows the parent; own `epicId` `400`; `409 has_subtasks`    | `subtasks.integration.test.ts` (WS-133 tests 5 and 9)                                                                                              |
| Member and `worker_agent` link each type across projects; readings | `task-links.integration.test.ts` (WS-134 tests 3, 4, 9 and 10); `tests/e2e/links.spec.ts` test 1; **an agent through the API: section 2**          |
| `qa_agent` cannot link; a restricted agent neither links nor sees  | `task-links.integration.test.ts` (WS-134 tests 7 and 12); **`subtasks` for a restricted agent: below**                                             |
| A Viewer reads all and writes nothing; every endpoint's permission | `viewer-writes.integration.test.ts` (every write under `/api/v1/tasks`); `tests/e2e/links.spec.ts` test 2; `src/lib/openapi/routes.test.ts`        |
| `parentId` on the board list, the backlog and across projects      | `task-filter.integration.test.ts` and `all-tasks.integration.test.ts` (WS-133 test 12)                                                             |
| The 100-item limits answer `409`                                   | `subtasks.integration.test.ts` (WS-133 test 8); `task-links.integration.test.ts` (WS-134 test 8)                                                   |
| `docs/agents.md`, OpenAPI, doc 0003                                | this item (sections 3 and 4); `document.test.ts` (WS-090, WS-133); **the two link operations: below**                                              |
| The gate, `db:generate` and `openapi:generate`                     | this item (section 5)                                                                                                                              |

The table was found by searching. During the implementation each row is checked against
every clause of its criterion. A clause without a test gets one, and the deviation is
recorded here. The final table, with exact test names, goes into WT-09 next to each ticked
criterion. Three clauses look uncovered already:

- **An agent links through the API**, over HTTP with its token. The service tests call
  `addTaskLink` with an agent account, and the MCP end-to-end test covers one type. The
  flow of section 2 covers all four types.
- **`subtasks` for a restricted agent.** A sub-task is always in its parent's project, so
  an agent that may read the parent may read every sub-task (WT-09 decision 1). The
  clause holds by construction. `subtasks.integration.test.ts` gains one test: a
  restricted agent reads its project's parent with its sub-tasks, and gets `403` for the
  other project's parent.
- **The two link operations in the OpenAPI document.** `document.test.ts` gains one test.
  `POST` and `DELETE /api/v1/tasks/{taskId}/links` are described with `tasks:write`, and
  `DELETE` takes `type`, `direction` and `taskId` as query parameters and answers `204`.

### 2. The end-to-end flow

One new spec, `tests/e2e/links-flow.spec.ts`, with one test. It joins a person and agents
on sub-tasks and links, which no existing spec does (question 2):

1. An Admin, through the API, creates projects A and B, two tasks in A ("Checkout",
   "Pay button") and one in B ("Payments endpoint"), and three agents, each with a token:
   - a `worker_agent`;
   - a `worker_agent` restricted to A (`projectIds: [A]`);
   - a `qa_agent`.
     A Member is seeded.
2. The Member, in the UI, opens "Checkout" and adds the sub-task "Card form" with
   "Add sub-task". The section shows `0/1`.
3. The worker agent, with its token alone:
   - reads "Card form": `parent` is "Checkout";
   - adds, from "Checkout" to "Payments endpoint", one link of each type (`blocks`
     outgoing, `duplicates` incoming, `regression_of` outgoing, `relates_to`), each `200`;
   - reads "Payments endpoint": the four links, each in its reverse reading, and
     `relates_to` as `outgoing`, as on "Checkout".
4. The Member's open "Checkout" page shows the four links under their groups with no
   reload ("Blocks", "Is duplicated by", "Regression of", "Relates to"). Its timeline
   names the agent with its badge.
5. The worker agent removes the `duplicates` link (`204`). The Member's page loses it with
   no reload.
6. The `qa_agent`'s `POST` of a link answers `403`.
7. The restricted agent:
   - reads "Checkout": its `links` leave out "Payments endpoint";
   - links "Checkout" to "Payments endpoint": `403`;
   - links "Checkout" to "Pay button", in A: `200`.
8. The Member moves "Card form" to a `done` column on the board. The agent reads
   "Checkout": `subtasks` is `{ done: 1, total: 1 }`.

### 3. The agents guide

`docs/agents.md` gains one section, **"Sub-tasks and links"**, after "Finding tasks"
(question 1). It says, in the guide's style:

- **Sub-tasks.** `parentId` on create or edit, a task's id or key in the same project,
  makes a task a sub-task, and `parentId: null` makes it a normal task again. One level
  only: a sub-task has no sub-tasks. A sub-task's epic is its parent's, so `epicId` is
  refused on one. A refused parent is a `400` naming `parentId`.
- **Reading them.** `parent` is `{ id, key, title }` or `null`. `subtasks` is
  `{ done, total }`, or `null` on a task without sub-tasks. A task's full answer adds
  `subtaskList`, its sub-tasks in board order, then the backlog. `parentId` is also a
  filter (see "Finding tasks").
- **Limits.** At most 100 sub-tasks per parent (`too_many_subtasks`). A parent with
  sub-tasks cannot be deleted (`has_subtasks`), and agents do not delete tasks anyway.
- **Links.** The table of the four types with their reverse readings (doc 0003 section 7).
  `direction` is how the task in the path reads the link. `relates_to` reads the same both
  ways and is always `outgoing`. Links may cross projects and are informational: a
  blocked task can still be moved.
- **Adding and removing.** `POST /api/v1/tasks/{taskId}/links` with
  `{ type, direction, taskId }` answers the task. `DELETE /api/v1/tasks/{taskId}/links`
  with the same fields as query parameters answers `204`. Both need `tasks:write` on both
  tasks, raise both tasks' `version` and write both histories. A link that exists is a
  `409 link_exists`, one that does not is a `404`, and a task has at most 100 links
  (`too_many_links`).

The scope table's `tasks:write` row becomes "Create, edit and link tasks" (question 3).
The section's example is one `curl` that adds a `blocks` link.

The doc check gains four tests:

1. the section is in `SECTIONS`, after "Finding tasks";
2. its link types equal `TASK_LINK_TYPES`;
3. it names both link endpoints;
4. the codes it names are all in `PROBLEM_CODES` and include the four above.

"names only endpoints of the API" already covers the paths.

### 4. The canonical amendments

Approved with WT-09 on 2026-11-26 and applied word for word:

- **P1, doc 0003 section 7, sub-tasks.** After "the parent shows a progress count", add:
  "A sub-task's epic is its parent's. A parent with sub-tasks cannot be deleted until they
  are deleted or detached; a sub-task restored after its parent was deleted becomes a
  normal task."
- **P2, doc 0003 section 7, links.** The paragraph on WT-06's table becomes: "Links are
  stored in `task_links`. People and agents holding `tasks:write` on both tasks add and
  remove links of every type; the triage pipeline also adds `regression of`. `relates to`
  is stored once. Every link added or removed is in the history of both tasks."
- **P3, doc 0003 section 3.** The row "Comment; link tasks; apply labels; create new
  labels" loses "link tasks", and "Create, edit, move and delete tasks and sub-tasks"
  becomes "Create, edit, move and delete tasks and sub-tasks; link tasks".

Doc 0003's header gains an "Amended by" entry for WT-09, as it has for WT-06 and WT-08.

P1's sentence is placed as the last sentence of the third bullet, after "…and moving the
parent does not move them.", because "the parent shows a progress count" ends mid-bullet.
P2 drops the sentence on `links` leaving out deleted tasks (WS-090). That rule stays true
and is in the contract, but P2's text replaces the whole paragraph (question 4).

### 5. Closing the track

The full gate runs on the branch, and `pnpm db:generate` and `pnpm openapi:generate` must
leave no diff. WT-09's `Status:` line becomes Done. Its "Next" in `docs/README.md` moves in
a separate index commit on `main` after the merge (`AGENTS.md` section 4).

## Files

| Path                                                   | Change                                               |
| ------------------------------------------------------ | ---------------------------------------------------- |
| `tests/e2e/links-flow.spec.ts`                         | create: the flow of section 2                        |
| `src/server/services/subtasks.integration.test.ts`     | modify: a restricted agent's sub-tasks (section 1)   |
| `src/lib/openapi/document.test.ts`                     | modify: the two link operations (section 1)          |
| `docs/agents.md`                                       | modify: "Sub-tasks and links"; the `tasks:write` row |
| `scripts/agents-guide.test.ts`                         | modify: four tests (section 3)                       |
| `docs/canonical/0003-task-management.md`               | modify: P1 to P3, the header                         |
| `docs/work-tracks/WT-09-subtasks-and-links.md`         | modify: exit criteria ticked, `Status:` Done         |
| `docs/work-items/WI-138-…`, `docs/work-specs/WS-138-…` | modify: statuses, implementation record              |
| Tests, and code only if the exit check finds a gap     | as section 1 says                                    |

## Data model changes

None.

## API contract

None. The guide describes the contract as it is.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                             | Covers criterion |
| --- | ----------- | ------------------------------------------------------------------------------------------------ | ---------------- |
| 1   | unit        | the guide has "Sub-tasks and links" after "Finding tasks" (fails until written)                  | 2, 3             |
| 2   | unit        | the section's link types equal `TASK_LINK_TYPES` (fails until written)                           | 3                |
| 3   | unit        | the section names `POST` and `DELETE /api/v1/tasks/{taskId}/links` (fails until written)         | 3                |
| 4   | unit        | the section's codes are real and include the four of WI-138 (fails until written)                | 3                |
| 5   | unit        | the OpenAPI document describes both link operations                                              | 5                |
| 6   | integration | a restricted agent reads its project's parent with its sub-tasks, and gets `403` for the other's | 5                |
| 7   | e2e         | `links-flow.spec.ts`, the flow of section 2                                                      | 1                |
| 8   | as found    | one test per exit-criterion clause found uncovered while checking each row (section 1)           | 5                |

Tests 5 to 7 cover behaviour items A to E built, so they are expected to pass when first
run. To see that each can fail, it is run once with a wrong expectation (the `DELETE`
answering `200`; the other project's parent as `200`; step 6's `403` expected as `200`),
and fails. A real failure is a bug and is raised with the owner, as hard rule 11 asks.

## Risks and open questions

Questions for the owner, each with a recommendation:

1. **Where the guide's section goes.** Sub-tasks and links are fields and endpoints of a
   task, read with the task, after an agent has found it. **Recommend: one section, "Sub-tasks
   and links", after "Finding tasks"**, rather than more bullets in "Tasks and the
   backlog", which is about where a task is.
2. **A new e2e spec, or more steps in existing ones.** `subtasks.spec.ts` and
   `links.spec.ts` each test one item with a Member; none has an agent over HTTP or a
   refused agent. **Recommend: one new spec, `links-flow.spec.ts`, with the single test of
   section 2,** as WT-07 and WT-08 did.
3. **The scope table.** "Create and edit tasks" still covers linking, but an author reading
   it would not know `tasks:write` links. **Recommend: "Create, edit and link tasks"**,
   matching P3. The alternative is leaving the row as it is.
4. **P2 drops a sentence.** "A task's answer (`links`) lists its links in both directions
   and leaves out links to deleted tasks (WS-090)" is true, and P2 as approved replaces the
   whole paragraph. **Recommend: apply P2 word for word and keep that sentence after it**,
   since it states behaviour that has not changed. The alternative is P2 alone.

Risks:

- **The exit check may find another gap.** A gap that needs more than a test, such as a
  missing check in a service, is raised with the owner before it is fixed, and may become
  its own work-item.
- **The flow is slow and live** (UI steps, three agents, live updates). It uses its own
  projects, as `search-flow.spec.ts` does, so it runs in parallel with the other specs.
  It waits for what it checks (WI-128).
- **`search-flow.spec.ts` is flaky** (the follow-up on `main`). If it fails in the gate,
  it is rerun alone and the result recorded, as in WS-135 to WS-137.

## Implementation record

- Red (661d0bf): the three new guide tests and the sections test failed (no "Sub-tasks and
  links"). The OpenAPI test of the link operations and the restricted agent's sub-tasks
  test passed at once, as section 1 expected. Each failed with its expectation made wrong:
  `DELETE` answering `200`, and the other project's parent as `200`.
- The flow (2c48933): `tests/e2e/links-flow.spec.ts` passed at once. With step 6's `403`
  expected as `200`, it failed.
- Green (04e9593): "Sub-tasks and links" in `docs/agents.md`, after "Finding tasks", and
  the `tasks:write` row reads "Create, edit and link tasks". P1 and P2 are in doc 0003
  section 7, P3 in section 3, and the header names WT-09.
- The exit check found two more clauses without a test (8bc3b84), both now covered in
  `subtasks.integration.test.ts`. The behaviour was there, so each passed at once and
  failed when its expectation was broken (deviation 3):
  - the account that sets and clears a parent is in the history;
  - a Viewer reads a parent and its sub-tasks, and is refused setting a parent.
- WT-09's exit criteria are ticked with these tests (e739b9b), and its `Status:` line says
  Done.
- Gate on 2026-11-27:
  - typecheck, lint and Prettier pass; `pnpm db:generate` and `pnpm openapi:generate`
    leave no diff;
  - Vitest 2682 of 2682 (239 files);
  - `pnpm test:e2e` 144 of 145. The one failure was
    `mcp/e2e/write-tools.spec.ts`, "an agent's assistant creates, updates, moves and
    comments on a task, as the agent (WS-104)", which this item does not touch. It passed
    three times of three when rerun alone; its error was not kept, so its cause is unknown
    (deviation 4);
  - Windows 11, pnpm 10.28.0, Compose PostgreSQL on port 5433.

## Deviations

1. **The link types are in a table after the section's first sentence**, not in the
   "Links." bullet. The doc check reads table rows that start a line, as it does for the
   origin layers; a table inside a bullet is indented.
2. **The codes test splits each code span on spaces**, since the guide writes a status and
   its code in one span ("`409 link_exists`"), as its errors section does.
3. **Two more gaps than section 1 found**, both tests only: the actor clause of the first
   exit criterion (the e2e test reads the timeline sentence, not its author) and the
   Viewer clause for sub-tasks through the API.
4. **One e2e failure outside this item** in the full run, passed alone three times. It may
   be another flaky test, like `search-flow.spec.ts`; if it fails again, it earns a
   follow-up.
