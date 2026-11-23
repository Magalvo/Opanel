# WI-110 — Priority and due date in the UI

- Status: Done (2026-11-23)
- Work-track: [WT-07](../work-tracks/WT-07-backlog-priority-due-dates-labels.md) (item E)
- Depends on: [WI-102](WI-102-priority-due-date.md) (done: priority and due date in the
  data model and API)
- Work-spec: [WS-110](../work-specs/WS-110-priority-due-date-ui.md)

## Outcome

People see a task's priority and due date where they look at work: on the board's cards,
on the Backlog page's rows and in the task detail. A task whose due date has passed, and
that is not in a `done` column, says "Overdue" in words. Members set, change and clear
both in the task detail, with the rest of the task's fields.

## Acceptance criteria

- [x] A card, and a backlog row, shows the task's priority as an icon with an accessible
      name ("Priority: High"), one icon per level, and nothing for `none`.
- [x] A card, and a backlog row, shows the due date as text ("Due Dec 1, 2026"), and
      nothing when the task has none.
- [x] A task is overdue when its due date is before today in the viewer's browser and it
      is not in a `done` column; a backlog task is never in one. An overdue card says
      "Overdue" in its text, not by colour alone. A task due today is not overdue. Moving
      a task into or out of a `done` column, live or by drag, updates the mark.
- [x] Today is the viewer's local date and changes at local midnight with the page open.
- [x] The task detail's read view lists "Priority" and "Due date", the latter with
      "Overdue" when it applies.
- [x] Someone with `tasks:write` sets the priority (None, Low, Medium, High, Urgent) and
      the due date in the task detail's form and saves them with the other fields in one
      `PATCH` that carries only what changed. "Clear" empties the due date and the save
      sends `dueDate: null`.
- [x] The board, the Backlog page and the task detail, with tasks of every priority and an
      overdue one, pass the accessibility check in light and dark mode.
- [x] An end-to-end test: a Member sets and clears priority and due date in the task
      detail; each change is one history entry; a past due date on a task outside a
      `done` column shows as overdue, and the same date in a `done` column does not.

## Notes

WT-07 item E: decisions 6, 7 and 14. No API change: the web app uses WI-102's fields on
`Task` and `TaskSummary` and `PATCH /tasks/{taskId}`. Rows on the Backlog page use the
board's `CardBody` (WS-109), so they get both fields with the card.
