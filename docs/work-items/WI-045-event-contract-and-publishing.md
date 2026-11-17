# WI-045 — Event contract and publishing

- Status: Done
- Work-track: [WT-04](../work-tracks/WT-04-realtime-board-sync.md) (decisions 1 to 3)
- Depends on: none
- Work-spec: [WS-045](../work-specs/WS-045-event-contract-and-publishing.md)

## Outcome

Every write that a board, a task detail, the epics page or the project settings shows
announces itself with one small event, sent with PostgreSQL `NOTIFY` inside the write's own
transaction, so it is delivered on commit and never after a rollback. The event contract is
a Zod schema shared by the server, the UI and (from WI-047) the OpenAPI document, and
canonical doc 0002 describes it as amended by WT-04. Nobody listens yet: the hub is WI-046
and the endpoint WI-047.

## Acceptance criteria

- [x] `src/lib/schemas/events.ts` defines the nine event types of WT-04 decision 1, each
      with its `entity`, `projectId`, `entityId`, `version`, `actorAccountId`, `at` and
      `id`, and `taskId` on `comment.created`; anything else is refused.
- [x] Each service operation of WT-04 decision 2 sends exactly one event of its type on
      the `opanel_events` channel after commit, carrying the entity's version after the
      write and the acting account.
- [x] A write that is refused or rolled back sends nothing, including when its history or
      audit write fails and when the caller's own transaction rolls back.
- [x] A call that writes nothing sends nothing: restoring a task that is not deleted,
      archiving an archived project, unarchiving an active one.
- [x] An update that changes no field and a move within one column, which both bump
      `version`, send their event.
- [x] Creating a project sends nothing.
- [x] Canonical doc 0002 lists the event types and payload of WT-04 decision 1 and the
      echo rule of decision 4.
- [x] The full quality gate passes.

## Notes

The live push itself (hub, endpoint, client) is WI-046 to WI-049. This item only makes
every write announce itself, so later items can be tested against real events.
