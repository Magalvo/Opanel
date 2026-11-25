# WS-124 — Stream heartbeats keep the queue cap and renew no session

- Status: Proposed
- Work-item: [WI-124](../work-items/WI-124-stream-heartbeat.md)
- Canonical docs: [0002](../canonical/0002-realtime-sync.md) section 3 (the heartbeat);
  [0004](../canonical/0004-api-conventions.md) section 7 (sessions are extended by use);
  [WT-04](../work-tracks/WT-04-realtime-board-sync.md) decisions 6 to 8 (re-check on every
  heartbeat, the cap, the 64 KiB queue); [WS-047](WS-047-events-endpoint.md) and
  [WS-073](WS-073-project-restrictions.md) (the stream and its checks)

## Approach

### 1. Starting point, checked against `main` (`0461e5b`)

`openEventStream` (`src/server/http/event-stream.ts`) builds the stream on a
`ByteLengthQueuingStrategy` of 64 KiB. The hub's `event` callback drops the stream when
`controller.desiredSize <= 0`, then calls `write`; `write` itself only checks `finished`.
So:

- the heartbeat (`write(": heartbeat\n\n")`) is never checked against the queue: a stream
  with no events that nobody reads grows by 13 bytes every 25 seconds without end and keeps
  its place in the account's cap (C06);
- an event is checked before it is queued but not against its own size, so the queue can
  pass 64 KiB by up to one frame;
- `setInterval` calls `authenticate(request)` every interval whether or not the last call
  has settled: with the database slow, checks pile up, one per interval per stream (C06).

Every heartbeat calls `authenticate` from `src/server/auth/authenticate.ts`, which calls
`getAuth().api.getSession({ headers, returnHeaders: true })`. Opanel configures
`expiresIn` 7 days and `updateAge` 1 day and no cookie cache (`src/server/auth/auth.ts`).
In Better Auth 1.7.22 (installed, `node_modules/better-auth/dist/api/routes/session.mjs`),
`getSession` reads the session row, ends an expired one, and then, when the session is at
least `updateAge` old, writes a new `expiresAt` of now + `expiresIn` and a new cookie. The
stream has already answered, so the cookie is lost, but the row is extended: an open board
tab keeps its session alive in the database (B06).

### 2. Backpressure in `write` (C06)

`write(chunk)` becomes the only place that queues after `start`, and it checks the chunk's
own size against the space left:

```ts
function write(chunk: Uint8Array): void {
  if (finished || !controller) return;
  // The reader has fallen too far behind: drop it rather than queue more (decision 8).
  if ((controller.desiredSize ?? 0) < chunk.byteLength) {
    finish();
    return;
  }
  controller.enqueue(chunk);
}
```

The hub's `event` callback becomes `event: (event) => write(frameOf(event))`. With this,
the bytes a reader leaves unread never pass 64 KiB, for heartbeats and events alike, and a
stream that is dropped gives its place back through `finish`, as today. The opening frame
(`retry` and `: connected`, 26 bytes) is still queued in `start`, before any `write`.

### 3. One heartbeat check at a time (C06)

`setInterval` becomes a timeout that schedules itself once the check has settled:

- `scheduleHeartbeat()` sets `timer.heartbeat = setTimeout(beat, heartbeatMs)`, unless the
  stream has `finished`.
- `beat()` returns at once if the stream has `finished`; otherwise it runs the check, then,
  when the check settles: if the stream has `finished` meanwhile, nothing (no write, no
  log, no new timeout); else, as today, writes the heartbeat or ends the stream, and on a
  heartbeat calls `scheduleHeartbeat()` again.
- `finish()` calls `clearTimeout` instead of `clearInterval`.

So at most one check is in flight per stream, and the next one starts one interval after
the last one finished: with checks of a few milliseconds the rhythm stays about 25
seconds, which is what proxies need (doc 0002 section 3).

### 4. A check that does not extend the session (B06)

`AuthenticateOptions` gains `refreshSession?: boolean` (default `true`). When it is
`false`, the session path calls
`getSession({ headers, query: { disableRefresh: true }, returnHeaders: true })`. In Better
Auth 1.7.22 `disableRefresh` is part of `getSession`'s query schema (typed in
`dist/api/routes/session.d.mts`) and, in the code above, returns the session after reading
the row and checking its expiry, before any renewal. A revoked (deleted) or expired
session still answers `null`, so `authenticate` still throws `401`; the account's
`disabledAt` and role are still read from `accounts`, as today. The token path ignores the
option (a token is never renewed).

`openEventStream`'s default `authenticate` becomes
`(request) => authenticate(request, { refreshSession: false })`. Every other caller
(`route()` and the pages' `requireAccount()`) keeps the default, so requests a person makes
still extend the session and return its cookie (doc 0004 section 7). The request that
opens the stream goes through `route()`, so opening a board still counts as use; only the
heartbeats do not.

Consequence, as B06 intends: a board left open with no other request expires seven days
after the session was last extended; its next heartbeat then ends the stream and the
browser's reconnect gets `401`, as for a revoked session today.

### 5. The `authenticate` option's type

The stream reads only `actor` from the check. `EventStreamOptions.authenticate` narrows to
`(request: Request) => Promise<{ actor: Actor }>`, which `Authenticated` satisfies, so
tests can pass a check without building an `AccountRow`.

### 6. Canonical docs

- 0002 section 3: the heartbeat is queued under the same 64 KiB limit as events, one
  credential check runs at a time, and the check does not extend the session (WS-124).
- 0004 section 7, the bullet on `Set-Cookie`: the event stream's heartbeats check the
  session without extending it.

## Files

| Path                                               | Change                                              |
| -------------------------------------------------- | --------------------------------------------------- |
| `src/server/http/event-stream.ts`                  | modify: `write` checks space, self-scheduling check |
| `src/server/http/event-stream.test.ts`             | create: tests 1 to 5 (unit, fake hub and timers)    |
| `src/server/http/event-stream.integration.test.ts` | modify: tests 8 and 9                               |
| `src/server/auth/authenticate.ts`                  | modify: `refreshSession` option                     |
| `src/server/auth/authenticate.integration.test.ts` | modify: tests 6 and 7                               |
| `docs/canonical/0002-realtime-sync.md`             | modify: section 3                                   |
| `docs/canonical/0004-api-conventions.md`           | modify: section 7                                   |
| WI-124, WS-124                                     | modify: statuses, implementation record             |

No dependency, no migration, no route or schema change. `docs/README.md` changes only by
index commits on `main`: C06 and B06 are marked answered by WI-124 once it is done.

## Data model changes

None.

## API contract

None. The stream's frames, status codes and OpenAPI entry are unchanged.

## Test plan (written first, in this order)

Tests 1 to 5 are unit tests in Node with no database: a fake `EventHub` whose `subscribe`
keeps the listener (so a test can emit events), a fake `authenticate` returning a
`humanActor` with `tasks:read`, and fake timers for `setTimeout` and `setInterval` only
(`vi.useFakeTimers({ toFake: [...] })`, advanced with `advanceTimersByTimeAsync`), so no
test waits on the clock. The cap is checked by opening a second stream with
`maxStreamsPerAccount: 1`.

| #   | Level       | Test                                                                                                                                                                                                                                                                                       | Covers criterion |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| 1   | unit        | A stream nobody reads and with no events: after enough heartbeat intervals to pass 64 KiB (just over 5 000 at the default 25 s), it is closed, its place is given back, and the bytes it had queued, read afterwards, total at most 64 KiB. Fails today: it stays open, holding the place. | 1, 2             |
| 2   | unit        | A stream nobody reads, sent events of a size that does not divide 64 KiB: it is dropped and the bytes it had queued total at most 64 KiB. Fails today by up to one frame.                                                                                                                  | 2                |
| 3   | unit        | A stream that is read keeps receiving heartbeats and events past 64 KiB in total, and stays open.                                                                                                                                                                                          | 2                |
| 4   | unit        | A check held unresolved across five intervals: `authenticate` has been called once. Once it resolves, a heartbeat is written, and one interval later the second check starts. Fails today: five calls.                                                                                     | 3                |
| 5   | unit        | A check held unresolved while the reader cancels the stream: when it then resolves (and, separately, when it rejects), nothing is written or logged, no further check starts over later intervals, and the place is given back once.                                                       | 4                |
| 6   | integration | `authenticate(request, { refreshSession: false })` with a session aged past one day (its `expiresAt` set to now + 5 days): it answers the person, no `Set-Cookie`, and the row's `expiresAt` is unchanged. Fails today (the option is ignored, the row is extended).                       | 5                |
| 7   | integration | The guard for the default: `authenticate(request)` with the same aged session still extends `expiresAt` to about seven days and returns a `Set-Cookie`. Passes before the change; kept so the option cannot leak into the default.                                                         | 5                |
| 8   | integration | An open stream on an aged session, heartbeat 50 ms: after two heartbeats the session's `expiresAt` is unchanged. Fails today (the first heartbeat extends it).                                                                                                                             | 5                |
| 9   | integration | An open stream on an aged session ends at the next heartbeat once the session's `expiresAt` is set in the past, and, in a second test, once the session is deleted.                                                                                                                        | 6                |

The existing tests of `event-stream.integration.test.ts` (session revoked, account
deactivated, without `tasks:read`, the hub reset, 400 unread events, an agent's token
revoked, the agent disabled, the agent losing the project) keep running unchanged and now
go through the non-renewing check: they cover criterion 6 for every other way the stream
ends. The full quality gate covers criterion 7.

## Risks and open questions

1. **Fake timers and streams.** Tests 1 to 5 fake only `setTimeout` and `setInterval`, so
   promises and the stream's own queue run normally. If `advanceTimersByTimeAsync` proves
   too slow for the 5 000 intervals of test 1, the test passes a short `heartbeatMs`
   rather than adding a test-only queue-size option.
2. **Rhythm.** The interval now runs from the end of one check to the start of the next,
   so a heartbeat comes every 25 seconds plus the time of one check. A check that takes
   longer than a proxy's idle timeout (typically 60 seconds or more) would let the proxy
   close the stream; the browser then reconnects, which is the right outcome when the
   database is that slow.
3. **B07** also changes `authenticate.ts` (its token path). Whichever lands second takes
   in `main` and keeps both changes; they do not overlap in lines.
