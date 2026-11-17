# WT-04 — Real-time board sync

- Status: Approved (approved by the owner on 2026-11-16, with every proposal as drafted).
  Amendment A1 (the optional `SETUP_TOKEN`, decision 13 and WI-050) approved by the owner
  on 2026-11-17 as proposed.
- Canonical docs: [0002](../canonical/0002-realtime-sync.md) (the design; amended by this
  track, see decision 1), [0004](../canonical/0004-api-conventions.md) (errors, ids,
  OpenAPI), [0003](../canonical/0003-task-management.md) (section 10: the end of this
  track is the first usable release for a human-only team); for amendment A1,
  [WS-016](../work-specs/WS-016-first-run-setup.md) (question 1) and
  [WS-043](../work-specs/WS-043-setup-refuses-before-hashing.md) (question 2)

## Goal

Several people work the same project at the same time and see each other's changes without
reloading: a card moved, created, edited, deleted or restored in one browser appears in
every other browser showing that board, and so does a task created through the API. The
task detail, the epics page and the project settings follow the same events. Every write
announces itself through PostgreSQL `NOTIFY` in its own transaction, and nothing is ever
announced for a change that was rolled back.

## Starting point

WT-03 left the ground ready (WT-03 decisions 6 and 7):

- Every write runs in one `db.transaction` in its service (`tasks`, `comments`, `columns`,
  `epics`, `projects`), so a `pg_notify` added there is delivered on commit only.
- Tasks, columns, epics and projects carry `version`; a stale write gets
  `409 version_conflict`. Moving has its own endpoint, so `task.moved` is separate from
  `task.updated`.
- `comments.ts` marks the place where this track adds `comment.created`.
- The board (`src/components/board/use-board.ts`) can already reload itself whole, which
  is what a client does after a reconnect.
- The task detail tells the board behind it about its own saves through two window events
  (`src/components/task/events.ts`, WS-038 question 5), "until WT-04".
- The Content Security Policy allows `connect-src 'self'`, which covers an `EventSource`
  to the app's own origin. `src/proxy.ts` passes `/api/` requests through untouched.
- The database client is `postgres` (postgres.js) 4.1.1, whose `sql.listen` holds its own
  connection outside the query pool, as doc 0002 section 5 requires. The work-spec of
  WI-046 confirms this against the installed version's documentation (hard rule 13).

## In scope

- The event contract as Zod schemas in `src/lib/schemas/events.ts`, shared by the server,
  the UI and the OpenAPI document.
- One helper that services call inside their transaction to publish an event with
  `pg_notify`, and a call to it from every write of WT-03 that a board, a task detail, the
  epics page or the project settings shows.
- The event hub: one dedicated `LISTEN` connection per app process, fan-out to the open
  streams of each project, reconnection with backoff.
- `GET /api/v1/projects/{projectId}/events` (`text/event-stream`), with its permission
  check, heartbeat, per-account cap, and its entry in the OpenAPI document.
- The client: one hook that opens the stream, reconnects, and reloads after a reconnect;
  the board, the task detail, the epics page and the project settings using it.
- End-to-end tests with two browser contexts (doc 0002 section 7).
- A short operator note in `README.md`: the app needs a long-lived Node.js server, and a
  reverse proxy must not buffer `/api/v1/projects/*/events`.
- **Amendment A1:** the optional `SETUP_TOKEN` for the first-run setup (decision 13,
  WI-050). It is not about sync: it joins this track because the end of WT-04 is the first
  usable release, and the owner decided on 2026-11-16 (WS-043, question 2) that it must be
  done before then.

## Out of scope

- Everything in doc 0002 section 6: presence, live cursors, typing indicators,
  co-editing of one description, offline editing, replay of missed events.
- Live updates outside a project: the projects list, the teams page, the people page and
  the profile. A renamed team or person shows on cards after a reload.
- Agent tokens on the events endpoint. The endpoint checks the `tasks:read` permission
  through `route()`; it accepts whatever `authenticate()` accepts, so agent tokens work
  there as soon as WT-05 adds them, with no change in this track.
- Notifications to people (AGENTS.md section 1: none in v1).
- Production deployment (Dockerfile, reverse proxy configuration): still a planning gap in
  `docs/README.md`; this track only documents the two requirements above, and how to set
  `SETUP_TOKEN` (decision 13).

## Design decisions

Choices the canonical doc leaves open. Each is detailed in the work-spec of the item that
implements it. The owner approved all of them as proposed on 2026-11-16.

1. **Amendment to doc 0002 section 3 (event types and payload).** The seven event types of
   doc 0002 do not cover two things WT-03 built, and one event lacks what a client needs:
   - **`task.restored`** is added. A restored task must reappear on open boards
     (WI-032). Reusing `task.created` would hide from clients that the key is old.
   - **`project.changed`** is added, for a rename, an archive and an unarchive. A board
     open on a project that another person archives must become read-only, as it does
     after a reload (WS-037).
   - **Every event carries `projectId`**, and **`comment.created` also carries `taskId`**.
     A thin event with only the comment's id would force the task detail to fetch every
     comment it has not seen to find out whether it is concerned.
   - **`version` is `null`** for events about entities without one (comments).
     The amendment is written into doc 0002 by WI-045, after the owner approves it here.

   The resulting list: `task.created`, `task.updated`, `task.moved`, `task.deleted`,
   `task.restored`, `comment.created`, `column.changed`, `epic.changed`,
   `project.changed`.

2. **Which write sends which event.** One event per write, sent from the service, inside
   its transaction, after the write and its history event or audit entry:

   | Service operation                               | Event             |
   | ----------------------------------------------- | ----------------- |
   | create task                                     | `task.created`    |
   | update task (fields, assignment, epic)          | `task.updated`    |
   | move task                                       | `task.moved`      |
   | delete task                                     | `task.deleted`    |
   | restore task                                    | `task.restored`   |
   | create comment                                  | `comment.created` |
   | create, update, move or delete column           | `column.changed`  |
   | create or update epic (including close, reopen) | `epic.changed`    |
   | update, archive or unarchive project            | `project.changed` |

   Creating a project sends nothing: no board of it can be open yet. The event follows the
   write, not the history: an update in which no field differs still bumps `version`
   (WS-030), and a move within one column records no `moved` history event (WS-031), yet
   both send their event, or other browsers would keep a stale `version` or order.

3. **One channel, routed by project.** All events go to one channel, `opanel_events`. The
   payload is the event as JSON, well under `NOTIFY`'s 8 000-byte limit. The hub parses it
   with the Zod schema and hands it to the streams of its `projectId`; a payload that does
   not parse is dropped and logged without its content. Each event has its own `id`, so
   PostgreSQL never merges two of them (it drops identical payloads sent in one
   transaction).

4. **Own echo is recognised by `version`, not by actor.** Doc 0002 says a browser "ignores
   its own echo". Ignoring by `actorAccountId` would hide a change made by the same person
   in another tab. Instead, a client ignores a task, column, epic or project event whose
   `version` is not newer than what it holds; any other event makes it refetch. This is
   written into doc 0002 with the amendment of decision 1.

5. **The hub loses nothing silently.** When the `LISTEN` connection drops, events can be
   missed. When it is back, the hub closes every open stream of the process; the browsers
   reconnect and reload, which is what doc 0002 section 4 already prescribes after any
   reconnect. The hub lives on `globalThis` like the database client, so hot reload in
   development does not open a second `LISTEN` connection.

6. **The stream re-checks the session.** A stream can stay open for hours, longer than the
   session that opened it, and after the account is deactivated. On every heartbeat
   (every 25 seconds, doc 0002 section 3) the endpoint authenticates the request's
   credentials again and closes the stream if they are no longer valid or the account no
   longer holds `tasks:read`. Events carry only identifiers, and every refetch goes through
   the normal permission checks, so this bounds what a revoked session can learn to ids
   for at most 25 seconds. Alternative considered: a fixed stream lifetime; rejected
   because every expiry would reload whole boards.

7. **A per-account cap of 10 concurrent streams per app process.** The 11th request gets
   `429` with code `too_many_streams`, as a problem-details response (doc 0004). Ten covers
   a person with several tabs and windows. The cap is per process, which matches the
   single-process deployment of v1; it is not shared between processes.

8. **A slow client is dropped, not buffered.** If a stream's buffer is full when an event
   arrives, the server closes that stream instead of queueing for it; the browser
   reconnects and reloads. Memory per stream stays bounded.

9. **The window events of WS-038 stay.** They tell the board about a save in the same tab
   at once, without waiting for the round trip through PostgreSQL. The event that follows
   carries the same `version` and is ignored by decision 4. The comment in
   `src/components/task/events.ts` is updated to say they are no longer temporary.

10. **A task detail with unsaved changes is not overwritten.** When another person changes
    the task that is open, the task detail refetches it. Fields the viewer is not editing
    are updated; if they are editing one, they are told that the task changed and the
    next save gets the `409 version_conflict` it already handles (WS-038). Comments are
    appended as they arrive.

11. **After a reconnect the client reloads what it shows.** The board reloads columns and
    every task; the task detail reloads the task and its comments; the other pages reload
    their list. No `Last-Event-ID` is sent or honoured: no event log is stored in v1 (doc
    0002 section 4).

12. **The endpoint is documented in the OpenAPI document** with the
    `text/event-stream` media type and the event schemas of decision 1, generated from Zod
    like every other contract (hard rule 9). How `zod-openapi` 6.0.2 describes a stream is
    settled in the work-spec of WI-047.

13. **Amendment A1 (approved on 2026-11-17): an optional `SETUP_TOKEN` guards the
    first-run setup.** Today whoever first reaches `/setup` on a fresh install becomes its
    Admin (WS-016 decision 4, question 1); WI-043 closed only the hashing on an installed
    server. Proposed behaviour:
    - `SETUP_TOKEN` is a new optional environment variable, validated in
      `src/server/env.ts` like the others: when set, at least 32 characters; when unset or
      empty, nothing changes, so development and the end-to-end tests are unaffected.
      `.env.example` and `README.md` tell the operator to set it, for example with
      `openssl rand -hex 32`, on any install reachable by others before setup.
    - When it is set, the setup page shows one more field, "Setup token", and
      `POST /api/v1/setup` requires it as `setupToken` in the body. The request schema
      gains an optional field, an additive change to `/api/v1` (hard rule 9; no new
      version needed). The page learns whether the token is required from the service, as
      it already learns whether setup is needed (WS-016, question 2).
    - Order of checks in `createFirstAdmin`: an installed server answers `404` first
      (WI-043); then the token; only then the password is hashed. A missing or wrong token
      answers `403` with code `invalid_setup_token`, the same for both, and nothing is
      hashed or written.
    - The comparison is in constant time (`crypto.timingSafeEqual` over the SHA-256
      digests of both values, so lengths never differ). The token is never logged, put in
      the audit entry, or returned (hard rule 7).
    - No rate limiter: a 32-character random token cannot be guessed, and each refusal
      costs a hash of a short string, not an Argon2id hash.
    - After setup the token has no further use; the operator may remove it.

## Work-items

Each item leaves the repository green and is one branch/PR. Numbers start at WI-045:
WI-042 and WI-043, the remaining audit items, are done first (`docs/README.md`).

| Item                                          | Title                                                                                                                | Status   | Depends on |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------- | ---------- |
| WI-045                                        | Event contract and publishing: Zod schemas, doc 0002 amendment, `pg_notify` from every write of decision 2           | Draft    | none       |
| WI-046                                        | Event hub: dedicated `LISTEN` connection, fan-out by project, reconnect and close-all                                | Draft    | WI-045     |
| WI-047                                        | Events endpoint: `GET /api/v1/projects/{projectId}/events`, heartbeat, session re-check, cap, OpenAPI, operator note | Draft    | WI-046     |
| WI-048                                        | Live board: the client hook, every event applied to the board, reload after a reconnect                              | Draft    | WI-047     |
| WI-049                                        | Live task detail, epics page and project settings                                                                    | Draft    | WI-048     |
| [WI-050](../work-items/WI-050-setup-token.md) | Optional `SETUP_TOKEN` for the first-run setup (amendment A1, decision 13)                                           | Approved | none       |

As in earlier tracks, each item gets its work-item and work-spec files just before it is
started, and each work-spec needs the owner's approval. WI-050 is independent of the sync
items and is proposed to be done first: it is small, and it closes a security gap that
exists today.

Test plan by item, from doc 0002 section 7:

- **WI-045** — integration, real PostgreSQL: each operation of decision 2 sends exactly
  one notification of the right type after commit, none after a rollback (including a
  rollback caused by a failing history or audit write); an update that changes no field
  and a move within one column send theirs too. Unit: the event schemas.
- **WI-046** — unit: fan-out to the right project only, unsubscribe, a malformed payload
  dropped. Integration: a notification sent by another connection reaches a subscriber;
  after the `LISTEN` connection is terminated (`pg_terminate_backend`), it comes back and
  open subscribers are closed.
- **WI-047** — integration: `401` without a session, `403` without `tasks:read`, `404` for
  an unknown project, `429 too_many_streams` at the 11th stream; an event written by a
  service arrives on an open stream with the right fields; heartbeats are sent; a stream
  whose session is revoked closes at the next heartbeat; closing the request frees its
  place in the cap. The OpenAPI document validates.
- **WI-048** — E2E with two browser contexts: a card moved in one appears moved in the
  other without a reload; a task created through the API appears on an open board; a
  deleted and then restored task disappears and reappears; a column added in settings
  appears; an archive makes the other board read-only. Unit: the version rule of
  decision 4.
- **WI-049** — E2E with two browser contexts: a comment and a field change appear in an
  open task detail; editing a field while it changes elsewhere shows the notice of
  decision 10; an epic created or closed appears on the epics page; a column renamed
  appears in the other project settings.
- **WI-050** — unit: `SETUP_TOKEN` validation (unset, empty, too short, valid); the form
  shows the field only when required. Integration, real PostgreSQL: with a token set, a
  missing and a wrong token each answer `403 invalid_setup_token`, create no account and
  compute no Argon2id hash; the right token creates the Admin; an installed server still
  answers `404` before the token is looked at; without a token set, setup is unchanged;
  the token appears in no log line, audit entry or response. The OpenAPI document shows
  the new optional field.

## Exit criteria

- [ ] A card moved, created, edited, deleted or restored in one browser shows the change
      in a second browser on the same board within a second, without a reload.
- [ ] A task created through the API appears on an open board.
- [ ] An open task detail shows new comments and other people's field changes, and never
      discards what its viewer is typing.
- [ ] Every write of decision 2 sends exactly one event after commit and none after a
      rollback, tested on the real database.
- [ ] After the stream or the `LISTEN` connection drops, an open board reconnects and
      shows the current state.
- [ ] The events endpoint refuses without a session (`401`), without `tasks:read`
      (`403`) and beyond the cap (`429 too_many_streams`); a revoked session's stream
      closes within one heartbeat.
- [ ] Doc 0002 lists the event types and payload of decision 1 and the echo rule of
      decision 4.
- [ ] With `SETUP_TOKEN` set, a fresh install cannot be claimed without it
      (`403 invalid_setup_token`, nothing hashed or written); without it, setup is
      unchanged (amendment A1).
- [ ] The full quality gate passes on `main`, with `pnpm db:generate` and
      `pnpm openapi:generate` leaving no diff.

## Risks and open questions

Questions 1 to 3 were resolved by the owner on 2026-11-16, and question 7 on 2026-11-17, by
approving the proposals.

1. **Resolved: the amendment to doc 0002** (decision 1): `task.restored`, `project.changed`,
   `projectId` on every event, `taskId` on `comment.created`, `version: null` for
   comments. Doc 0002 is Approved, so this needs the owner's explicit yes.
2. **Resolved: the cap** (decision 7): 10 streams per account per process, `429 too_many_streams`.
3. **Resolved: session re-check on every heartbeat** (decision 6), one authentication query per open
   stream every 25 seconds. At the scale of a self-hosted install this is negligible;
   the alternative is a fixed stream lifetime.
4. **Risk, buffering on the way to the browser.** Next.js compression or a reverse proxy
   may hold back a stream until it closes. WI-047 checks delivery against `next start`
   (the end-to-end server), not only the development server, and reads the installed
   Next.js documentation on streaming route handlers first (hard rule 13).
5. **Risk, large boards on reconnect.** Every reconnect reloads the whole board.
   WS-037 measured a board of 1 000 tasks at under 2 s locally; acceptable until WT-07
   moves unscheduled work to the backlog. A restart of the app reconnects every open
   board at once.
6. **Risk, parallel end-to-end tests.** Playwright runs tests in parallel on one
   database. Events are routed by project and every test creates its own project, so tests
   cannot see each other's events; WI-048 keeps it that way.
7. **Resolved: amendment A1** (decision 13, WI-050): the `SETUP_TOKEN` behaviour as
   proposed: optional, at least 32 characters, `403 invalid_setup_token` for a missing or
   wrong token, checked after the `404` of an installed server and before hashing, and done
   first in the track. Alternative not taken: a one-time token printed in the server log at start-up
   when the install is empty, because it puts a secret in the log (hard
   rule 7) and changes at every restart.
