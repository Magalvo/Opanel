# WI-046 — Event hub

- Status: Approved
- Work-track: [WT-04](../work-tracks/WT-04-realtime-board-sync.md) (decisions 3 and 5)
- Depends on: WI-045
- Work-spec: [WS-046](../work-specs/WS-046-event-hub.md)

## Outcome

Each app process hears every event that WI-045 publishes, through one dedicated PostgreSQL
`LISTEN` connection, and hands each event to whoever subscribed to its project. If that
connection drops, the hub never lets a subscriber miss events silently: when the
connection is back, every subscriber is told to start over. Nobody subscribes yet; the
events endpoint is WI-047.

## Acceptance criteria

- [ ] A subscriber of a project receives every event of that project, in the order
      committed, and no event of another project.
- [ ] Subscribing resolves only once `LISTEN` is active, so an event committed after that
      is never missed. If `LISTEN` cannot be started, subscribing fails and a later
      subscription tries again.
- [ ] An unsubscribed subscriber receives nothing more.
- [ ] A payload that is not a valid event is dropped and logged without its content.
- [ ] A subscriber that throws does not keep the others from receiving the event; the
      failure is logged without its message (WS-042).
- [ ] After the `LISTEN` connection is lost and comes back, every subscriber present at
      that time is told to reset and removed; events committed after that reach new
      subscribers.
- [ ] One process opens one `LISTEN` connection, whatever the number of subscribers, and
      hot reload in development does not open a second one.
- [ ] The full quality gate passes.

## Notes

The streams themselves, the heartbeat and the per-account cap are WI-047. The browser's
reaction to a reset (reconnect and reload) is WI-048.
