# 0004 — API conventions

- Status: **Approved** (2026-11-12)
- Date: 2026-11-12
- Supersedes: none
- Relates to: [0001](0001-ai-qa-agents-and-triage.md) (authentication, bug report contract),
  [0002](0002-realtime-sync.md) (events, version conflicts)

## 1. Context

`/api/v1` is the only interface to Opanel: the web UI and external AI agents call the same
endpoints (`AGENTS.md` section 3). So far it has two public endpoints (health, OpenAPI
document) and no shared rules. WT-02 adds the first authenticated endpoints, and every
later work-track adds more. This doc fixes the rules they all follow, so that an agent
author learns them once and work-specs only describe what is specific to an endpoint.

Agreed with the owner in WS-005: this doc is written at the start of WT-02.

## 2. Summary of decisions

| Topic            | Decision                                                                |
| ---------------- | ----------------------------------------------------------------------- |
| Format           | JSON, UTF-8, `camelCase` field names                                    |
| Errors           | RFC 9457 problem details, with a stable machine-readable `code`         |
| Invalid input    | `400` with a per-field list; unknown fields are rejected                |
| Identifiers      | UUID strings, opaque to clients                                         |
| Dates            | ISO 8601 UTC timestamps; calendar dates as `YYYY-MM-DD`                 |
| Lists            | Cursor pagination: `{ "items": [...], "nextCursor": "..." \| null }`    |
| Partial update   | `PATCH`: a missing field is unchanged, `null` clears it                 |
| Concurrency      | `version` in the body, `409` on mismatch (doc 0002)                     |
| Authentication   | Session cookie (humans) or `Authorization: Bearer` (agents), never both |
| Cookie safety    | State-changing cookie requests must come from the app's own origin      |
| Caching          | `Cache-Control: no-store` on every API response                         |
| Tracing          | `X-Request-Id` on every response, repeated in error bodies              |
| Breaking changes | Only in a new version (`/api/v2`); additions are not breaking           |

## 3. Requests and responses

- Bodies are JSON (`Content-Type: application/json`). A body-carrying request with another
  content type is rejected with `415`.
- Field names are `camelCase`. Enum values are lower `snake_case` strings (`in_progress`).
- A successful response for one resource is the resource object itself, not wrapped in an
  envelope. This matches the bug report responses already defined in doc 0001.
- Request bodies and query strings are validated with strict Zod schemas: an unknown field
  or query parameter is an error, not ignored. A typo in a field name therefore fails
  loudly instead of silently doing nothing.
- Responses may gain new fields in v1 at any time. Clients must ignore fields they do not
  know.
- Every response carries `Cache-Control: no-store`.

### Identifiers and time

- Every entity id is a UUID, serialised as a lowercase string. Clients treat ids as opaque.
- Tasks additionally have a human-readable key (`OPA-123`, doc 0003). Endpoints that take
  a task accept either its id or its key.
- Timestamps are ISO 8601 in UTC with a `Z` suffix (`2026-11-12T10:00:00.000Z`). Fields
  that are calendar dates with no time of day (due date) are `YYYY-MM-DD`.

### Status codes

| Code  | Meaning in this API                                                           |
| ----- | ----------------------------------------------------------------------------- |
| `200` | Success with a body                                                           |
| `201` | A resource was created; the body is the resource                              |
| `204` | Success with no body (delete, sign-out)                                       |
| `400` | The request is malformed or fails validation                                  |
| `401` | No valid credentials                                                          |
| `403` | Valid credentials, but the actor lacks the permission or scope                |
| `404` | The resource does not exist                                                   |
| `409` | The request conflicts with current state (stale `version`, duplicate, ...)    |
| `415` | Unsupported request content type                                              |
| `429` | Rate limited; `Retry-After` gives the wait in seconds                         |
| `500` | Unexpected server error; no internal detail is returned                       |
| `503` | Health endpoint only: the database is down (keeps its WS-005 body, unchanged) |

Validation failures use `400`, not `422`, as already written in doc 0001.

## 4. Errors

Every error response, except the health endpoint's `503`, has
`Content-Type: application/problem+json` and this body (RFC 9457):

```jsonc
{
  "type": "about:blank",
  "title": "Bad Request", // the HTTP status phrase
  "status": 400,
  "code": "invalid_request", // stable; this is what clients branch on
  "detail": "The request body is not valid.", // for people; wording may change
  "requestId": "0f8b6c1e-...", // same value as the X-Request-Id header
  "errors": [
    // only on validation failures
    { "path": "title", "message": "Required" },
    { "path": "evidence.http.status", "message": "Must be a whole number" },
  ],
}
```

Base codes:

| Status | `code`                   |
| ------ | ------------------------ |
| `400`  | `invalid_request`        |
| `401`  | `unauthenticated`        |
| `403`  | `forbidden`              |
| `404`  | `not_found`              |
| `409`  | `conflict`               |
| `415`  | `unsupported_media_type` |
| `429`  | `rate_limited`           |
| `500`  | `internal_error`         |

Rules:

- Clients branch on `code` and `status`, never on `title` or `detail`.
- A work-spec may introduce a more specific code for a status (for example
  `version_conflict` for `409`) and extra fields that belong to it (doc 0002 returns the
  current entity with a version conflict, as `current`). Codes are never renamed or reused.
- Error bodies never contain stack traces, SQL, file paths, secrets or the rejected value
  of a secret field (`AGENTS.md` hard rule 7). The unexpected error itself is logged
  server-side with the request id.
- `401` does not say why credentials were rejected (unknown, expired and revoked tokens
  look the same). Sign-in failures do not reveal whether the email exists.
- A path under `/api/` that matches no endpoint returns the `404` problem body, not an
  HTML page.

## 5. Lists and pagination

Every endpoint that returns a collection is paginated the same way:

```
GET /api/v1/tasks?limit=50&cursor=eyJ...
```

```jsonc
{
  "items": [/* resources */],
  "nextCursor": "eyJ...", // null when there are no more
}
```

- `limit`: default 50, maximum 100. Out of range is a `400`.
- `cursor` is an opaque string taken from a previous `nextCursor`. Cursors are keyset
  based, so a list stays correct while rows are inserted, which matters on boards that
  agents write to continuously. There are no page numbers and no total count.
- Each endpoint has one documented default order. Where sorting is offered it is
  `sort=field` (ascending) or `sort=-field` (descending), limited to documented fields.
- Filters are plain query parameters named after the field (`assigneeTeamId=...`). The
  filter set is defined by the work-specs of WT-08.

Small, naturally bounded collections that the UI needs whole (the columns of a project)
may be returned as a full `items` array with `nextCursor: null`; the work-spec says so.

## 6. Writes

- `POST` creates and returns `201` with the resource. `PATCH` partially updates and
  returns `200` with the resource. `DELETE` returns `204`. `PUT` is not used in v1.
- `PATCH` bodies: a field that is absent is left unchanged; a nullable field sent as
  `null` is cleared.
- Entities with optimistic concurrency (doc 0002) expose an integer `version`. An update
  sends the `version` it was based on; a mismatch is a `409` with code `version_conflict`.
- There is no general idempotency-key mechanism in v1. The one endpoint agents retry
  blindly, bug report submission, is idempotent by design through fingerprint dedupe.

## 7. Authentication and permissions

- A request is authenticated by exactly one of: the session cookie (humans) or
  `Authorization: Bearer <token>` (agents), as defined in doc 0001. If an `Authorization`
  header is present, only the token is considered and cookies are ignored.
- Both resolve to an `Actor`. Every endpoint that is not declared public authenticates,
  then checks one named permission before calling a service (`AGENTS.md` hard rule 6).
- **Cross-site request protection.** For cookie-authenticated requests with a method
  other than `GET` or `HEAD`, the `Origin` header must equal the app's own origin;
  otherwise the request is rejected with `403`. Token-authenticated requests are exempt:
  a browser never attaches a bearer token on its own.
- The API sends no CORS headers in v1. Browsers on other origins cannot call it; agents
  and other server-side clients are unaffected.
- Every non-public operation documents `401` and `403` in the OpenAPI document
  automatically; work-specs do not repeat them.
- **Pages** have three layers (WS-017). The proxy (`src/proxy.ts`) redirects a page request
  with no session cookie to the sign-in page; it reads the cookie's presence only and is not
  a security boundary. The `(app)` layout verifies the session with the database
  (`requireAccount()`). Data is protected where it is read: it reaches the browser through
  `/api/v1`, which authenticates every request. A server component that reads data itself
  must call `requireAccount()` and a permission check, because a layout is not re-rendered
  on every navigation.
- An authenticated API route returns the `Set-Cookie` headers that `authenticate` produced
  (it extends a session that is being used), so that using the app keeps the session alive.

## 8. Versioning

- The version is the path prefix. `/api/v1` is the only version.
- Not breaking, allowed within v1: new endpoints, new optional request fields, new
  response fields, new error codes for new situations, new event types.
- Breaking, requires `/api/v2`: removing or renaming a field or endpoint, changing a type,
  making an optional request field required, changing the meaning of a value or code.
- The OpenAPI document generated from the Zod schemas is the contract of record. It is
  never edited by hand (`AGENTS.md` hard rule 9).

Until the first tagged release of Opanel, v1 is still being built and may change between
commits. The breaking-change rule applies from that release on.

## 9. Out of scope (v1)

- GraphQL, batch endpoints, field selection (`?fields=`), response compression rules.
- Webhooks (notifications are out of v1, doc 0001).
- CORS for third-party browser apps.
- A general idempotency-key header.

## 10. Resolved questions

Decided with the owner on 2026-11-12:

1. **Identifier format:** plain UUIDs. The examples in doc 0002, which showed prefixed and
   numeric ids, were illustrations and have been aligned with this doc.
2. **Strict requests:** unknown fields and query parameters are rejected.
