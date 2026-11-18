# WI-048 — Live board

- Status: Done
- Work-track: [WT-04](../work-tracks/WT-04-realtime-board-sync.md)
- Depends on: WI-047 (merged: `GET /api/v1/projects/{projectId}/events`)
- Work-spec: [WS-048](../work-specs/WS-048-live-board.md)

## Outcome

Today an open board shows what it loaded, plus its own viewer's changes. The events
endpoint of WI-047 already streams every committed change of a project, but no page
listens to it.

After this item, a board open in one browser shows, without a reload, what anyone else
does to that project's board: a card created (in the app or through the API), edited,
moved, deleted or restored; a column added, renamed, moved or deleted; the project
archived or unarchived. After its stream drops, the board reconnects and reloads, so it
never keeps showing a state it may have missed.

The client hook that opens the stream is shared: WI-049 uses it for the task detail, the
epics page and the project settings.

## Acceptance criteria

- [x] A card moved in one browser appears in its new place in a second browser on the
      same board, without a reload, within a second.
- [x] A task created through the API appears on an open board, in its column and place.
- [x] A task deleted in one browser disappears from the other board, and reappears when
      it is restored.
- [x] A task edited in one browser (title, type, assignee, team) shows the change on the
      other board.
- [x] A column added in the project settings appears on an open board.
- [x] Archiving the project makes an open board read-only, and says so; unarchiving
      makes it writable again.
- [x] A browser ignores the event of its own write (decision 4 of WT-04): it does not
      refetch a task whose version it already holds.
- [x] An event that arrives while a card is being dragged or its move is being saved is
      applied once the drop is settled, and does not disturb the drag.
- [x] After the stream drops, the board reconnects and reloads; while it cannot
      reconnect, a status line says live updates are paused.
- [x] No API contract change. The full quality gate passes.

## Notes

Live updates in the task detail, the epics page and the project settings are WI-049.
