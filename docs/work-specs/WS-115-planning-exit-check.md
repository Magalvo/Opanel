# WS-115 — WT-07 end-to-end flow, agents guide and exit check

- Status: Proposed
- Work-item: [WI-115](../work-items/WI-115-planning-exit-check.md)
- Canonical docs: [0002](../canonical/0002-realtime-sync.md) section 3 (P1);
  [0003](../canonical/0003-task-management.md) sections 4 and 5 (P2, P3);
  [WT-07](../work-tracks/WT-07-backlog-priority-due-dates-labels.md) decision 15, proposals
  P1 to P3, questions 4 and 5, exit criteria; [WS-078](WS-078-agent-flow-and-guide.md) (the guide
  and its doc check)

## Approach

Items A to F built the backlog, priority, due dates and labels, each with its own tests.
Item G adds no feature. It does four things, in this order.

### 1. The exit check

Each WT-07 exit criterion is ticked with a link to the test that covers it. A survey of
`main` on 2026-11-23 (`c8a97d0`) found a test for each part:

| Exit criterion                                     | Covered by (found on `main`)                                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Backlog in the UI, reorder, to the board and back  | `tests/e2e/backlog.spec.ts`, both tests                                                                                         |
| Board list and backlog list each hold their tasks  | `src/app/api/v1/projects/[projectId]/backlog/route.integration.test.ts`, `backlog.integration.test.ts`                          |
| A repeated report counts on a bug in the backlog   | `bug-reports.integration.test.ts`, "fileBugReport and the backlog (WS-101)"                                                     |
| Priority and due date, history, overdue            | `tests/e2e/priority-due-date.spec.ts`, `task-priority.integration.test.ts`                                                      |
| Labels: create, apply, rename, delete in use       | `tests/e2e/labels.spec.ts`, `labels.integration.test.ts`, `task-labels.integration.test.ts`                                     |
| Viewer and agent `403`, archived `409`, access     | `labels/[labelId]/route.integration.test.ts`, `tasks.integration.test.ts`, `task-labels…` (agent `labelIds`), `project-access…` |
| Stale `version` on a backlog move or a label write | `move/route.integration.test.ts`, `backlog.integration.test.ts`, `labels.integration.test.ts`                                   |
| `docs/agents.md`, OpenAPI, docs 0002 and 0003      | this item (sections 2 and 3)                                                                                                    |
| The gate, `db:generate` and `openapi:generate`     | this item (section 5)                                                                                                           |

This table was found by searching, not by reading each test. During the implementation
each row is checked against the criterion's every clause. A clause without a test gets
one, failing first if the behaviour is missing, and the deviation is recorded here. The
final table, with exact test names, goes into WT-07 next to each ticked criterion.

### 2. The end-to-end flow

One new spec, `tests/e2e/planning-flow.spec.ts`, with one test. It joins a person and an
agent on the same planned work, which no existing spec does (question 2):

1. An Admin, signed in through the API, creates a project and a `worker_agent` with all
   projects through `POST /api/v1/agents`, then its token through
   `POST /api/v1/agents/{agentId}/tokens`. A Member is seeded.
2. The Member, in the UI: on the Backlog page, "Add task" creates "Plan the release" and
   "Write the notes". In the task detail of the first: priority `high`, a due date, and a
   new label "release" from the picker. "Move to board" puts it in "To do".
3. The agent, with its token alone (no cookie): `GET /api/v1/tasks/{key}` answers the
   first task with its column, `priority: "high"`, its `dueDate` and the label.
   `GET /api/v1/projects/{key}/backlog` lists only "Write the notes".
4. The agent sets `priority: "urgent"` on the first task (`PATCH`, `200`). The history
   entry names the agent (`taskHistory` of `tests/e2e/seed.ts`).
5. The agent moves the first task back to the backlog (`POST /api/v1/tasks/{key}/move`,
   `columnId: null`, `200`). The backlog then lists both tasks, the moved one last.
6. The agent sends `labelIds: []` in a `PATCH`: `403`, and the task keeps its label.
7. The Member's Backlog page, open since step 2, shows the moved task and its new priority
   without a reload (WS-109's live sync).

### 3. The agents guide

`docs/agents.md` gains one section, **"Tasks and the backlog"**, after "Lists"
(question 1). It says, in the guide's style:

- **Where a task is.** `columnId` is the task's column, or `null` when the task is in the
  backlog. `GET /api/v1/projects/{projectId}/tasks` lists the board, in board order;
  `GET /api/v1/projects/{projectId}/backlog` lists the backlog, in the team's ranking.
- **Moving.** `POST /api/v1/tasks/{taskId}/move` with `columnId: null` puts a task in the
  backlog; `afterTaskId` or `beforeTaskId` place it. Needs `tasks:write`.
- **Priority and due date.** `priority` is one of `none`, `low`, `medium`, `high`,
  `urgent`; `dueDate` is `YYYY-MM-DD` or `null`. A `worker_agent` may set both, and the
  task history names it. Bug reports never set a priority (doc 0003 section 4).
- **Labels.** `labels` lists `{ id, name, colour }`. Agents read labels
  (`GET /api/v1/projects/{projectId}/labels`) but do not apply them: a body with
  `labelIds` answers `403` (WT-07 question 5).

"Live updates" names `label.changed` among the event types. "Errors and limits" is
unchanged: agents never write labels, so `label_name_taken` does not reach them.

The doc check gains three tests: the new section is in `SECTIONS`; its priority values
equal `PRIORITIES` of `src/lib/schemas/tasks.ts`; it names the backlog endpoint. The
existing test "names only endpoints of the API" already covers the paths.

### 4. The canonical amendments

Approved with WT-07 on 2026-11-21 and applied word for word:

- **P1, doc 0002 section 3:** a row for `label.changed`: entity `label`; version the
  label's after the write, `null` when deleted; sent by creating, editing and deleting a
  label. "Amended by WT-04 decision 1" becomes "amended by WT-04 decision 1 and WT-07
  decision 12".
- **P2, doc 0003 section 5,** after the backlog bullet: "A task in the backlog has no
  column. A new task goes to the first column unless it is created in the backlog;
  agent-filed bugs follow section 13."
- **P3, doc 0003 section 4:** "Priority is set by people and by agents holding
  `tasks:write`; the triage pipeline never sets it." It replaces "and is set by people" in
  the "Severity is not priority" paragraph, which would otherwise contradict it
  (question 3).

### 5. Closing the track

The full gate runs on the branch, and `pnpm db:generate` and `pnpm openapi:generate` must
leave no diff. WT-07's `Status:` line becomes Done. Its "Next" and the work-tracks
paragraph in `docs/README.md` move in a separate index commit on `main` after the merge
(`AGENTS.md` section 4).

## Files

| Path                                                          | Change                                           |
| ------------------------------------------------------------- | ------------------------------------------------ |
| `tests/e2e/planning-flow.spec.ts`                             | create: the flow of section 2                    |
| `docs/agents.md`                                              | modify: "Tasks and the backlog", `label.changed` |
| `scripts/agents-guide.test.ts`                                | modify: three tests (section 3)                  |
| `docs/canonical/0002-realtime-sync.md`                        | modify: P1                                       |
| `docs/canonical/0003-task-management.md`                      | modify: P2, P3                                   |
| `docs/work-tracks/WT-07-backlog-priority-due-dates-labels.md` | modify: exit criteria ticked, `Status:` Done     |
| `docs/work-items/WI-115-…`, `docs/work-specs/WS-115-…`        | modify: statuses, implementation record          |
| Tests, and code only if the exit check finds a gap            | as section 1 says                                |

## Data model changes

None.

## API contract

None. The guide describes the contract as it is.

## Test plan (written first, in this order)

| #   | Level    | Test                                                                                     | Covers criterion |
| --- | -------- | ---------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit     | the guide has "Tasks and the backlog" after "Lists" (fails until the section is written) | 2, 3             |
| 2   | unit     | the section's priority values equal `PRIORITIES` (fails until written)                   | 3                |
| 3   | unit     | the guide names `GET /api/v1/projects/{projectId}/backlog` (fails until written)         | 3                |
| 4   | e2e      | `planning-flow.spec.ts`, the flow of section 2                                           | 1                |
| 5   | as found | one test per exit-criterion clause found uncovered (section 1)                           | 5                |

Test 4 covers behaviour that items A to F built, so it is expected to pass when first run.
To see that it can fail, it is run once with step 6 expecting `200`, and fails. A real
failure is a bug and is raised with the owner, as hard rule 11 asks.

## Risks and open questions

Questions for the owner, each with a recommendation:

1. **One new guide section, or a sentence in each existing one.** The backlog, priority,
   due dates and labels are all task fields, and an agent author looks for them together.
   **Recommend: one section, "Tasks and the backlog", after "Lists".**
2. **A new e2e spec, or more steps in the existing ones.** `backlog.spec.ts`,
   `priority-due-date.spec.ts` and `labels.spec.ts` each test one item through the UI;
   none has an agent. Extending `agent-flow.spec.ts` would mix WT-05's flow with WT-07's.
   **Recommend: one new spec, `planning-flow.spec.ts`, with the single test of section 2.**
3. **P3 and the sentence it contradicts.** P3 adds a sentence, but doc 0003 section 4
   already says priority "is set by people". **Recommend: P3's sentence replaces that
   clause, so the section says it once.** The alternative is adding P3 as written and
   leaving the old clause.

Risks:

- **The exit check may find a gap**, which would grow this item. A gap that needs more
  than a test, such as a missing check in a service, is raised with the owner before it is
  fixed, and may become its own work-item.
- **The e2e flow is slow** (the UI steps plus an agent). It uses its own project, as
  `live-board.spec.ts` does, so it runs in parallel with the other specs.
