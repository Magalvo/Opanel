# WI-130 — The list view of tasks, with sortable headers

- Status: Approved (approved by the owner on 2026-11-25, with WS-130)
- Work-track: [WT-08](../work-tracks/WT-08-search-filters-list-timeline.md) (item E)
- Depends on: [WI-118](WI-118-task-list-across-projects.md) (item B, done),
  [WI-120](WI-120-task-filter-bar.md) (item D, done)
- Work-spec: [WS-130](../work-specs/WS-130-task-list-view.md)

## Outcome

Anyone signed in opens "Tasks" in the sidebar and sees one list of the tasks of every
project they may read, board and backlog, as a table they can search, filter and sort by
its headers, and share as a link. Each project's navigation has "List", which opens the
same page for that project only. A row opens its task.

## Acceptance criteria

- [ ] The sidebar has "Tasks", which opens `/tasks`; each project's navigation has
      "List", which opens `/tasks?projectId=KEY`.
- [ ] `/tasks` shows a table with the columns key, title, type, status (the column's name,
      or "Backlog"), priority, assignee, due date (overdue said in text, as on cards) and
      updated, read from `GET /api/v1/tasks`, 50 rows at a time, with "Load more"; no row
      shows twice.
- [ ] The page has the filter bar of WI-120, plus a "Project" menu of the projects that
      are not archived; the label and epic menus work when exactly one project is chosen.
- [ ] Clicking a sortable header (key, title, priority, due date, updated) sorts by it,
      and clicking it again reverses it; the header says its order to assistive
      technology (`aria-sort`).
- [ ] The filter and the order are in the URL with the API's parameter names, so a link
      opens the same view; a parameter the page cannot read is ignored, and the page says
      so.
- [ ] The list is not live: it reads again when the filter or the order changes, and on
      "Refresh".
- [ ] A row's key links to its task page; going back returns to the list with its filter
      and order.
- [ ] An empty list says so, with "Clear filters" when a filter is set; a failed read says
      so, with "Try again".
- [ ] The accessibility checks pass for the list, filtered and sorted, in light and dark
      mode; every control has an accessible name and is reachable by keyboard.
- [ ] The full quality gate passes.

## Notes

- No API change: the page uses `GET /api/v1/tasks` of WI-118.
- Out of scope (WT-08): live updates, bulk edits, exports, choosing columns.
