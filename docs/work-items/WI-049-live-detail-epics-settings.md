# WI-049 — Live task detail, epics page and project settings

- Status: Done
- Work-track: [WT-04](../work-tracks/WT-04-realtime-board-sync.md)
- Depends on: WI-048 (merged: the live board and `useProjectEvents`)
- Work-spec: [WS-049](../work-specs/WS-049-live-detail-epics-settings.md)

## Outcome

After WI-048 only the board is live. An open task, the epics page and the project settings
still show what they loaded.

After this item:

- an open task detail (page or dialog) shows new comments and other people's changes to
  the task, and never discards what its viewer is typing (WT-04 decision 10);
- the epics page shows epics created, edited, closed or reopened elsewhere, and progress
  that changes as tasks move;
- the project settings show other people's changes to the details, the columns and the
  deleted tasks;
- every page of a project shares one events stream, owned by the project frame, instead of
  one per component.

## Acceptance criteria

- [x] A comment added in one browser appears in another browser's open task detail.
- [x] A field changed in one browser shows in another browser's open task detail when its
      viewer has no unsaved edits.
- [x] When the viewer has unsaved edits and the task changes elsewhere, the fields they
      are not editing update, the ones they are editing keep their text, they are told the
      task changed, and their next save gets the `409` and the conflict notice of WS-038.
- [x] A task deleted elsewhere while open says so and becomes read-only.
- [x] An epic created, edited or closed in one browser appears on another browser's epics
      page; a task moved to a done column updates its epic's progress there.
- [x] A column renamed in one browser's project settings shows in another's; the project
      details and the deleted tasks list follow too, with the same rule for unsaved edits.
- [x] A project page opens one events stream, however many parts of it are live (the task
      dialog over the board included).
- [x] After a reconnect each of these pages reloads what it shows.
- [x] The board behaves as in WI-048. No API contract change. The full quality gate passes.

## Notes

The last item of WT-04. Its exit criteria are checked when this item is done.
