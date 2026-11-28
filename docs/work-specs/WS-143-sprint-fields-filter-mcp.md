# WS-143 — The task's sprint in the UI, the sprint filter, the MCP tool

- Status: Approved (approved by the owner on 2026-11-28, questions 1 to 3 as recommended)
- Work-item: [WI-143](../work-items/WI-143-sprint-fields-filter-mcp.md)
- Canonical docs: [0003](../canonical/0003-task-management.md) sections 3, 6 and 8;
  [0005](../canonical/0005-mcp-server.md) section 4 (amended here by WT-10 proposal P4);
  [WT-10](../work-tracks/WT-10-sprints-and-story-points.md) decisions 9, 13, 15 and 16,
  questions 8 and 9; [WS-141](WS-141-tasks-in-sprints.md) and
  [WS-142](WS-142-sprint-start-complete.md) (the rules and codes the UI explains)

## Approach

### 1. Starting point, checked against `main` (`36e6b00`)

- Every task answers `sprint: { id, name, state } | null`; `PATCH /tasks/{taskId}` takes
  `sprintId`; the move takes `sprintId` with `columnId: null`; every task list takes the
  `sprintId` filter (`<id>`, `none`, `active`) (WI-141). Sprints answer `progress` (WI-142).
  `GET /projects/{projectId}/sprints` pages them by start date with a `state` filter
  (WI-140).
- The task page: `details-section.tsx` shows and edits the fields (the epic select, with a
  note for sub-tasks, is the model); `task-detail.tsx` loads what the editors offer
  (`listOpenEpics` in `src/components/task/api.ts`, every page) and maps problem codes to
  sentences (`has_subtasks`, …); the column select moves the task (`onMove`).
- The timeline (`activity-text.tsx`) names `epicId` and `parentId` changes with sentences;
  the activity already answers a `sprintId` value as `{ id, name }` (WS-141 section 10),
  which the timeline does not read yet.
- The filter bar (`task-filter-bar.tsx`, `task-filter.ts`): `FILTER_KEYS`, one
  `FilterMenu` per filter, project-bound menus (labels, epics) "unavailable" across
  projects; used by the board, the backlog and the list view.
- The list view (`task-list-table.tsx`): `COLUMNS`, ending with "Points" and "Updated".
- The MCP server: `mcp/src/tools/epics.ts` (`opanel_list_epics`) is the model;
  `mcp/src/tools.ts` registers the tools; `mcp/src/guide.test.ts` keeps `docs/mcp.md` and
  `mcp/README.md`'s tool table in step with them; `mcp/e2e/mcp.spec.ts` lists the tools.
- Doc 0005 section 4 does not list `opanel_list_sprints` (WT-10 proposal P4).

### 2. The task page's "Sprint"

- **Read:** in a project with `sprintsEnabled`, a "Sprint" row after "Epic": the sprint's
  name and, in muted text, its state ("active", "planned", "completed"), or "No sprint".
  Not shown in a project without sprints.
- **Edit:** a select of "No sprint", the active sprint and the planned ones, by start date,
  loaded by a new `listOpenSprints(projectKey)` (`state=active&state=planned`, every page),
  only for a caller with `tasks:write`. Choosing sends `PATCH` with `sprintId`; the answer
  may have a new column or none, and the page shows it (the "Column" row and the column
  select follow the answer, as after a move).
- **Read-only:** a sub-task's select is disabled with the note "A sub-task's sprint is its
  parent's." (`aria-describedby`, as the epic's); a task of a completed sprint shows the
  sprint as text, with "Moving this task takes it out of the sprint's record."

### 3. The sentences

`task-detail.tsx` maps the codes, from the sprint field or the column select:

| Code                     | Sentence                                                                     |
| ------------------------ | ---------------------------------------------------------------------------- |
| `no_active_sprint`       | "No sprint is active. Start one from the backlog to put tasks on the board." |
| `subtask_follows_parent` | "A sub-task stays where its parent is. Move the parent instead."             |
| `sprint_completed`       | "This task belongs to a completed sprint's record."                          |
| `sprints_disabled`       | "This project does not use sprints."                                         |

### 4. The timeline

`activity-text.tsx` gains `sprintId` beside `epicId`: "put it in the sprint …", "took it
out of the sprint …", "changed the sprint from … to …", "a deleted sprint" for a gone
one. A start's or completion's `moved` entry already reads as a move.

### 5. The filter

- `FILTER_KEYS` gains `sprintId`; `task-filter.ts` parses and writes it, and its chip reads
  "Sprint: Active sprint", "Sprint: No sprint" or "Sprint: <name>".
- `task-filter-bar.tsx` gains a "Sprint" menu, after "Epic": "Active sprint" (`active`),
  "No sprint" (`none`) and, with one project, every sprint of it (all states, by start
  date, each with its state), loaded on open as epics are. Across projects only the first
  two are offered, with "Choose one project to filter by a named sprint".
- The menu shows on the backlog and the list view. It is left off the board, which in a
  project with sprints lists only the active sprint (question 1), and off any page of a
  project without sprints.

### 6. The list view

`COLUMNS` gains "Sprint" after "Status", not sortable: the sprint's name, empty for none
(question 2).

### 7. `opanel_list_sprints`

`mcp/src/tools/sprints.ts`, modelled on `opanel_list_epics`:

- input: `projectId` (id or key), `state` (one or many of `planned`, `active`,
  `completed`), `limit`, `cursor`; output `SprintPage`; `READ_ONLY`; needs `tasks:read`;
- the description says a sprint id goes in a task's `sprintId` and filters
  `opanel_search_tasks`, that `sprintId=active` names the active sprint, and that starting
  and completing sprints is a Manager's, not an agent's;
- the summary: `3 sprints: "Sprint 4" (active, 12/30 points), …`.

It is registered in `mcp/src/tools.ts`, listed in `mcp/README.md`'s table and
`docs/mcp.md`, and added to `mcp/e2e/mcp.spec.ts`'s tool list. Doc 0005 section 4 gains the
row of WT-10 proposal P4 in this item, since this item adds the tool (as WS-140 question 3
did with doc 0002).

## Files

| Path                                                                   | Change                    |
| ---------------------------------------------------------------------- | ------------------------- |
| `src/components/task/details-section.tsx`, `task-detail.tsx`, `api.ts` | modify: sections 2 and 3  |
| `src/components/task/task-detail.test.tsx`                             | modify: tests 1 to 4      |
| `src/components/task/activity-text.tsx`, `activity-text.test.tsx`      | modify: test 5            |
| `src/components/filters/task-filter.ts`, `task-filter-bar.tsx`, tests  | modify: tests 6 and 7     |
| `src/components/backlog/backlog.tsx`, `src/components/board/board.tsx` | modify: which menus show  |
| `src/components/task-list/task-list-table.tsx` and its test            | modify: test 8            |
| `mcp/src/tools/sprints.ts`, `mcp/src/tools.ts`                         | create, modify: section 7 |
| `mcp/src/planning-search-tools.test.ts`                                | modify: test 9            |
| `mcp/README.md`, `docs/mcp.md`, `mcp/e2e/mcp.spec.ts`                  | modify: the tool          |
| `docs/canonical/0005-mcp-server.md`                                    | modify: proposal P4       |
| `tests/e2e/sprint-fields.spec.ts`                                      | create: test 10           |

## Data model changes

None.

## API contract

None: the UI and the MCP server use the endpoints of WI-140 to WI-142.

## Test plan (written first, in this order)

| #   | Level | Test                                                                                                                                  | Covers criterion |
| --- | ----- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit  | the task page shows "Sprint" with name and state, "No sprint", and nothing in a project without sprints                               | 1                |
| 2   | unit  | a Member picks a planned sprint and the active one; the `PATCH` carries `sprintId`; the answer's column is shown                      | 1                |
| 3   | unit  | a sub-task's select is disabled with its note; a completed sprint's task shows its sprint as text; a Viewer sees no select            | 2, 8             |
| 4   | unit  | each of the four codes, from the sprint select and from the column select, shows its sentence                                         | 3                |
| 5   | unit  | the timeline reads a sprint set, cleared, changed, and a deleted sprint                                                               | 4                |
| 6   | unit  | `sprintId` parses from and writes to the URL; each chip's words                                                                       | 5                |
| 7   | unit  | the "Sprint" menu: its options with one project and across projects; shown on the backlog and the list view, not the board            | 5                |
| 8   | unit  | the list view's "Sprint" column                                                                                                       | 6                |
| 9   | unit  | `opanel_list_sprints`: the request it sends, its summary, its `state` filter, an error answered as a tool error                       | 7                |
| 10  | e2e   | a Member moves a task into the active sprint from its page, reads it in the timeline, and finds it with the backlog's "Sprint" filter | 1, 4, 5          |

`mcp/src/guide.test.ts` and `mcp/e2e/mcp.spec.ts` cover criterion 8's tool listings with
their existing checks.

## Risks and open questions

Questions for the owner, each with a recommendation:

1. **The sprint filter on the board.** In a project with sprints the board lists only the
   active sprint, so the menu would offer one useful choice. **Recommend: leave it off the
   board (section 5)**; the alternative is showing it everywhere, for one bar on all three
   pages.
2. **A "Sprint" column in the list view.** WT-10 decision 15 names the filter only.
   **Recommend: add the column (section 6)**, so a list filtered across sprints says which
   is which; the alternative is the filter alone.
3. **Applying P4 here.** **Recommend: in this item**, which adds the tool, as WS-140 did
   with P3; P1 and P2 stay with item G.

Risks:

- **A sprint change can move the task** (WS-141 section 3), so the page must take the
  column from the answer, not keep its own: test 2 checks it.
- **Sprints are loaded with every page of them** for the select and the menu; a project's
  planned and active sprints are few, and completed ones are loaded only when the menu
  opens.
