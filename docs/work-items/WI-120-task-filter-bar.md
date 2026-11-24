# WI-120 — The filter bar on the board and the backlog

- Status: Proposed
- Work-track: [WT-08](../work-tracks/WT-08-search-filters-list-timeline.md) (item D)
- Depends on: [WI-116](WI-116-task-filters-search.md) (item A, done)
- Work-spec: [WS-120](../work-specs/WS-120-task-filter-bar.md)

## Outcome

On a project's board and backlog, anyone narrows what they see with a search box and a
filter bar, and shares the view as a link: the filter lives in the page's URL with the
API's parameter names. A filtered page stays live: a task changed elsewhere to match
appears, and one that stops matching leaves, without a reload. People who move tasks can
still drag and move cards on a filtered page.

## Acceptance criteria

- [ ] The board and the backlog have a filter bar: a search box (`q`) and menus for type,
      priority, severity, label, epic, team, assignee (me, unassigned, or a person on the
      page), reporter (people, agents, me) and due date (overdue, due in the next 7 days).
      Active filters show as chips that remove themselves, with "Clear filters".
- [ ] The page shows only the tasks the filtered list of WI-116 returns, in the usual
      order; every column stays, and a column with none says "No matching tasks". The bar
      says how many tasks match out of how many are shown unfiltered.
- [ ] The filter is in the URL with the API's parameter names, and a link opens the same
      view; parameters the bar has no control for (a custom due range, `category`,
      `columnId`, a reporter) still apply and show as chips. A parameter the page cannot
      read is ignored, and the page says so.
- [ ] A filtered page asks again for the matching tasks after a `task.*` or
      `label.changed` event, at most once a second, so tasks appear and leave live.
- [ ] Dragging and the card menu's moves work on a filtered page, placing a card among the
      cards shown.
- [ ] Opening a task from a filtered page and closing it keeps the filter.
- [ ] The accessibility checks pass for the filtered board and backlog in light and dark
      mode; every control has an accessible name and is reachable by keyboard.
- [ ] The full quality gate passes.

## Notes

- No API change: the filters are WI-116's. The list view (item E) reuses the filter bar.
