# WI-119 — The timeline on the task page

- Status: Done (approved by the owner on 2026-11-24, with WS-119; done on 2026-11-24)
- Work-track: [WT-08](../work-tracks/WT-08-search-filters-list-timeline.md) (item F)
- Depends on: [WI-117](WI-117-task-activity.md) (item C, done)
- Work-spec: [WS-119](../work-specs/WS-119-task-timeline.md)

## Outcome

The task page shows the task's whole story: its comments and every change to it, in time
order, each line saying who did what in plain words, with an agent's "Agent" badge. A
"Comments only" switch hides the changes. The comment form stays below the list, and the
timeline follows changes and comments made elsewhere without a reload.

## Acceptance criteria

- [x] The task page's "Comments" section becomes "Activity": comments and changes from
      `GET /tasks/{taskId}/activity`, oldest first, with "Load more", and the comment form
      below them for those who may comment.
- [x] Each change reads as a sentence naming its actor through `AccountName` (so an agent
      carries its badge, and "Opanel" when no account acted), for every event type and
      field WI-117 answers: creation, each field, labels added and removed, moves to and
      from the backlog, deletion, restore, and a repeated bug report.
- [x] Names that no longer exist read as "a deleted team" and "a deleted column"; a
      description change reads "changed the description", with "Show changes" showing the
      old and the new text.
- [x] Each line shows a relative time, with the exact time on hover and in a `<time>`
      element.
- [x] "Comments only" hides the changes and shows them again; it is a switch with an
      accessible name.
- [x] A change, a move or a comment made elsewhere appears without a reload once every page
      is shown, as comments do today; after a reconnect, what is shown is read again.
- [x] The accessibility checks of the task page pass in light and dark mode.
- [x] The full quality gate passes.

## Notes

- `GET /tasks/{taskId}/comments` stays, for agents and the MCP server (WT-08 question 7);
  the page no longer calls it.
