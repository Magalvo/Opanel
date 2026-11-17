# WI-047 — Events endpoint

- Status: Proposed
- Work-track: [WT-04](../work-tracks/WT-04-realtime-board-sync.md) (decisions 6, 7, 8, 11
  and 12)
- Depends on: WI-046
- Work-spec: [WS-047](../work-specs/WS-047-events-endpoint.md)

## Outcome

`GET /api/v1/projects/{projectId}/events` streams the events of one project to a signed-in
reader as Server-Sent Events, through the event hub of WI-046. The stream is open only
while its session stays valid, sends a heartbeat every 25 seconds, is dropped rather than
buffered when its reader falls behind, and closes when the hub resets. Each account may
hold at most 10 streams per app process. The endpoint is in the OpenAPI document, and the
README tells operators what a reverse proxy must allow. No page uses it yet (WI-048).

## Acceptance criteria

- [ ] Without a session the endpoint answers `401`; for an unknown project `404`; its
      declared permission is `tasks:read`, checked by `route()` like every endpoint.
- [ ] A reader's 11th concurrent stream in one process answers `429 too_many_streams`;
      a stream that ends, however it ends, frees its place.
- [ ] Once the response has started, `LISTEN` is active: an event committed after that
      arrives on the stream as `event: <type>` and `data: <the event as JSON>`.
- [ ] Events of other projects never arrive.
- [ ] A heartbeat comment is sent every 25 seconds. Before each one the session is checked
      again; a stream whose session is revoked or expired, whose account is deactivated, or
      whose account no longer holds `tasks:read` is closed.
- [ ] A stream whose reader has fallen behind is closed instead of queueing more.
- [ ] A reset of the hub closes the stream.
- [ ] The response is `text/event-stream`, is not compressed or buffered by `next start`,
      and tells proxies not to buffer it (`X-Accel-Buffering: no`).
- [ ] The OpenAPI document describes the stream and its events; doc 0004 lists
      `too_many_streams`.
- [ ] `README.md` says the app needs a long-lived Node.js server and what a reverse proxy
      must do for this endpoint.
- [ ] The full quality gate passes.

## Notes

The browser side (opening the stream, reconnecting, reloading) is WI-048. Agent tokens
are accepted as soon as WT-05 makes `authenticate()` accept them.
