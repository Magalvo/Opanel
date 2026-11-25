# WI-124 — Stream heartbeats keep the queue cap and renew no session

- Status: Done (approved by the owner on 2026-11-25, with WS-124; done on 2026-11-25)
- Work-track: none: follow-ups C06 (independent audit of 2026-11-24) and B06 (audit of
  2026-11-19), both confirmed in the code of `main` (`0461e5b`)
- Depends on: none
- Work-spec: [WS-124](../work-specs/WS-124-stream-heartbeat.md)

## Outcome

The heartbeat of the project event stream (`GET /api/v1/projects/{projectId}/events`,
WS-047) obeys the same rules as the events it carries, and only checks the caller:

- C06: a heartbeat is queued only when it fits in the 64 KiB a reader may leave unread
  (WT-04 decision 8), as an event is; otherwise the stream is closed and its place in the
  account's cap given back. Today a quiet stream nobody reads queues heartbeats without
  limit and keeps its place. And at most one heartbeat credential check runs at a time per
  stream: today `setInterval` starts a new one every interval even while the last is still
  waiting on a slow database, so the checks pile up.
- B06: the heartbeat's check of a session no longer extends it. Today every heartbeat goes
  through Better Auth's ordinary `getSession`, which extends a session older than
  `updateAge` (one day), and the `Set-Cookie` it produces is thrown away because the
  response has started: a board tab left open keeps its session alive in the database for
  ever. Watching a board is not using the app (doc 0004 section 7); requests a person makes
  still extend the session as today.

## Acceptance criteria

- [x] A stream nobody reads, with no events, is closed once its heartbeats would take the
      unread bytes past 64 KiB, and its place in the account's cap is given back.
- [x] No chunk is queued that would take a stream's unread bytes past 64 KiB, for
      heartbeats and events alike; a stream that is read keeps its heartbeats and events.
- [x] While a heartbeat check has not finished, no other one starts, however many
      intervals pass; the next starts one interval after it finishes.
- [x] A check that finishes after its stream has ended writes nothing and starts no other
      check.
- [x] A heartbeat check of a session older than its renewal age leaves the session's
      expiry unchanged, while a request through the API still extends it, as today.
- [x] A heartbeat still ends the stream when the session is revoked, has expired, or its
      account is deactivated, when an agent's token is revoked, and when the caller loses
      `tasks:read` or the project, as today.
- [x] The full quality gate passes.

## Notes

C06 and B06 are one item because both are the heartbeat: the same timer, the same check.
The route, the response, the event payloads and the OpenAPI document do not change. B07
(rate-limiting failed bearer-token authentication) also changes `authenticate.ts`, in its
token path; this item touches only its session path and its options.
