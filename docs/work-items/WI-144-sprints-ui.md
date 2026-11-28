# WI-144 — Sprints in the UI

- Status: Done (approved by the owner on 2026-11-28, with WS-144; done on 2026-11-28)
- Work-track: [WT-10](../work-tracks/WT-10-sprints-and-story-points.md) (item E)
- Depends on: WI-142 (starting and completing) and WI-143 (the sprint field and filter),
  both done
- Work-spec: [WS-144](../work-specs/WS-144-sprints-ui.md)

## Outcome

A team works in sprints from the web app. A Manager turns sprints on in the project's
settings, plans sprints in the backlog (create, edit, delete, order the work into each),
starts one, follows it on the board, and completes it, choosing where unfinished work goes.
Members move tasks between the backlog's sprints and onto the board; Viewers read
everything. Projects without sprints keep their board and backlog as they are (WT-10
decision 15).

## Acceptance criteria

- [x] Project settings have a "Sprints" section: a Manager turns sprints on, with a notice
      that the board's tasks become "Sprint 1", and off, with a notice that completed
      sprints' done tasks come back to the board; `sprint_active` reads "Complete the
      active sprint first."
- [x] In a project with sprints, the backlog shows the active sprint's summary, one section
      per planned sprint (name, dates, goal, tasks and points), then the unscheduled
      tasks, then the completed sprints, collapsed, each linking to the list view filtered
      by it.
- [x] A Manager creates, edits and deletes planned sprints from the backlog, each in a
      dialog that names what happens to the sprint's tasks.
- [x] Members move tasks within and between the backlog's sections by pointer, touch and
      keyboard, and with a "Move to" menu; a move is one request; a refusal (a sub-task
      that follows its parent) is said in words.
- [x] A Manager starts a planned sprint from its section, in a dialog that says how many
      tasks go to the board; another active sprint reads "Complete the active sprint
      first."
- [x] In a project with sprints, the board shows the active sprint's name, dates, goal and
      progress above the columns, with "Complete sprint" for a Manager; with no active
      sprint it shows an empty state linking to the backlog instead of the columns.
- [x] "Complete sprint" opens a dialog that counts done and unfinished tasks and unfinished
      sub-tasks kept with a done parent, and chooses the next planned sprint or the
      backlog for the unfinished work; the board and the backlog follow at once.
- [x] The board and the backlog explain `no_active_sprint`, `subtask_follows_parent`,
      `sprint_completed` and `sprints_disabled` in words, as the task page does.
- [x] A page open on the board, the backlog or the settings follows another person's
      sprint change, start, completion or setting change with no reload.
- [x] Every new control is keyboard-operable with an accessible name, the progress bars are
      named in words, and the axe checks of the pages pass; the full quality gate passes.

## Notes

- The end-to-end flow across the whole track, `docs/agents.md` and proposals P1 and P2 are
  item G.
