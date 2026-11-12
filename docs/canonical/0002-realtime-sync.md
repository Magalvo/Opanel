# 0002 — Real-time board sync

- Status: **Proposed** (awaiting owner review)
- Date: 2026-11-12
- Supersedes: none

## 1. Context

The owner requires live sync in v1: several members must be able to use the same board at
the same time and see each other's changes without refreshing. Tickets filed by AI agents
must also appear on open boards as they are created.

Constraints from earlier decisions: a single Next.js monolith, PostgreSQL, self-hosted via
Docker Compose, no extra infrastructure unless it is clearly needed.

## 2. Decision (proposed)

**Server-Sent Events (SSE) for server-to-client push, PostgreSQL `LISTEN/NOTIFY` as the
event bus, and the existing REST API for all writes.**

```
 Browser A --- PATCH /api/v1/tasks/42 ---> route handler -> service
                                                              | 1. write + bump version
                                                              | 2. NOTIFY in same transaction
                                                              v
                                                         PostgreSQL
                                                              |
                                            LISTEN (one shared connection per app process)
                                                              v
 Browser B <== SSE: GET /api/v1/projects/{id}/events ==== event hub (in-process fan-out)
 Browser A <== (same stream; ignores its own echo)
```

### Why this and not WebSockets

- Board sync is one-directional: clients already write through REST, and only need to be
  told about changes. SSE covers that exactly.
- SSE is plain HTTP: it works in a Next.js route handler, through ordinary reverse
  proxies, with cookie auth and automatic browser reconnection. WebSockets in Next.js need
  a custom server or a second service.
- `LISTEN/NOTIFY` needs no new infrastructure and stays correct if the app is later run as
  several processes, because every process hears every notification.

Rejected: polling (does not meet the requirement), WebSockets (more moving parts for no
v1 benefit), Redis pub/sub (extra service), CRDT/collaborative text editing (out of scope,
see section 6).

## 3. Event contract

`GET /api/v1/projects/{projectId}/events` — `text/event-stream`, authenticated like any
other endpoint (session cookie, or an agent token with `tasks:read`), and limited to
projects the actor may read.

Events are small and carry identifiers, not full entities:

```jsonc
// event: task.updated
{ "id": "evt_...", "entity": "task", "entityId": "42", "version": 7,
  "actorAccountId": "acc_...", "at": "2026-11-12T10:00:00Z" }
```

Event types in v1: `task.created`, `task.updated`, `task.moved`, `task.deleted`,
`comment.created`, `column.changed`, `epic.changed`.

On receiving an event the client refetches the affected entity (or patches its cache when
the payload is enough, such as a delete). Keeping payloads thin means:

- permissions are enforced by the normal read endpoints, not duplicated in the stream;
- `NOTIFY`'s 8 KB payload limit is never a concern;
- there is one serialization path for each entity.

The stream sends a heartbeat comment every 25 seconds so proxies keep it open.

## 4. Consistency rules

- **Server is authoritative.** The UI applies changes optimistically, then reconciles with
  the server response and with incoming events.
- **Optimistic concurrency.** Every task has an integer `version`. Updates send the
  version they were based on; a mismatch returns `409 Conflict` with the current entity,
  and the UI shows the newer state instead of overwriting it. Different fields edited by
  different people are not merged in v1: the second writer gets the `409`.
- **Ordering within a column** uses a fractional `position` value, so moving one card
  writes one row and concurrent moves of different cards do not conflict.
- **Events are emitted in the same transaction as the write** (`NOTIFY` is delivered on
  commit), so a client never hears about a change that was rolled back.
- **Reconnects.** Delivery is at-most-once. After any reconnect the client refetches the
  board rather than replaying missed events. No event log is stored in v1.

## 5. Operational notes

- One dedicated PostgreSQL connection per app process holds the `LISTEN`; it is not taken
  from the query pool and reconnects with backoff.
- The app must run on a long-lived Node.js server (the Docker Compose deployment).
  Serverless/edge hosting is not supported for the events endpoint.
- Reverse proxies must not buffer the stream (`X-Accel-Buffering: no` is sent).
- A per-account cap on concurrent streams protects the server.

## 6. Out of scope (v1)

- Presence ("who is viewing"), live cursors, typing indicators.
- Simultaneous co-editing of the same task description (CRDT/OT).
- Offline editing and replay of missed events.

## 7. Testing approach

- Unit: event hub fan-out, version-conflict logic, fractional position calculation.
- Integration (real PostgreSQL): a service write produces exactly one notification after
  commit and none after rollback; stale-version update returns `409`.
- E2E (Playwright, two browser contexts): a card moved in one context appears moved in the
  other without reload; a ticket created through the API appears on an open board.

## 8. Open questions for the owner

1. Is "second writer gets a conflict and sees the newer version" acceptable for v1, or do
   you want field-level merging (two people editing different fields both succeed)?
2. Is presence (avatars of who is on the board) wanted in v1? Proposed: no.
