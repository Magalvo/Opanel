# WI-038 — Task detail

- Status: Proposed (awaiting owner approval)
- Work-track: [WT-03](../work-tracks/WT-03-board-core.md) (decisions 8, 12, 14, 15; question 3)
- Depends on: WI-033 (epics), WI-034 (comments), WI-037 (the board), WI-041 (the Content
  Security Policy, which the Markdown renderer must run under)
- Work-spec: [WS-038](../work-specs/WS-038-task-detail.md)

## Outcome

A task has a page of its own at `/projects/KEY/tasks/KEY-12`, shareable and reloadable. Opened
from a card on the board it appears as a dialog over the board instead, and closing it or
pressing Back returns to the board. On it, someone who can write edits the title, type and
Markdown description, assigns the task to a team and a person, chooses its epic, moves it to
another column, and comments; someone who reported a task (or a Manager or Admin) deletes it.
A Viewer reads everything and changes nothing. Descriptions and comments are shown as
Markdown with raw HTML off and only safe links.

## Acceptance criteria

- [ ] `/projects/KEY/tasks/KEY-12` shows the task as a page; from a card on the board the same
      content opens as a dialog over the board, with the same URL, and Back closes it.
- [ ] Cards on the board link to the task; dragging by the handle and the card menu still work.
- [ ] The task shows its key, title, type, column, team, person, epic, reporter, dates and
      description rendered as Markdown.
- [ ] A Member, Manager or Admin edits title, type, description, team, person and epic and
      saves them together with the task's `version`; a stale version shows the current values
      and says so. Only active people can be chosen, and a deactivated assignee stays visible.
- [ ] The column can be changed from the task (the move that needs no dragging, decision 15).
- [ ] Markdown has no raw HTML, no images, and only `http`, `https` and `mailto` links, which
      open in a new tab without `opener`; a `<script>` or a `javascript:` link in a
      description or comment is shown as text or not linked, and never runs.
- [ ] Comments are listed oldest first and rendered as Markdown; someone who can comment adds
      one and sees it at once.
- [ ] A task can be deleted by its reporter (a Member) or by a Manager or Admin, after a
      confirmation, and the person returns to the board without it.
- [ ] A Viewer, and an archived project, show the task with no edit, move, comment or delete
      control.
- [ ] A change made in the dialog shows on the board behind it without a reload.
- [ ] A task of another project's key, an unknown key and a deleted task are the not-found page.
- [ ] Keyboard use, accessible names, announced outcomes, phone width, the dark theme, no axe
      violations and no Content Security Policy violation.
- [ ] The full quality gate passes.

## Notes

The history of a task and the timeline that merges it with comments are WT-08. Sub-tasks, links,
labels, priority and sprints are later tracks. Attachments and mentions are not in v1.
