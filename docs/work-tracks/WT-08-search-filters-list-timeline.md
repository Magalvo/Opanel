# WT-08 — Search, filters, list view, activity timeline

- Status: Done (approved by the owner on 2026-11-24: decisions 1 to 13, proposals P1 to P3
  and questions 1 to 9 as recommended; done on 2026-11-26 by WI-131)
- Canonical docs: [0003](../canonical/0003-task-management.md) (section 4: epics "filtered
  or grouped" on the board; section 8: search and filters; section 9: activity history;
  section 11: no saved filters), [0004](../canonical/0004-api-conventions.md) (section 5:
  lists, sorting, and "the filter set is defined by the work-specs of WT-08"; amended by
  this track, see proposal P1), [0002](../canonical/0002-realtime-sync.md) (section 4:
  the events a filtered board follows), [0001](../canonical/0001-ai-qa-agents-and-triage.md)
  (section 3: agent scopes and project restrictions),
  [0005](../canonical/0005-mcp-server.md) (section 4: the tool list, question 8)

## Goal

A team finds its work: anyone searches tasks by key and text, filters the board, the
backlog and a sortable list view by the fields of doc 0003 section 8, and shares the
result as a link. A task's page shows its whole history, changes and comments, on one
timeline that names who did each thing, person or agent. Agents get the same search,
filters and history through the API.

## Depends on

- **WT-03** (board core): tasks, columns and their categories, the task history written
  since WI-030, comments, the board and task detail.
- **WT-04** (live sync): `task.*` and `comment.*` events on the project stream; a filtered
  board keeps following them (decision 7).
- **WT-05** (agents): `requireProjectAccess` and project restrictions, which a list across
  projects must apply in its query (decision 5).
- **WT-06** (triage): severity, agent reporters and `reported_again` history entries.
- **WT-07** (planning): the backlog, priority, due date and labels, which are filters here;
  the history of labels already stores `{ id, name }` for the timeline.

## Starting point

Checked on 2026-11-24 against `main` (`b54878c`):

- `GET /projects/{projectId}/tasks` takes `columnId`, `deleted`, `cursor` and `limit`, and
  returns live board tasks in board order. `GET /projects/{projectId}/backlog` takes a page
  only. Neither filters anything else; the board loads every page of the first.
- There is no list of tasks across projects. The one search in the API is
  `GET /people?q=`, a name prefix with `ilike`.
- `tasks` has no full-text column and no GIN index. Its indexes cover the task number per
  project, the board and backlog positions, the assignee team, the assignee account, the
  epic and the bug fingerprint; nothing covers priority, due date, reporter or
  `updated_at`.
- `task_events` holds `created`, `field_changed`, `moved`, `deleted`, `restored`,
  `commented` and `reported_again`, with a nullable `actor_account_id`. `field_changed`
  stores raw values: ids for the assignees and the epic, the whole text for the
  description, `{ id, name }` lists for labels; `moved` stores column ids. No endpoint
  reads it: the end-to-end tests read the table (`taskHistory` in `tests/e2e/seed.ts`,
  WS-110 question 5).
- `GET /tasks/{taskId}/comments` lists comments oldest first (kinds `user` and `system`);
  every comment also writes a `commented` history entry.
- The task page shows comments in `CommentsSection` (`src/components/task/`); there is no
  history on it.
- A follow-up on `main` asks that the timeline return each actor as `AccountRef` and render
  it with `AccountName`, so agents carry their badge (WS-074 section 6).
- Columns can be deleted when empty, and teams can be deleted, so a history entry may name
  something that no longer exists.
- There is no tagged release, so v1 may still add fields and query parameters freely; new
  query parameters are not breaking either way (doc 0004 section 8).

## In scope

- Text search over key, title and description, with PostgreSQL full-text search.
- The filters of doc 0003 section 8 except sprint: project, type, column or column
  category (the backlog included), assignee team and person, reporter and "filed by an
  agent", label, epic, priority, severity, due date range.
- The same filters on the board list, the backlog and a new list of tasks across
  projects, with `sort` on that list.
- The activity of a task: history entries and comments in one ordered, paged list, with
  every account, team, column and epic named.
- The UI: a filter bar on the board and the backlog, a list view with sortable columns, the
  filter in the page URL, and the timeline on the task page.
- `docs/agents.md`, its doc check, and the canonical amendments of proposals P1 to P3.

## Out of scope

- The sprint filter (WT-10 adds `sprintId` to the same filter schema).
- Saved filters, watchers, @mentions (doc 0003 section 11).
- Searching comments or bug report bodies: doc 0003 section 8 names key, title and
  description only.
- Ordering search results by relevance (question 3).
- Grouping the board by epic, if question 6 is answered as recommended.
- Bulk edits from the list view, exports, column choice in the list view.
- Live updates of the list view (question 5).
- New MCP tools (question 8).
- Editing or deleting history (doc 0003 section 9: append-only).

## Design decisions

Choices the canonical docs leave open. Each is detailed in the work-spec of the item that
implements it.

1. **One filter schema.** `taskFilterSchema` in `src/lib/schemas/tasks.ts`, shared by every
   task list, the UI and OpenAPI. Each filter is a query parameter named after the field
   (doc 0004 section 5). A repeated parameter means any of its values; different
   parameters must all hold. At most 20 values per parameter. Unknown values are a `400`
   with the field's error, as every query is today.

   | Parameter                             | Values                                                        |
   | ------------------------------------- | ------------------------------------------------------------- |
   | `q`                                   | text, 1 to 200 characters (decision 2)                        |
   | `projectId`                           | a project's id or key; only on the list across projects       |
   | `type`                                | `task`, `bug`, `story`                                        |
   | `columnId`                            | a column of the project, or `backlog`; only on project lists  |
   | `category`                            | `todo`, `in_progress`, `done`; a backlog task has none        |
   | `assigneeTeamId`, `assigneeAccountId` | an id, `none` for unassigned, and `me` for the account        |
   | `reporterAccountId`                   | an id, or `me`                                                |
   | `reporterKind`                        | `human`, `agent` ("filed by an agent")                        |
   | `labelId`                             | a label of the task's project; any of them                    |
   | `epicId`                              | an epic of the task's project, or `none`                      |
   | `priority`                            | `none`, `low`, `medium`, `high`, `urgent`                     |
   | `severity`                            | `low` to `critical`; only bugs have one                       |
   | `dueFrom`, `dueTo`                    | calendar dates, both inclusive; a task with no due date fails |
   | `done`                                | `true` (in a `done` column) or `false` (anywhere else)        |

   `columnId` is the existing parameter of the board list, which gains repeats and
   `backlog`. "Overdue" is not a parameter: the server stores no time zone (WT-07
   decision 7), so the UI sends `dueTo` as yesterday in the viewer's browser with
   `done=false`, which counts backlog tasks as not done, as the cards already do.

2. **Text search.** A generated `tsvector` column on `tasks` over title (weight A) and
   description (weight B), with the `simple` configuration, and a GIN index (question 1).
   `q` matches when it is a task key (`OPA-12`, any case: that task only, in the projects
   the caller sees) or when every word of `q` matches a word of the task, the last word as
   a prefix, so "log fai" finds "Login fails". Built with `websearch_to_tsquery` after
   escaping, never from raw input; a `q` with no searchable word is a `400`.

3. **Filters on the project lists.** `GET /projects/{projectId}/tasks` and
   `GET /projects/{projectId}/backlog` accept every filter but `projectId`. Their order and
   cursors do not change: a filter only leaves tasks out. The deleted list
   (`deleted=true`) accepts them too.

4. **A list across projects.** `GET /api/v1/tasks` (`tasks:read`) lists live tasks of every
   project the caller may read, board and backlog, with every filter and
   `sort=key|title|priority|dueDate|created|updated` (each also with `-`), default
   `-updated` (question 3). Items are `TaskSummary` plus the project's key and name; keyset
   cursor on the sort key and the id; ties and `null` due dates last in both directions.
   Archived projects are left out unless `projectId` names one.

5. **Project restrictions in SQL.** An agent restricted to some projects sees only theirs:
   the list adds the restriction to its `where`, rather than filtering a page afterwards,
   so pages stay full and cursors stay valid. `requireProjectAccess` still guards a named
   `projectId`, which answers `404` for a project the agent may not see, as every project
   route does. The coverage test of `requireProjectAccess` includes the new services.

6. **Indexes.** The GIN index of decision 2, and btree indexes for the sorts and filters
   that a large install needs: `(project_id, updated_at, id)`, `(due_date)`,
   `(reporter_account_id)`, and `task_labels(label_id)` if it is missing. Item A measures
   the list and search with 50 000 tasks and records the plans in its work-spec; nothing
   else is added without a measurement.

7. **Filtering the board and the backlog.** Both pages keep loading every task as today
   and keep following the project stream. With a filter, the page asks the filtered list
   for the matching tasks and shows only those, in the usual order; a `task.*` or
   `label.changed` event makes it ask again, at most once a second, so a task that starts
   or stops matching appears or leaves without a reload (question 4). Dragging is allowed
   on a filtered board; a dropped card's place counts among the visible cards only, and
   the move names visible anchors, so the order stays correct.

8. **The filter lives in the URL.** Every filtered page writes the filter to its query
   string with the API's parameter names, so a link opens the same view. `me` stays `me`
   in a link: each viewer sees their own work. Clearing the filter clears the query
   string.

9. **The list view.** `/tasks`, in the app's sidebar as "Tasks", lists across projects with
   the same filter bar plus a project picker; each project's navigation gains "List",
   which opens `/tasks?projectId=KEY`. Columns: key, title, type, status (the column's
   name, or "Backlog"), priority, assignee, due date (overdue marked by text, as on cards),
   updated. Clicking a sortable header sets `sort`; the order is in the URL. "Load more"
   pages with `usePagedList`, which already shows each item once. A row opens the task.

10. **The activity of a task.** `GET /api/v1/tasks/{taskId}/activity` (`tasks:read`, with
    `requireProjectAccess`), oldest first, paged with a cursor on `(created_at, kind, id)`.
    Each item has a `kind`: a `comment` item carries the `Comment`; an `event` item
    carries `id`, `type`, `field`, `oldValue`, `newValue`, `createdAt` and
    `actor: AccountRef | null`. `commented` entries are left out, since the comment is
    in the list itself. A deleted task answers `404`, as reading it does. The comments
    endpoint stays for agents and the MCP server (question 7).

11. **Named values.** In an event, an id of an account, team, column or epic is answered as
    `{ id, name }`, read when the activity is read, with `name: null` when that thing no
    longer exists ("a deleted column"). Labels keep the `{ id, name }` the history stored.
    The description's old and new text are both answered; the timeline says only "changed
    the description", with a "Show changes" toggle that shows both texts.

12. **The timeline on the task page** replaces the comments list: one list of comments and
    changes in time order, each line with its actor through `AccountName` (agents carry
    their badge), a relative time with the exact time on hover, and the comment form below
    it as today. A "Comments only" switch hides the changes. It follows `task.updated`,
    `task.moved` and `comment.created` live, as the comments list does now.

13. **Agents read all of it.** The list across projects, the filters and the activity are
    plain `tasks:read` endpoints; agents get no other permission. `docs/agents.md` gains
    them, and its doc check covers them.

## Proposed canonical changes

Not edited until approved, then applied by item G.

- **P1 — doc 0004 section 5, filters:** replace "The filter set is defined by the
  work-specs of WT-08" with the rules of decision 1: a repeated parameter means any of its
  values; different parameters must all hold; `none` matches an empty nullable field and
  `me` the calling account; ranges are `<field>From` and `<field>To`, inclusive; `q` is
  text search. The filters themselves live in the contract.
- **P2 — doc 0003 section 8:** "Search uses the `simple` configuration, so it treats every
  language alike; a key finds its task. The list view lists tasks across projects; the
  sprint filter comes with WT-10." (decisions 2 and 4, question 1).
- **P3 — doc 0003 section 4,** only if question 6 is answered as recommended: "the board
  can be filtered by epic" instead of "filtered or grouped by epic".

## Work-items (outline)

Letters until each item starts; each gets its number on `main` when it starts, with its
work-spec.

| Item | Title                                                                                                   | Depends on |
| ---- | ------------------------------------------------------------------------------------------------------- | ---------- |
| A    | The filter schema, text search (column, index, `q`), filters on the board list and the backlog, indexes | none       |
| B    | `GET /tasks`: the list across projects, `sort`, project restrictions in SQL                             | A          |
| C    | `GET /tasks/{taskId}/activity`: history and comments, named values                                      | none       |
| D    | The filter bar on the board and the backlog, the filter in the URL, live refresh of a filtered page     | A          |
| E    | The list view: `/tasks`, "List" in each project, sortable headers                                       | B, D       |
| F    | The timeline on the task page                                                                           | C          |
| G    | End-to-end flow, `docs/agents.md`, proposals P1 to P3, exit check                                       | E, F       |

A and B touch the same files (`tasks.ts` schema and service), so B follows A. C touches
only new files and the comments schema, so it runs in parallel with A; F can then run
beside D.

## Exit criteria

Checked on 2026-11-26 by WI-131, each against the test that proves it.

- [x] A Member searches by a key, by words of a title and by a word's prefix, and finds the
      tasks; a task whose title or description changes is found by its new words at once.
      (`task-filter.integration.test.ts`, "text search": "finds a key, words, a prefix and
      words of the description", "finds a task by its new title as soon as it is renamed",
      "finds a task by the new words of its description as soon as it is edited";
      `tests/e2e/search-flow.spec.ts`; `tests/e2e/task-list.spec.ts`.)
- [x] Each filter of decision 1, alone and combined, returns exactly the matching tasks on
      the board list, the backlog and the list across projects (integration tests, one per
      filter, and one for any-of and all-of). (`task-filter.integration.test.ts`, "the board
      list's filters, one at a time", "the board list's filters together", "the backlog's
      filters, one at a time" and "the backlog's filters"; `all-tasks.integration.test.ts`,
      "each filter across projects" and "applies the filters of WS-116 across projects".)
- [x] An agent restricted to some projects never sees another project's task through the
      list or the activity, and every page of a restricted list is full.
      (`all-tasks.integration.test.ts`, "gives a restricted agent full pages of its projects
      only" and "answers 404 for an unknown project and 403 for one outside an agent's
      reach"; `activity.integration.test.ts`, "answers 404 for a deleted or unknown task,
      and 403 outside the caller's reach"; `tests/e2e/search-flow.spec.ts`.)
- [x] The list across projects sorts by each `sort` field both ways, across pages, with no
      task repeated or missed while tasks are written meanwhile.
      (`all-tasks.integration.test.ts`, "sort=%s gives every task once, in order, over pages
      of 2", "sort=%s gives every task left alone once while others are written between
      pages" and "does not give a task twice when it is updated between pages of -updated".
      A task changed between pages may move past the cursor, as WS-118 question 2 accepted.)
- [x] A Member filters the board, shares the URL, and another Member opening it sees the
      same filter; on a filtered board, a task changed elsewhere to match appears, and one
      changed to stop matching leaves, with no reload. (`tests/e2e/filters.spec.ts`, "a
      filtered board writes its filter to the URL, and the link shows the same cards" and "a
      filtered board follows changes made elsewhere, with no reload".)
- [x] The task page shows changes and comments in order, each with its actor, an agent with
      its badge, and names of deleted columns and teams shown as deleted.
      (`tests/e2e/timeline.spec.ts`; `tests/e2e/search-flow.spec.ts`;
      `activity-text.test.tsx`; `activity.integration.test.ts`, "answers a deleted team and
      column with no name, and a renamed team by its new name".)
- [x] A Viewer reads everything this track adds and writes nothing new; every new endpoint
      enforces `tasks:read`. (`tasks/route.integration.test.ts`, "answers a Viewer, and
      refuses a token without tasks:read with 403"; the activity route's `route.integration.test.ts`, the Viewer's page and "refuses a token without tasks:read
      with 403"; `src/lib/openapi/routes.test.ts`, "access is declared, and route() enforces
      it". The track adds no write.)
- [x] `docs/agents.md` and its doc check cover the new endpoints and filters; the OpenAPI
      document describes them; docs 0003 and 0004 carry the approved proposals.
      (`scripts/agents-guide.test.ts`, the three WS-131 tests; `document.test.ts`,
      "describes a task's activity…" and "describes the list of tasks across projects…";
      P1 in doc 0004 section 5, P2 and P3 in doc 0003 sections 8 and 4.)
- [x] Search and the list across projects answer within the limits item A's work-spec
      sets, measured with 50 000 tasks. (WS-116 and WS-118 "Measurements": search and the
      default order meet the 100 ms limit; the board order and four sorts that no index
      serves miss it, which the owner accepted on 2026-11-24, with the follow-up on task
      lists no index orders.)
- [x] The full quality gate passes on `main`, with `pnpm db:generate` and
      `pnpm openapi:generate` leaving no diff. (WS-131 "Implementation record".)

## Risks and open questions

Resolved by the owner on 2026-11-24, by approving each recommendation:

1. **Search language.** The `english` configuration stems words ("failing" finds "fails")
   but mangles other languages; `simple` matches words as written in any language, and
   the prefix on the last word covers most of what stemming gives while typing.
   **Recommend: `simple` (decision 2, P2).**
2. **One list across projects or a list per project.** Doc 0003 lists "project" as a
   filter, which only makes sense across projects. **Recommend: `GET /tasks` and `/tasks`
   across projects, with "List" in each project opening it filtered (decisions 4 and 9).**
3. **Relevance order for search.** Ranking by `ts_rank` cannot carry a stable keyset
   cursor while tasks change, and teams sort by fields more often than by score.
   **Recommend: no relevance order in v1; search keeps the chosen `sort`, default
   `-updated`.**
4. **How a filtered board stays live.** Asking the server again after events (decision 7)
   keeps one implementation of every filter, text search included. Matching in the browser
   would be instant but would copy every filter's rules into the UI, and could not do
   full-text search as PostgreSQL does. **Recommend: ask the server again, at most once a
   second.**
5. **A live list view.** The list across projects has no single project stream to follow.
   **Recommend: not live in v1; it reloads when its filter or sort changes, and has a
   "Refresh" button.** Doc 0003 promises live boards, not lists.
6. **Grouping the board by epic.** Doc 0003 section 4 says the board "can be filtered or
   grouped by epic". Filtering comes with this track; grouping is a second board layout
   (swimlanes) with its own drag and drop and keyboard rules. **Recommend: filter only;
   grouping recorded as a follow-up, and doc 0003 says so (P3).** The alternative is an
   eighth item, after D.
7. **One activity endpoint or two lists merged in the browser.** Merging two paged lists in
   time order needs both cursors and breaks at page edges. **Recommend: one
   `GET /tasks/{taskId}/activity` (decision 10), keeping the comments endpoint.**
8. **MCP tools.** Search is what an assistant most needs ("is there already a ticket
   for…"), and WT-11 has three tools waiting (`opanel_get_backlog`, `opanel_list_labels`,
   `opanel_list_epics`). **Recommend: none in this track; one WT-11 work-item after item B
   adds `opanel_search_tasks` (over `GET /tasks`) and
   `opanel_get_task_activity` with the three waiting tools, recorded on `main` as a
   follow-up when this track is approved.**
9. **Track order.** Nothing else is in progress. **Recommend: start items A and C once
   this track is approved, in parallel; then B and F; then D and E; G last.**

Risks:

- **Search cost on large installs.** A generated column rewrites every task once when the
  migration runs, and a GIN index slows task writes a little. Item A measures both with
  50 000 tasks and records the migration time in its work-spec, for `docs/operations.md`.
- **Filter SQL is raw `sql`** (follow-up D08). One builder function makes every filter's
  `where` for all three lists, and one integration test per filter guards it, since `tsc`
  will not catch a renamed column there.
- **A filtered board that asks again after each burst of events** costs one list request
  per second per open filtered board at most. Unfiltered boards are unchanged.
- **History written before WT-08 is read as it was stored.** Every entry since WI-030 has
  the shape decision 11 reads; item C tests each event type and field that exists today.
