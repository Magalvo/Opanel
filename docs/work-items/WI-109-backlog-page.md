# WI-109 — The Backlog page

- Status: In progress
- Work-track: [WT-07](../work-tracks/WT-07-backlog-priority-due-dates-labels.md) (item D)
- Depends on: [WI-101](WI-101-backlog-api.md) (done: the backlog in the data model and API)
- Work-spec: [WS-109](../work-specs/WS-109-backlog-page.md)

## Outcome

Each project has a Backlog page next to its board. People see the tasks that are not on
the board in the team's order. Members rank them by drag and drop and by keyboard, add
tasks straight into the backlog, and send a task to the board with one button. A task's
detail can move it to the backlog and back. Open backlogs follow other people's changes
live, as boards do.

## Acceptance criteria

- [ ] The project's navigation reads "Board", "Backlog", "Epics" (and "Settings" for
      those who manage projects). "Backlog" links to `/projects/KEY/backlog` and is
      current there. A task opened from the backlog keeps "Backlog" current.
- [ ] The page lists the backlog's tasks in backlog order, every page loaded. Each row
      shows what a board card shows (key, title, type, severity, assignee, team, labels)
      and links to the task, which opens as a dialog over the backlog. An empty backlog
      says so.
- [ ] Someone with `tasks:write` on a project that is not archived reorders the backlog
      by drag and drop and by keyboard (a handle per row, arrow keys, announcements). The
      new order is saved by one move with the neighbour as anchor, and it survives a
      reload. A failed move reloads the backlog and says why.
- [ ] "Add task" opens the task dialog of the board, which creates the task at the end of
      the backlog (`columnId: null`).
- [ ] Each row has "Move to board", which moves the task to the end of the project's first
      column and says so. The focus stays on the list.
- [ ] The task detail's column select offers "Backlog" beside the columns. Choosing it
      moves the task to the end of the backlog; choosing a column moves a backlog task to
      the board.
- [ ] A Viewer, and anyone on an archived project, sees the backlog read-only: no handles,
      no "Add task", no "Move to board".
- [ ] Live: another person's creation in the backlog, reorder, move into or out of the
      backlog, edit, deletion and label change appear on an open backlog without a
      reload. Events wait while a row is dragged or a move is saved. A reconnect reloads.
- [ ] The Backlog page passes the accessibility check in light and dark mode.
- [ ] An end-to-end test: a Member adds a task to the backlog, reorders it by drag and by
      keyboard, moves it to the board and back through the task detail. The order
      survives a reload, and a second open backlog and board follow live.

## Notes

WT-07 item D: decision 13, questions 1 and 2. No API change: the page uses WI-101's
`GET /projects/{projectId}/backlog`, `POST /projects/{projectId}/tasks` and
`POST /tasks/{taskId}/move`. WT-10 later adds sprint sections above the unscheduled tasks
on the same page.
