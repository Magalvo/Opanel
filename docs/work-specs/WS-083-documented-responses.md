# WS-083 — Every response the API sends is documented

- Status: Proposed
- Work-item: [WI-083](../work-items/WI-083-documented-responses.md)
- Canonical docs: [0004](../canonical/0004-api-conventions.md) sections 3 to 6;
  audit of 2026-11-19, findings B05 and B14

## Approach

Each gap is closed where the document is built, so a later contract gets it right without
remembering to.

### 1. `429` on every operation that accepts a token

`route()` authenticates, then for a token caller hits the per-token limiter before any
other check (`route.ts:155-161`): even an operation whose own `429` is something else can
answer `rate_limited`. `toOperation` (`document.ts:77-120`) already decides who may call:
`security` lists `bearerAuth` unless the access kind is `public` or `session`
(`document.ts:102-106`). The same condition adds a `TOKEN_RESPONSES` entry beside
`CREDENTIAL_RESPONSES`:

```ts
429: { description: "The API token made too many requests (code `rate_limited`).", problem: true },
```

A contract's own `429` still wins, as its `401` and `403` do (`contract.ts:92-96`), but on
a token operation `toOperation` appends the token sentence to its description instead of
dropping it. Today only the event stream is affected (`too_many_streams`,
`schemas/events.ts:117-123`).

`Retry-After`: all three `429` codes set it (`errors.ts:216`, `:227`, `:238`;
`route.ts:76-78`), yet it appears only in prose. `toResponse` gains the status: every `429`
response gets `headers: { "Retry-After": { schema: z.int().min(1) } }`, described as the
whole seconds to wait. The installed zod-openapi 6.0.2 accepts Zod schemas in a response's
`headers` (`ZodOpenApiResponseObject`, `lib/components-CHDAxPEZ.d.mts:478-481`). This also
covers the public and session `429 server_busy` of `schemas/auth.ts:137`, `:214`, `:243`,
`:290`.

Session-only operations (sign-out, `PATCH /me`, `POST /me/password`) do not gain
`rate_limited`: their `security` names no token, and a token there is already the
documented `403` (question 4).

### 2. `400` on the event stream

`readParams(context.params, projectParamsSchema)` (`events/route.ts:15`) throws `400` for a
reference that is neither a uuid nor a key (`schemas/projects.ts:76-80`). `BAD_PATH` is a
module-local constant of `schemas/projects.ts:85`; it moves to `lib/openapi/responses.ts`,
next to `PAYLOAD_TOO_LARGE`, and both files import it. The 17 inline copies elsewhere are
identical text and stay as they are (no document change, smaller diff).

### 3. Every `409` of the operations that check `version`

Six contracts use `versionConflictResponse(entity)` (`responses.ts:6-13`). Sized from the
services, each can also answer:

| Operation                       | Contract          | Other `409` codes                      | Thrown at                                                 |
| ------------------------------- | ----------------- | -------------------------------------- | --------------------------------------------------------- |
| `PATCH /projects/{projectId}`   | `projects.ts:142` | `project_archived`                     | `services/projects.ts:270`                                |
| `PATCH /columns/{columnId}`     | `columns.ts:127`  | `project_archived`, `last_done_column` | `columns.ts:98` (via `projects.ts:103`), `columns.ts:230` |
| `POST /columns/{columnId}/move` | `columns.ts:144`  | `project_archived`                     | `columns.ts:98`                                           |
| `PATCH /tasks/{taskId}`         | `tasks.ts:222`    | `project_archived`, `account_inactive` | `tasks.ts:370`, `tasks.ts:394` (via `:195`)               |
| `POST /tasks/{taskId}/move`     | `tasks.ts:241`    | `project_archived`                     | `tasks.ts:447`                                            |
| `PATCH /epics/{epicId}`         | `epics.ts:172`    | `project_archived`                     | `epics.ts:200`                                            |

It is small, so the README follow-up is folded in. `versionConflictResponse` gains a
second, required argument, the other codes (`readonly ProblemCode[]`, may be empty), and
`VersionConflictResponseContract` carries them. When the list is not empty, `toResponse`
documents the schema as `z.union([<Entity>VersionConflict, problemSchema])`, which
zod-openapi writes as `anyOf`, and the description names each code. `anyOf`, not `oneOf`:
a version-conflict body also matches `Problem` (its `code` enum includes `version_conflict`,
`current` is optional, `problem.ts:26`, `:66`), so `oneOf` would reject the very body it
documents. Making the argument required means a new versioned contract must state its
other conflicts, even if none.

### 4. Unknown query parameters (owner question 1)

`readQuery` (`route.ts:327-338`) validates against a strict schema, but only the eight
paginated lists call it. Every other operation, including `GET /me`, get-by-id, `PATCH`,
`DELETE`, the action `POST`s, the columns list, the tokens list and the event stream,
ignores the query string, contrary to doc 0004 section 3 (lines 45-47). Hard rule 11: the
owner picks.

- **Option A, enforce (recommended).** In `route()`, after the access checks and before the
  handler: when `contract.request?.query` is undefined and the URL has any search
  parameter, throw `invalidRequest` with one `{ path: <name>, message: "Unknown field" }`
  per name, detail "The query string is not valid." (the message `fieldErrors` already uses
  for unknown keys, `route.ts:221-226`). Every such contract gains `400` if it lacks one;
  a test checks it: health, the OpenAPI document, sign-out and `GET /me` lack one today
  (the event stream gains it in section 2). Public operations are included: the doc makes
  no exception for them. Operations that declare a query keep validating it in the handler.
  First-party callers send no query to these operations (checked: the only `?` in
  `src/components` and `src/hooks` is on list calls; `use-project-events.ts:45` opens the
  stream URL as given, and `EventSource` adds no query on reconnect, only
  `Last-Event-ID`). The red step also greps `mcp/` and `tests/e2e/`. Risk: a third-party
  client or proxy that adds a cache-buster (`?_=…`) starts failing. Doc 0004 already
  promised the error, so this keeps a documented contract rather than changing it.
- **Option B, relax the doc.** Doc 0004 section 3 becomes "query strings of operations
  that take query parameters are validated strictly; other operations ignore the query
  string". No code change.

### 5. Doc fixes that belong with the contract

- **Doc 0004 section 4** (lines 115-128): the run-on list of specific codes becomes a
  table, status, code, meaning, work-spec, for every code of `PROBLEM_CODES`
  (`problem.ts:8-35`) beyond the base nine, adding the WT-03 codes it omits:
  `team_name_taken` and `account_inactive` (WS-026), `project_key_taken` and
  `project_archived` (WS-028), `last_done_column` (WS-029), `team_in_use` and
  `column_not_empty` (WS-030). A unit test keeps the table and `PROBLEM_CODES` equal.
- **Doc 0004 section 5**: the example (line 144) becomes `GET /api/v1/projects?limit=50&
cursor=eyJ...`; the name-ordered lists (lines 161-162) become people, teams, projects
  and agents by name, and epics by title (`services/people.ts:54`, `teams.ts:96`,
  `projects.ts:177`, `agents.ts:185`, `epics.ts:103`).
- **Doc 0004 section 6** (lines 175-176): "a `POST` that creates returns `201`; a `POST`
  that acts on an existing resource (archive, unarchive, move, restore, adding a team
  member) returns `200` with it". `POST /teams/{teamId}/members` answers `200` with the
  team (`schemas/teams.ts:154`), since adding an existing member changes nothing; it stays
  (question 3).
- **`docs/agents.md`**: the errors table (lines 94-104) gains `409 account_inactive` ("the
  person you assign is deactivated") and `429 too_many_streams` ("close a stream; wait the
  `Retry-After` seconds"); "Live updates" (lines 125-135) gains a bullet: at most 10 open
  streams per account and app process (`event-stream.ts:25`, `:58`).

## Files

| Path                                                            | Change                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------ |
| `src/lib/openapi/document.ts`                                   | modify: `TOKEN_RESPONSES`, `Retry-After`, conflict union     |
| `src/lib/openapi/contract.ts`                                   | modify: `otherCodes` on the conflict contract, doc comment   |
| `src/lib/openapi/responses.ts`                                  | modify: `versionConflictResponse(entity, codes)`, `BAD_PATH` |
| `src/lib/schemas/{projects,columns,tasks,epics}.ts`             | modify: the six conflict responses; `BAD_PATH` import        |
| `src/lib/schemas/events.ts`                                     | modify: `400: BAD_PATH`                                      |
| `src/lib/openapi/document.test.ts`, `routes.test.ts`            | modify: tests first                                          |
| `src/server/http/route.ts`, `route.test.ts`                     | option A only: the query check, tests first                  |
| `src/lib/schemas/{health,openapi,auth,events}.ts`               | option A only: `400` on the 4 that lack it                   |
| `docs/canonical/0004-api-conventions.md`, `docs/agents.md`      | modify: section 5 of this spec                               |
| `scripts/api-conventions.test.ts` (like `agents-guide.test.ts`) | create: the error-code table check                           |
| `docs/api/openapi.json`                                         | regenerate (`pnpm openapi:generate`)                         |
| `docs/README.md`, WI-083, WS-083                                | modify: statuses; resolve the `409` follow-up and B14        |

## Data model changes

None.

## API contract

Documentation only, unless option A: 46 operations gain `429`; every `429` declares
`Retry-After`; the event stream gains `400`; six `409`s become `anyOf` the version conflict
and `Problem`. These are additions, not breaking changes (doc 0004 section 8). Under option
A, a request with an undeclared query parameter becomes `400 invalid_request`.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                                                       | Covers criterion   |
| --- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 1   | unit        | `document.test.ts`, fake contracts: an `authenticated` and a `permission` operation gain `429` with code `rate_limited`; a `public` and a `session` one do not (fails before). The "adds 401 and 403" key list gains `429` | `429` on token ops |
| 2   | unit        | a fake token operation with its own `429` keeps its description and gains the token sentence                                                                                                                               | own `429` kept     |
| 3   | unit        | real document: every operation whose `security` lists `bearerAuth` has `429`; none without it has `rate_limited` in its `429`                                                                                              | `429` on token ops |
| 4   | unit        | real document: every `429`, including `server_busy` on sign-in, declares `Retry-After` as an integer of at least 1                                                                                                         | `Retry-After`      |
| 5   | unit        | real document: `GET /projects/{projectId}/events` documents `400` as `Problem` (fails before)                                                                                                                              | events `400`       |
| 6   | integration | route: `GET /api/v1/projects/not%20a%20key/events` is `400` with `invalid_request` (pins the behaviour now documented)                                                                                                     | events `400`       |
| 7   | unit        | fake contract with other codes: the `409` schema is `anyOf` `<Entity>VersionConflict` and `Problem`, and names each code; with none it stays the single `$ref`                                                             | `409` union        |
| 8   | unit        | real document: the six versioned operations list the codes of the table in section 3; a `project_archived` body and a `version_conflict` body both validate against `PATCH /tasks/{taskId}`'s `409` (fails before)         | `409` union        |
| 9   | unit        | option A, `route.test.ts`: a contract without a query and `?x=1&y=2` is `400`, `errors` `x` and `y`; no query string, or an empty `?`, passes; a contract with a query is untouched; the check runs after `401`/`403`      | unknown query      |
| 10  | unit        | option A, `routes.test.ts`: every contract without `request.query` documents `400`                                                                                                                                         | unknown query      |
| 11  | integration | option A: `GET /api/v1/me?x=1` with a token is `400`; the existing event-stream integration tests still open the stream                                                                                                    | unknown query      |
| 12  | unit        | doc check: doc 0004 section 4's table lists exactly `PROBLEM_CODES`; `scripts/agents-guide.test.ts` stays green with the new rows                                                                                          | doc fixes          |
| 13  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm openapi:generate` committed; "matches the committed docs/api/openapi.json" passes                                                                           | gate               |

## Risks and open questions

For the owner:

1. **Unknown query parameters (hard rule 11).** Doc 0004 section 3 and the code disagree
   on 46 operations. **Recommend: option A, enforce in `route()`.** No first-party client
   is affected, it matches the "fail loudly" reason the doc gives, and a typo such as
   `GET /api/v1/tasks/OPA-1?fields=…` stops being silently ignored. Choose option B if
   third-party clients that add cache-busting parameters must keep working.
2. **Fold the `409` follow-up into this item.** Six contracts, one helper, no behaviour
   change. **Recommend: fold it in, with `anyOf` and a required list of other codes.**
3. **`POST /teams/{teamId}/members` keeps `200`.** It returns the team, not a created
   membership, and is idempotent. **Recommend: keep it, and state the rule for action
   `POST`s in doc 0004 section 6 instead of listing an exception.**
4. **No `rate_limited` on session-only operations.** A token is refused there with `403`
   but counted first, so an over-limit token gets `429`. **Recommend: leave it
   undocumented;** the token is not a credential those operations accept.
5. **`BAD_PATH` moves to `responses.ts`** and only the event stream and projects use it;
   replacing the 17 identical inline copies is left out. **Recommend: as proposed.**

## Deviations from the approved spec

None yet.
