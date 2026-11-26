# WS-131 — WT-08 end-to-end flow, agents guide and exit check

- Status: Done (approved by the owner on 2026-11-26, questions 1 to 3 as recommended; done on
  2026-11-26)
- Work-item: [WI-131](../work-items/WI-131-search-exit-check.md)
- Canonical docs: [0004](../canonical/0004-api-conventions.md) section 5 (P1);
  [0003](../canonical/0003-task-management.md) sections 4 and 8 (P2, P3);
  [WT-08](../work-tracks/WT-08-search-filters-list-timeline.md) decision 13, proposals
  P1 to P3, questions 6 and 8, exit criteria; [WS-078](WS-078-agent-flow-and-guide.md) (the
  guide and its doc check); [WS-115](WS-115-planning-exit-check.md) (how WT-07 closed)

## Approach

Items A to F built search, filters, the list across projects, the activity and their UI,
each with its own tests. Item G adds no feature. As WS-115 did for WT-07, it does five
things, in this order.

### 1. The exit check

Each WT-08 exit criterion is ticked with a link to the test that covers it. A survey of
`main` on 2026-11-26 (`542b074`) found:

| Exit criterion                                       | Covered by (found on `main`)                                                                                                                         |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search by key, words, prefix; renamed found at once  | `task-filter.integration.test.ts`, "text search (WS-116 tests 7 to 9)"                                                                               |
| Each filter, alone and combined, on all three lists  | board list: "the board list's filters, one at a time" and "together"; **backlog and list across projects: a few filters only (gap, below)**          |
| A restricted agent sees no other project; full pages | `all-tasks.integration.test.ts` "gives a restricted agent full pages…", "answers 404… and 403…"; `activity.integration.test.ts` "…403 outside reach" |
| Each sort both ways, across pages, writes meanwhile  | `all-tasks.integration.test.ts` "sort=%s gives every task once…", "does not give a task twice when it is updated between pages"                      |
| Filtered board shared by URL, live in and out        | `tests/e2e/filters.spec.ts`, first two tests; `tests/e2e/task-list.spec.ts`                                                                          |
| Timeline: order, actors, agent badge, deleted names  | `tests/e2e/timeline.spec.ts`; `activity-text.test.tsx`; `activity.integration.test.ts` "answers a deleted team and column with no name…"             |
| A Viewer reads all, writes nothing new; `tasks:read` | `tasks/[taskId]/activity/route.integration.test.ts` (a Viewer); `viewer-writes.integration.test.ts`; `src/lib/openapi/routes.test.ts`                |
| `docs/agents.md`, OpenAPI, docs 0003 and 0004        | this item (sections 3 and 4); `document.test.ts` already covers the operations                                                                       |
| Within the limits, measured with 50 000 tasks        | WS-116 and WS-118 measurements; the misses were accepted by the owner on 2026-11-24 (question 3)                                                     |
| The gate, `db:generate` and `openapi:generate`       | this item (section 5)                                                                                                                                |

The table was found by searching. During the implementation each row is checked against
every clause of its criterion; a clause without a test gets one, and the deviation is
recorded here. The final table, with exact test names, goes into WT-08 next to each ticked
criterion.

**The gap.** The criterion asks for one test per filter on each list. WS-116 wrote one per
filter for the board list; the backlog and the list across projects share its builder
(`taskFilterWhere`) but test only a few filters. `task-filter.integration.test.ts` gains
the same table of cases run on the backlog, and `all-tasks.integration.test.ts` runs it
on the list across projects with a second project holding a decoy for each case. The
behaviour exists, so these tests are expected to pass at once; each is first run with one
case's expected keys wrong, and fails.

### 2. The end-to-end flow

One new spec, `tests/e2e/search-flow.spec.ts`, with one test. It joins a person and a
restricted agent on search and history, which no existing spec does (question 2):

1. An Admin, through the API, creates projects A and B, three tasks in A ("Login fails on
   Safari", "Logout button", "Release notes") and one in B ("Login copy"), and a
   `worker_agent` restricted to A (`POST /api/v1/agents`, `projectIds: [A]`) with a token.
   A Member is seeded.
2. The agent, with its token alone: `GET /api/v1/tasks?q=log` answers A's two tasks and not
   B's; `q=A-3` answers that task only; `?type=task&sort=-key` answers A's tasks in reverse
   key order; `?projectId=B` answers `403`.
3. The agent sets `priority: "high"` on "Login fails on Safari" (`PATCH`, `200`) and adds
   a comment.
4. The Member, in the UI: opens "Tasks" in the sidebar, types "log" in the search box: the
   list shows A's two tasks and B's. Choosing Project → A leaves A's two; sorting by
   Priority, descending, puts the high one first. The URL holds `q`, `projectId` and
   `sort`.
5. The Member opens that task from its key: its timeline shows "changed the priority" by
   the agent with the agent badge, and the agent's comment.
6. The Member sets its due date in the task detail.
7. The agent reads `GET /api/v1/tasks/{key}/activity`: the last event is the due date
   change, its actor the Member as an `AccountRef` of kind `human`. The activity of B's task
   answers `403`.

### 3. The agents guide

`docs/agents.md` gains one section, **"Finding tasks"**, after "Tasks and the backlog"
(question 1). It says, in the guide's style:

- **Text search.** `q` finds tasks by key (`OPA-12`, any case) or by words of the title
  and description, the last word as a prefix. Words match as written, in any language.
- **Filters.** Each filter is a query parameter named after the field: `projectId`,
  `type`, `columnId`, `category`, `done`, `assigneeTeamId`, `assigneeAccountId`,
  `reporterAccountId`, `reporterKind`, `labelId`, `epicId`, `priority`, `severity`,
  `dueFrom`, `dueTo`. A repeated parameter means any of its values, different parameters
  must all hold; `none` matches an empty field and `me` the calling account. At most 20
  values each.
- **Where they apply.** The board list and the backlog take every filter but `projectId`;
  the backlog has no `columnId`. `GET /api/v1/tasks` lists the tasks of every project
  you may read, board and backlog, with `projectId` and `sort` (`key`, `title`,
  `priority`, `dueDate`, `created`, `updated`, each with `-` for descending; `-updated` by
  default). A project outside your reach is a `403`.
- **A task's history.** `GET /api/v1/tasks/{taskId}/activity` lists its changes and
  comments, oldest first, each change naming who made it; ids of accounts, teams, columns
  and epics come with their names, `null` when that thing was deleted.

The doc check gains four tests: the section is in `SECTIONS`; its filter parameters equal
the keys of `taskFilterShape`, `columnId` and `projectId`; its sort fields equal
`TASK_SORTS`; it names both endpoints. "names only endpoints of the API" already covers the
paths.

### 4. The canonical amendments

Approved with WT-08 on 2026-11-24 and applied word for word:

- **P1, doc 0004 section 5:** "The filter set is defined by the work-specs of WT-08"
  becomes: "A repeated parameter means any of its values; different parameters must all
  hold; `none` matches an empty nullable field and `me` the calling account; ranges are
  `<field>From` and `<field>To`, inclusive; `q` is text search. The filters themselves live
  in the contract."
- **P2, doc 0003 section 8,** a new bullet: "Search uses the `simple` configuration, so it
  treats every language alike; a key finds its task. The list view lists tasks across
  projects; the sprint filter comes with WT-10."
- **P3, doc 0003 section 4:** "the board can be filtered or grouped by epic" becomes "the
  board can be filtered by epic" (question 6 was answered as recommended; grouping is a
  follow-up on `main`).

Each doc's header gains an "Amended by" entry for WT-08, as WT-06 has on doc 0003.

### 5. Closing the track

The full gate runs on the branch, and `pnpm db:generate` and `pnpm openapi:generate` must
leave no diff. WT-08's `Status:` line becomes Done. Its "Next" in `docs/README.md` moves in
a separate index commit on `main` after the merge (`AGENTS.md` section 4), and the
follow-up on grouping by epic loses its "once item G applies P3".

## Files

| Path                                                     | Change                                          |
| -------------------------------------------------------- | ----------------------------------------------- |
| `tests/e2e/search-flow.spec.ts`                          | create: the flow of section 2                   |
| `src/server/services/task-filter.integration.test.ts`    | modify: each filter on the backlog (section 1)  |
| `src/server/services/all-tasks.integration.test.ts`      | modify: each filter across projects (section 1) |
| `docs/agents.md`                                         | modify: "Finding tasks"                         |
| `scripts/agents-guide.test.ts`                           | modify: four tests (section 3)                  |
| `docs/canonical/0004-api-conventions.md`                 | modify: P1                                      |
| `docs/canonical/0003-task-management.md`                 | modify: P2, P3                                  |
| `docs/work-tracks/WT-08-search-filters-list-timeline.md` | modify: exit criteria ticked, `Status:` Done    |
| `docs/work-items/WI-131-…`, `docs/work-specs/WS-131-…`   | modify: statuses, implementation record         |
| Tests, and code only if the exit check finds a gap       | as section 1 says                               |

## Data model changes

None.

## API contract

None. The guide describes the contract as it is.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                | Covers criterion |
| --- | ----------- | --------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit        | the guide has "Finding tasks" after "Tasks and the backlog" (fails until written)                   | 2, 3             |
| 2   | unit        | the section's filter parameters equal the API's (fails until written)                               | 3                |
| 3   | unit        | the section's sort fields equal `TASK_SORTS` (fails until written)                                  | 3                |
| 4   | unit        | the guide names `GET /api/v1/tasks` and `GET /api/v1/tasks/{taskId}/activity` (fails until written) | 3                |
| 5   | integration | each filter on the backlog, one at a time                                                           | 5                |
| 6   | integration | each filter on the list across projects, one at a time, never a decoy of the other project          | 5                |
| 7   | e2e         | `search-flow.spec.ts`, the flow of section 2                                                        | 1                |
| 8   | as found    | one test per exit-criterion clause found uncovered while checking each row (section 1)              | 5                |

Tests 5 to 7 cover behaviour items A to F built, so they are expected to pass when first
run. To see that each can fail, it is run once with a wrong expectation (a case's keys;
step 2's `403` expected as `200`), and fails. A real failure is a bug and is raised with
the owner, as hard rule 11 asks.

## Risks and open questions

Questions for the owner, each with a recommendation:

1. **One guide section or two.** Search, filters and the list across projects are one
   task for an agent ("is there a ticket for this?"); the activity is how it reads what
   happened to one. **Recommend: one section, "Finding tasks", with the activity as its
   last bullet,** after "Tasks and the backlog".
2. **A new e2e spec, or more steps in existing ones.** `filters.spec.ts`,
   `task-list.spec.ts` and `timeline.spec.ts` each test one item; none has a restricted
   agent. **Recommend: one new spec, `search-flow.spec.ts`, with the single test of
   section 2,** as WT-07 did with `planning-flow.spec.ts`.
3. **The performance criterion.** Search and the list missed the 100 ms limit in some
   cases on 50 000 tasks (WS-116, WS-118); the owner accepted the misses on 2026-11-24,
   and the follow-up on task lists no index orders tracks them. **Recommend: tick the
   criterion citing those measurements and the acceptance,** rather than measuring again
   or leaving WT-08 open on it.

Risks:

- **The exit check may find another gap.** A gap that needs more than a test, such as a
  missing check in a service, is raised with the owner before it is fixed, and may become
  its own work-item.
- **The e2e flow is slow** (UI steps and an agent). It uses its own projects, as
  `planning-flow.spec.ts` does, so it runs in parallel with the other specs; it waits for
  what it checks (WI-128).
- **The list across projects shows every project's tasks** in the shared e2e database, so
  step 4 filters by project before it checks exact rows, and checks B's task by its key.

## Implementation record

- Red (17b933d): the four guide tests failed (no "Finding tasks"); the per-filter tests on
  the backlog and across projects passed at once, as section 1 expected, and each failed
  with one case's keys made wrong.
- The flow (12d1697): `tests/e2e/search-flow.spec.ts` passed at once; with step 2's `403`
  expected as `200` it failed.
- Green (04a1d08): "Finding tasks" in `docs/agents.md`; P1 in doc 0004 section 5, P2 and
  P3 in doc 0003 sections 8 and 4, each doc's header naming WT-08.
- The exit check found three more clauses without a test, each now covered; the behaviour
  was there, so each passed at once and failed when its expectation was broken (deviation
  2):
  - (26b712c) a task is found by the new words of its description;
  - (26b712c) under every sort, a task left alone is given once while others are written
    between pages;
  - (fae9163) a Viewer reads `GET /api/v1/tasks`, and a token without `tasks:read` is a
    `403` on the list and on the activity.
- WT-08's exit criteria are ticked with these tests, and its `Status:` line says Done.
- Gate on 2026-11-26:
  - typecheck, lint and Prettier pass; `pnpm db:generate` and `pnpm openapi:generate`
    leave no diff;
  - Vitest 2516 of 2516 (233 files);
  - `pnpm test:e2e` 134 of 134;
  - Windows 11, pnpm 10.28.0, Compose PostgreSQL on port 5433.

## Deviations

1. **The guide's filter test reads the "Filters." bullet and expects every filter but `q`**,
   which has its own bullet, "Text search"; the test on the endpoints checks `q`. Three new
   guide tests, not four: test 1 is the existing "has the sections of WS-078, in order",
   whose list gained "Finding tasks".
2. **Three more gaps than section 1 found**, all tests only: the description clause of the
   first criterion, the "missed" clause of the sort criterion for sorts other than
   `-updated`, and the Viewer and `tasks:read` clauses of the access criterion.
3. **The sort criterion is ticked with WS-118 question 2's limit**: a task changed between
   pages may move past the cursor; every task left alone is given once.
