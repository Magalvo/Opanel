# WI-038 — Task detail: fields, Markdown description, assignment, epic, comments, delete

- Status: Approved
- Work-track: [WT-03](../work-tracks/WT-03-board-core.md) (decisions 8, 12, 14, 15, 17, 18;
  question 3)
- Depends on: WI-033, WI-034, WI-037, WI-041
- Work-spec: [WS-038](../work-specs/WS-038-task-detail.md)

## Outcome

Every task has its own URL, `/projects/KEY/tasks/KEY-12`. Reached from the board, it opens
as a dialog over the board; visited directly or reloaded, it is a full page. It shows the
task's fields, its Markdown description rendered safely, and its comments. A person who may
change the task edits its title, type, description, team, person and epic, moves it to
another column without dragging, and comments on it; whoever may delete it deletes it. The
board behind the dialog follows those changes. The screen uses only existing `/api/v1`
endpoints.

## Acceptance criteria

- [ ] A card's title on the board links to the task. From the board the task opens as a
      dialog over it, at the task's URL; Back or closing returns to the board as it was. A
      reload or a direct visit shows the full page.
- [ ] The screen shows key, title, type, column, team, person (marked when deactivated),
      epic, reporter, creation and change times, and the description as Markdown.
- [ ] Markdown is rendered with raw HTML ignored, no images, and links only for `http`,
      `https` and `mailto`; a script written in a description or a comment never runs,
      and the browser reports no Content Security Policy violation.
- [ ] A person with `tasks:write` edits title, type, description (with a preview), team,
      person (searched among active people) and epic, and saves them in one request with
      the task's `version`. A version conflict shows the current values and says so;
      `account_inactive`, field errors and `project_archived` are explained in plain words.
- [ ] The column select moves the task to the end of the chosen column.
- [ ] Comments are listed oldest first, rendered as Markdown; a person with
      `comments:write` adds one, with a preview.
- [ ] Delete is offered to Managers and Admins, and to a Member for a task they reported;
      it asks first, and afterwards the task is gone from the board.
- [ ] A Viewer, and everyone on an archived project, sees the task with no editing,
      moving, commenting or deleting.
- [ ] A task key that does not exist, is deleted, or belongs to another project shows a
      plain "not found" message.
- [ ] Dragging still works by pointer, touch and keyboard (WI-037), now from a drag handle
      for the keyboard.
- [ ] `react-markdown` is added with an exact pinned version.
- [ ] The screen works by keyboard, announces outcomes, has no accessibility violations in
      light and dark mode, and has no horizontal page scroll at phone width.
- [ ] The full quality gate passes.

## Notes

The activity timeline is WT-08; editing or deleting comments is not planned (WT-03
question 2). Live updates from other people are WT-04.
