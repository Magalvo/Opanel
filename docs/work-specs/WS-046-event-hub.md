# WS-046 — Event hub

- Status: Done (approved by the owner on 2026-11-17, questions 1 to 4 as proposed)
- Work-item: [WI-046](../work-items/WI-046-event-hub.md)
- Canonical docs: [0002](../canonical/0002-realtime-sync.md) sections 2, 4 and 5;
  [WT-04](../work-tracks/WT-04-realtime-board-sync.md) decisions 3, 5 and 8;
  [WS-045](WS-045-event-contract-and-publishing.md) (the events);
  [WS-042](WS-042-safe-error-logging.md) (what a log line may say); `AGENTS.md` hard rules
  7 and 13

## Approach

### 1. Where things stand, on the installed versions

- WI-045 sends every event on the channel `EVENTS_CHANNEL` (`opanel_events`), validated by
  `projectEventSchema` (`src/lib/schemas/events.ts`).
- In the installed `postgres@4.1.1` (`src/index.js`, function `Listen`), `sql.listen(name,
fn, onlisten)`:
  - opens one internal connection (`max: 1`) for all the client's listens, outside its
    query pool, and keeps the process alive while it listens;
  - resolves once the `LISTEN` query has completed, and calls `onlisten` then;
  - when that connection closes, sends `LISTEN` again with a backoff (by default up to
    20 seconds between tries) until it succeeds, and then calls `onlisten` **again**. That
    second call is the only sign the library gives that the connection was lost: its own
    `onclose` is overridden internally;
  - if the first `LISTEN` fails, rejects and forgets the channel: no retry.
- `src/server/db/client.ts` keeps its client on `globalThis` so hot reload reuses it; the
  hub does the same.
- `describeError()` (`src/server/http/safe-error.ts`, WS-042) is the only way an error is
  logged.

### 2. A testable core: `createEventHub`

`src/server/services/event-hub.ts` (services are the only code that talks to the
database):

```ts
export interface EventSubscriber {
  /** An event of the subscribed project. */
  event(event: ProjectEvent): void;
  /** Events may have been missed: start over (WT-04 decision 5). Called at most once. */
  reset(): void;
}

/** The part of postgres.js the hub uses, so unit tests can give a fake. */
export type Listen = (
  channel: string,
  onPayload: (payload: string) => void,
  onListen: () => void,
) => Promise<unknown>;

export interface EventHub {
  /** Resolves once LISTEN is active; returns the unsubscribe function. */
  subscribe(projectId: string, subscriber: EventSubscriber): Promise<() => void>;
}

export function createEventHub(options: {
  listen: Listen;
  logError?: (message: string) => void;
}): EventHub;
```

Behaviour:

- **Start.** The first `subscribe` calls `listen(EVENTS_CHANNEL, …)`. Concurrent first
  calls share that one call. If it rejects, every waiting `subscribe` rejects with it, and
  the next `subscribe` calls `listen` again (the library does not retry a first failure).
- **Fan-out.** Subscribers are kept per project (`Map<projectId, Set<EventSubscriber>>`).
  Each payload is parsed with `JSON.parse` and `projectEventSchema.safeParse`, then given
  synchronously to every subscriber of its `projectId`, in arrival order, which is commit
  order. A copy of the set is iterated, so a subscriber may unsubscribe while being called.
- **Bad payloads.** One that does not parse is dropped and logged as
  `Dropped a notification on opanel_events that is not a valid event.`, never with its
  content (hard rule 7: a notification can be sent by anyone with database access).
- **A throwing subscriber** is logged as
  `An event subscriber failed: <describeError(error)>` and the others still get the event.
- **Reset.** `onListen` is called once on start and again after every reconnection. On
  every call after the first, each subscriber present is removed and its `reset()` is
  called (errors caught and logged as above). WI-047 closes the stream; the browser
  reconnects and reloads (WI-048). Events published while the connection was down are
  therefore never silently lost.
- **Unsubscribe** removes the subscriber and, with the last one, the project's entry. It is
  idempotent. The `LISTEN` connection stays open once started (question 3).

### 3. The process's hub: `getEventHub` and `closeEventHub`

```ts
/** The hub of this process, started on first use. */
export function getEventHub(): EventHub;
/** Ends the LISTEN connection and forgets the hub. For tests and shutdown. */
export async function closeEventHub(): Promise<void>;
```

`getEventHub()` builds, once per process and on `globalThis` like the database client, a
hub whose `listen` is that of its **own** `postgres` client:
`postgres(DATABASE_URL, { max: 1, onnotice: () => undefined, connection: { application_name:
"opanel-events" } })`. Only `listen` is used on it, so it opens exactly one connection: the
`LISTEN` one (question 1). The application name lets an operator, and the integration
tests, find that connection in `pg_stat_activity`.

Creating the hub opens nothing: the connection is opened by the first `subscribe`, so
`next build` needs no database, as for `getDb()`.

## Files

| Path                                                | Change                              |
| --------------------------------------------------- | ----------------------------------- |
| `src/server/services/event-hub.ts`                  | create                              |
| `src/server/services/event-hub.test.ts`             | create (unit, fake `listen`, first) |
| `src/server/services/event-hub.integration.test.ts` | create (real database, tests first) |
| `docs/README.md`, WT-04, WI-046, WS-046             | modify: statuses                    |

No new dependency, no migration, no API change.

## Data model changes

None.

## API contract

None. The hub is internal; WI-047 exposes it as the events endpoint.

## Test plan (written first, in this order)

Unit tests use a fake `listen` that records its callbacks, so a test can deliver a
payload or simulate a reconnection by calling them.

| #   | Level       | Test                                                                                                                                                                                        | Covers criterion |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit        | an event goes to every subscriber of its project, in arrival order, and to none of another project                                                                                          | fan-out          |
| 2   | unit        | `subscribe` resolves only after `listen` resolves; three concurrent first subscriptions call `listen` once; later ones do not call it again                                                 | start, one conn. |
| 3   | unit        | when `listen` rejects, the waiting subscriptions reject, and the next subscription calls `listen` again and succeeds                                                                        | start failure    |
| 4   | unit        | after unsubscribe, nothing more is received; calling it twice is harmless; a subscriber may unsubscribe from inside `event`                                                                 | unsubscribe      |
| 5   | unit        | a payload that is not JSON, not an event, or a sentinel is dropped; the log line does not contain the payload; the next valid event is delivered                                            | bad payload      |
| 6   | unit        | a subscriber that throws an error with a marker message: the others still get the event, and the log line holds the class name and not the marker                                           | isolation        |
| 7   | unit        | the first `onListen` resets nobody; a second one calls `reset()` once on every subscriber present and removes them; an event after it reaches only subscribers that joined afterwards       | reset            |
| 8   | integration | with the real hub: an event published by a service (WI-045) in a committed transaction reaches a subscriber of its project; one of another project receives nothing                         | real delivery    |
| 9   | integration | `pg_terminate_backend` on the connection named `opanel-events`: the subscriber's `reset()` is called once the hub listens again, and an event published after that reaches a new subscriber | reconnect        |
| 10  | integration | however many subscriptions, `pg_stat_activity` shows one connection named `opanel-events`; `getEventHub()` returns the same hub twice                                                       | one connection   |
| 11  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm db:generate` and `pnpm openapi:generate` leave no diff                                                                       | gate             |

Test 9 waits for the reset with a bounded wait (the library's backoff after a first
failure is under a second); it uses no fixed sleep. Each integration test ends with
`closeEventHub()`, so no `LISTEN` connection keeps the test process alive.

## Risks and open questions

For the owner:

1. **Its own client, not the application's.** The `listen` of `getDb().$client` would
   work too, but a separate client can carry an application name for operators and tests,
   and can be closed without closing the query pool. It costs nothing more: either way,
   one connection holds the `LISTEN`. **Recommend: its own client.**
2. **Silence while the connection is down.** The library gives no sign at the moment the
   connection drops, only when `LISTEN` is back (section 1). Until then open streams stay
   open and receive nothing (their heartbeat continues, WI-047); then every subscriber is
   reset. With the default backoff that is at most about 20 seconds after the database is
   reachable again. **Recommend: accept; reloading on the reset is what keeps the board
   correct.**
3. **The `LISTEN` connection stays open** once the first stream has started, even when
   nobody subscribes, rather than being opened and closed as boards come and go.
   **Recommend: keep it open; it is one idle connection.**
4. **Notifications that are not events are logged.** Only code with database access can
   send one. Each is logged once, without content. **Recommend: as proposed.**

## Deviations from the approved spec

None in behaviour. Two details the spec left open:

- `getEventHub()` passes the client's `listen` through a small arrow function, so the hub
  depends only on the `Listen` type and not on the whole postgres.js client.
- The unit tests' fake `listen` calls `onListen` before resolving, as the installed
  library does (`src/index.js`: `listener.onlisten()` runs before `listen` returns).

## Implementation record

- Red: both test files failed on the missing `event-hub` module (committed before any
  code).
- Green: the 9 unit cases and the 3 integration tests pass. In the reconnection test, the
  library listened again right after `pg_terminate_backend` and the reset came within its
  first retry.
- Full gate: 1078 Vitest tests (up from 1066) and 62 Playwright tests pass. Typecheck,
  lint and format pass; `pnpm db:generate` and `pnpm openapi:generate` leave no diff.
- Locally the database was PostgreSQL 16 (no Docker in the sandbox); CI runs the
  PostgreSQL 18 of `compose.yaml`.
