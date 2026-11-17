# WS-047 — Events endpoint

- Status: Proposed (must be `Approved` by the owner before any code is written)
- Work-item: [WI-047](../work-items/WI-047-events-endpoint.md)
- Canonical docs: [0002](../canonical/0002-realtime-sync.md) sections 3 to 5;
  [WT-04](../work-tracks/WT-04-realtime-board-sync.md) decisions 6, 7, 8, 11 and 12;
  [0004](../canonical/0004-api-conventions.md) (errors, OpenAPI);
  [WS-046](WS-046-event-hub.md) (the hub); [WS-025](WS-025-route-declares-access.md)
  (`route()`); `AGENTS.md` hard rules 6, 9 and 13

## Approach

### 1. Where things stand, on the installed versions

- `getEventHub().subscribe(projectId, { event, reset })` (WI-046) resolves once `LISTEN` is
  active and returns the unsubscribe function; `reset()` means "events may have been
  missed".
- `route(contract, handler)` (`src/server/http/route.ts`) authenticates, checks the
  declared permission and passes the `Authenticated` caller. Its shared behaviour then
  copies the response and **sets `Cache-Control: no-store`**, replacing whatever the
  handler set. The copy keeps `response.body`, so a stream passes through unchanged.
- `authenticate(request)` (`src/server/auth/authenticate.ts`) asks Better Auth for the
  session on every call; there is no cookie cache in `src/server/auth/auth.ts`, so a
  revoked session is seen at once. It returns `401` for a disabled account.
- Next.js 16.4.6, `node_modules/next/dist/docs/01-app/02-guides/streaming.md`, "Streaming
  in Route Handlers": a handler returns `new Response(readableStream)`; Server-Sent Events
  are named as a use. The same guide warns that reverse proxies buffer unless sent
  `X-Accel-Buffering: no`, and that gzip can hold chunks back.
- `next start` compresses with the compiled `compression` package
  (`next/dist/server/lib/router-server.js`), which skips any response whose
  `Cache-Control` contains `no-transform` (`next/dist/compiled/compression`, function
  `shouldTransform`).
- `getProject(actor, ref)` resolves an id or a key and answers `404` for an unknown
  project; archived projects are readable.
- `EndpointContract` responses are JSON, problem, no-content or version-conflict
  (`src/lib/openapi/contract.ts`); there is no stream kind yet.

### 2. The route: `src/app/api/v1/projects/[projectId]/events/route.ts`

```ts
export const dynamic = "force-dynamic";

export const GET = route(projectEventsContract, async (request, context, auth) => {
  const { projectId } = await readParams(context.params, projectParamsSchema);
  const project = await getProject(auth.actor, projectId); // 404
  return openEventStream({ request, projectId: project.id, account: auth.account.id });
});
```

The contract declares `{ kind: "permission", permission: "tasks:read" }` (doc 0002 section
3). It is thin: everything else is in the helper of section 3.

### 3. The stream: `src/server/http/event-stream.ts`

```ts
export interface EventStreamOptions {
  request: Request;
  projectId: string;
  account: string;
  hub?: EventHub; // default getEventHub()
  authenticate?: (request: Request) => Promise<Authenticated>; // default authenticate
  heartbeatMs?: number; // default 25 000
  maxStreamsPerAccount?: number; // default 10
}

/** Subscribes, then answers with the stream. Throws `429 too_many_streams` first if needed. */
export async function openEventStream(options: EventStreamOptions): Promise<Response>;
```

Order:

1. **Cap (decision 7).** A module-level `Map<accountId, number>` counts open streams in this
   process. At the limit, `tooManyStreams()` is thrown: `429`, code `too_many_streams`,
   with `Retry-After: 30`. Otherwise the count is taken now, before any `await`, so
   concurrent requests cannot both slip under it.
2. **Subscribe** to the hub. If that fails (the database is unreachable), the place is
   given back and the error is rethrown: `route()` logs it with `describeError` and answers
   `500 internal_error`. Because the response starts only after the subscription, any
   event committed after the client sees the response arrives (WI-048 relies on this to
   load the board after the stream opens).
3. **Answer** `200` with a `ReadableStream` and the headers:
   - `Content-Type: text/event-stream; charset=utf-8`;
   - `Cache-Control: no-store, no-transform` (`no-transform` keeps `next start` from
     gzipping it; see section 4 for `route()`);
   - `X-Accel-Buffering: no`.

   The first chunk is `retry: 3000` (the browser waits 3 seconds before reconnecting) and a
   comment `: connected`, so headers and a first byte reach the browser at once.

While open:

- **An event** is written as `event: <type>\ndata: <JSON>\n\n`. No `id:` line: no
  `Last-Event-ID` is honoured, as no event log exists (decision 11).
- **Backpressure (decision 8).** The stream uses a byte-length queuing strategy with a
  high-water mark of 64 KiB. If `desiredSize` is not positive when an event arrives, the
  reader has fallen that far behind: the stream is closed instead.
- **Heartbeat (decision 6).** Every `heartbeatMs`, the request's credentials are checked
  again with `authenticate(request)` and `can(actor, "tasks:read")`. If either fails, the
  stream is closed; otherwise `: heartbeat\n\n` is written. A failed check is not logged
  (an expired session is ordinary); an unexpected error is, with `describeError`.
- **Reset** from the hub closes the stream.

**Closing** happens on any of: the client goes away (`request.signal` aborts, or the stream
is cancelled), backpressure, a failed heartbeat check, a hub reset. One idempotent
`finish()` then unsubscribes, stops the heartbeat, closes the controller if still open,
and gives the place in the cap back, exactly once.

Errors after the response has started cannot become a problem body; the stream simply
ends, and the browser reconnects (WI-048).

### 4. `route()` keeps a stricter `Cache-Control`

`withSharedBehaviour` sets `Cache-Control: no-store` unless the handler's response already
has a `Cache-Control` that contains `no-store`, in which case that value is kept. A handler
can therefore add directives (`no-transform`) but never weaken `no-store`. Every other
endpoint is unchanged. `X-Request-Id` is set as before.

### 5. Contract and OpenAPI

- `src/lib/openapi/contract.ts` gains a response kind:

  ```ts
  /** A Server-Sent Events stream; each event's `data` is one value of `event`. */
  export interface EventStreamResponseContract {
    description: string;
    eventStream: z.ZodType;
  }
  ```

  `document.ts` writes it as `content: { "text/event-stream": { schema } }`, the schema
  being that of one event, and the description explains the framing (`event:` is the
  type, `data:` the JSON, comments are heartbeats). The schema gets the id `ProjectEvent`
  already set in WS-045.

- `projectEventsContract` (in `src/lib/schemas/events.ts`): `GET
/api/v1/projects/{projectId}/events`, `tasks:read`, responses `200` (event stream),
  `404` (no such project), `429` (too many streams, code `too_many_streams`). `401` and
  `403` are added automatically for a non-public operation.
- `too_many_streams` joins `PROBLEM_CODES`, `tooManyStreams()` joins
  `src/server/http/errors.ts`, and doc 0004 section 4 names it next to `invalid_link`.

### 6. Operator note

`README.md` gains a short "Running in production" paragraph: Opanel must run as a
long-lived Node.js server (`next start`), not serverless; a reverse proxy in front must not
buffer `/api/v1/projects/*/events` (`X-Accel-Buffering: no` is sent for nginx) and must
let a response stay open far longer than the 25-second heartbeat.

## Files

| Path                                                                   | Change                                                |
| ---------------------------------------------------------------------- | ----------------------------------------------------- |
| `src/server/http/event-stream.ts`                                      | create                                                |
| `src/server/http/event-stream.integration.test.ts`                     | create (real database and hub, tests first)           |
| `src/app/api/v1/projects/[projectId]/events/route.ts`                  | create                                                |
| `src/app/api/v1/projects/[projectId]/events/route.integration.test.ts` | create (tests first)                                  |
| `src/server/http/route.ts` (+ `route.test.ts`)                         | modify: keep a stricter `Cache-Control` (tests first) |
| `src/lib/openapi/contract.ts`, `document.ts` (+ `document.test.ts`)    | modify: the stream response kind (tests first)        |
| `src/lib/openapi/contracts.ts`                                         | modify: register the contract                         |
| `src/lib/schemas/events.ts` (+ `events.test.ts`)                       | modify: `projectEventsContract`                       |
| `src/lib/schemas/problem.ts`, `src/server/http/errors.ts` (+ tests)    | modify: `too_many_streams`                            |
| `tests/e2e/events.spec.ts`                                             | create (through `next start`)                         |
| `docs/api/openapi.json`                                                | regenerated                                           |
| `README.md`, `docs/canonical/0004-api-conventions.md`                  | modify: operator note; the new code                   |
| `docs/README.md`, WT-04, WI-047, WS-047                                | modify: statuses                                      |

No new dependency, no migration.

## Data model changes

None.

## API contract

`GET /api/v1/projects/{projectId}/events` (id or key), permission `tasks:read`:

- `200` `text/event-stream`: frames `event: <type>` / `data: <ProjectEvent JSON>`;
  comments `: connected` and `: heartbeat`; `retry: 3000`;
- `401` without valid credentials; `403` without `tasks:read`; `404` unknown project;
  `429 too_many_streams` with `Retry-After` at the 11th stream of an account in a process.

## Test plan (written first, in this order)

Integration tests read the response body with its reader and split it into frames. Each
test cancels its streams and ends with `closeEventHub()`.

| #   | Level       | Test                                                                                                                                                                                                              | Covers criterion |
| --- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit        | `route()`: a handler's `Cache-Control: no-store, no-transform` is kept; a handler's `public, max-age=60` is replaced by `no-store`; no `Cache-Control` gives `no-store`                                           | headers          |
| 2   | unit        | the OpenAPI document: the operation's `200` is `text/event-stream` with the `ProjectEvent` schema; `429` is a problem; the document validates                                                                     | OpenAPI          |
| 3   | unit        | `PROBLEM_CODES` holds `too_many_streams`; `tooManyStreams()` is a `429` with that code                                                                                                                            | code             |
| 4   | integration | route: `401` without a session; `404` for an unknown project; the contract declares `tasks:read` (the guard-rail test covers it); a Viewer may open a stream                                                      | access           |
| 5   | integration | route: `200` with `text/event-stream`, `Cache-Control: no-store, no-transform`, `X-Accel-Buffering: no`, an `X-Request-Id`; the first frame holds `retry: 3000`                                                   | headers          |
| 6   | integration | route: a task created by a service after the response arrives is received as `event: task.created` with data equal to the published event; a task of another project is not received                              | delivery         |
| 7   | integration | route: an account's 11th stream is `429 too_many_streams` with `Retry-After`; another account is not affected; after one stream is cancelled, a new one opens; after one is aborted through `request.signal`, too | cap              |
| 8   | integration | helper, `heartbeatMs` 50: heartbeats arrive; after the session row is deleted, the stream ends at the next heartbeat; the same after the account is deactivated                                                   | re-check         |
| 9   | integration | helper with an `authenticate` that returns an actor without `tasks:read`: the stream ends at the next heartbeat                                                                                                   | re-check         |
| 10  | integration | helper: when the hub resets (`pg_terminate_backend` on `opanel-events`), the stream ends and its place is freed                                                                                                   | reset            |
| 11  | integration | helper: a stream that nobody reads, sent events until its queue passes 64 KiB, is closed and its place freed                                                                                                      | backpressure     |
| 12  | integration | helper: when the hub cannot subscribe (a hub whose `subscribe` rejects), the error is thrown and the place is given back                                                                                          | failure          |
| 13  | e2e         | through `next start`: a signed-in page opens an `EventSource`; a task created through the API arrives within 5 seconds; the response is not gzip-encoded                                                          | no buffering     |
| 14  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm db:generate` leaves no diff; `pnpm openapi:generate` adds only the new operation and code                                                          | gate             |

## Risks and open questions

For the owner:

1. **`route()` keeps a stricter `Cache-Control`** (section 4) instead of the events route
   bypassing `route()`. Every endpoint, this one included, still goes through the same
   authentication and permission checks. **Recommend: as proposed.**
2. **`Retry-After: 30` on `429`**, and **`retry: 3000`** (the browser's reconnection delay)
   on the stream. **Recommend: as proposed.**
3. **A failed subscription answers `500 internal_error`**, the generic answer for an
   unexpected failure, rather than a new `503` code; the browser retries after `retry`.
   **Recommend: as proposed.**
4. **The 403 path cannot be reached by a human today**: every human role holds
   `tasks:read`. It is covered by the declaration (guard-rail test) and by test 9, and
   becomes reachable with agent scopes in WT-05. **Recommend: accept.**
5. **The cap counts per process and is lost on hot reload** in development (a module-level
   map). The deployment of v1 is one process. **Recommend: accept.**
