# WI-135 — Sub-tasks in the UI

- Status: Proposed
- Work-track: [WT-09](../work-tracks/WT-09-subtasks-and-links.md) (item C)
- Depends on: [WI-133](WI-133-subtasks-api.md) (item A, done)
- Work-spec: [WS-135](../work-specs/WS-135-subtasks-ui.md)

## Outcome

People work with sub-tasks in the web app. A task's page lists its sub-tasks with their
status and the parent's progress, and "Add sub-task" creates one. A task can be given a
parent, or have it removed, from its page. Cards on the board and rows in the backlog show
a sub-task's parent and a parent's progress, and every one of these follows changes made
elsewhere without a reload.

## Acceptance criteria

- [ ] A task's page that is not a sub-task has a "Sub-tasks" section: each live sub-task's
      key (a link), title, status (its column, or "Backlog") and assignee, in the API's
      order, and "2 of 5 done". People who edit tasks see "Add sub-task"; the section is
      left out for a Viewer when there are none.
- [ ] "Add sub-task" opens the create dialog with the parent set, and the new sub-task
      appears in the list.
- [ ] The details show "Parent": a link to the parent on a sub-task, with "Remove parent"
      for people who edit; on a task without sub-tasks, "Set parent" finds a task of the
      project by key or words. A sub-task's epic is shown as its parent's, not editable.
- [ ] A board card and a backlog row of a sub-task show its parent's key; a parent's show
      `2/5`, with the accessible name "2 of 5 sub-tasks done".
- [ ] A parent's card, row and page update their progress when a sub-task changes
      elsewhere (the parent's `task.updated` with an unchanged version), and a parent's page
      updates a sub-task's row when that sub-task changes.
- [ ] Deleting a task with sub-tasks says to delete or detach them first; the API's
      `400`s on `parentId` and `epicId` show beside their field.
- [ ] The timeline says "made it a sub-task of OPA-1", "removed it from OPA-1" and
      "moved it from OPA-1 to OPA-4".
- [ ] The accessibility checks pass for a parent's page, a sub-task's page and a board
      with both, in light and dark mode; every new control is reachable by keyboard.
- [ ] The full quality gate passes.

## Notes

- No API change. The list view gains nothing (WT-09 decision 12).
