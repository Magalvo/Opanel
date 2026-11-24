# WI-117 — Task activity: history and comments in one list

- Status: Proposed
- Work-track: [WT-08](../work-tracks/WT-08-search-filters-list-timeline.md) (item C)
- Depends on: none
- Work-spec: [WS-117](../work-specs/WS-117-task-activity.md)

## Outcome

Anyone with `tasks:read` reads a task's whole story through one endpoint: its history
entries and its comments, oldest first, in one paged list, each entry with the account
that acted and with every account, team, column and epic it mentions named. It is what the
timeline on the task page (item F) shows, and what an agent reads to learn what happened
to a task.

## Acceptance criteria

- [ ] `GET /api/v1/tasks/{taskId}/activity` (`tasks:read`, the task's project within the
      caller's reach) lists comments and history entries oldest first, paged with a keyset
      cursor; `commented` entries are left out. A deleted or unknown task is a `404`, a
      project outside a restricted agent's reach a `403`, as for the task itself.
- [ ] Each item has a `kind`: a `comment` item is the `Comment` the comments endpoint
      answers; an `event` item has `id`, `type`, `field`, `oldValue`, `newValue`, `actor`
      (`AccountRef`, or `null` when no account acted) and `createdAt`.
- [ ] In an event, assignee, assignee team, epic and column ids are answered as
      `{ id, name }`, read at the time of the request, with `name: null` for a team or
      column that no longer exists; labels keep the `{ id, name }` the history stored.
- [ ] Every event type and every field written today reads back in that shape: `created`,
      each `field_changed` field, `moved` to and from the backlog, `deleted`, `restored`,
      `reported_again`, and the `labels` entries written when a label is deleted.
- [ ] Pages hold no item twice and miss none, also when items share a timestamp and while
      comments are added between pages.
- [ ] The OpenAPI document describes the endpoint and its item shapes.
- [ ] The full quality gate passes, with `pnpm openapi:generate` leaving no diff.

## Notes

- No UI: the timeline is item F. `docs/agents.md` is item G.
- `GET /tasks/{taskId}/comments` and the MCP tools that use it are unchanged (WT-08
  question 7).
