# WI-083 — Every response the API sends is documented

- Status: Approved (2026-11-19)
- Work-track: none: a fix from the audit of 2026-11-19 (finding B05)
- Depends on: none
- Work-spec: [WS-083](../work-specs/WS-083-documented-responses.md)

## Outcome

The OpenAPI document is generated from the contracts, and agents rely on it, but some
answers the API really sends are missing from it:

- `429 rate_limited`: `route()` refuses a token over its per-token limit
  (`route.ts:156-159`), yet the document adds only `401` and `403` to an operation
  (`document.ts:19-23`). 46 of the 54 operations accept a token; none documents it, and
  no `429` documents its `Retry-After` header.
- `400` on `GET /api/v1/projects/{projectId}/events`: the handler validates the path
  (`events/route.ts:15`), the contract lists only `200`, `404` and `429`
  (`schemas/events.ts:106-123`).
- The `409` of the six operations that check `version` is documented as
  `version_conflict` only (for example `schemas/tasks.ts:222`), but they also answer
  `project_archived`, a column `PATCH` `last_done_column` and a task `PATCH`
  `account_inactive`, whose bodies do not match that schema. This folds in the README
  follow-up "Document every `409` of the operations that check `version`".
- Doc 0004 section 3 says an unknown query parameter is an error, but only the eight
  paginated lists check the query string. Owner question 1 chooses which one is right.

The docs that describe the contract are corrected with it (finding B14): doc 0004 sections
4 to 6 and `docs/agents.md`.

## Acceptance criteria

- [ ] Every operation that accepts an API token documents `429` with code `rate_limited`;
      public and session-only operations do not gain it. An operation that already
      documents its own `429` (the event stream) keeps its text and gains the token one.
- [ ] Every `429` in the document declares the `Retry-After` header (integer seconds).
- [ ] `GET /api/v1/projects/{projectId}/events` documents `400` for an invalid path, and
      answers it to a malformed project reference.
- [ ] The `409` of `PATCH` project, column, task and epic, and of `POST` column move and
      task move, documents the version conflict and each other code it can answer; a body
      with `project_archived` validates against it.
- [ ] Unknown query parameters: either `route()` answers `400` naming each one on every
      operation whose contract declares no query (question 1, option A), or doc 0004
      section 3 says that only operations taking query parameters check them (option B).
- [ ] Doc 0004 section 4 lists every specific error code with its status and work-spec;
      section 5's example names a real endpoint and lists every list ordered by name;
      section 6 states which `POST` operations return `200`.
- [ ] `docs/agents.md` lists `409 account_inactive` and `429 too_many_streams`, and "Live
      updates" states the limit of 10 streams per account and app process.
- [ ] `docs/api/openapi.json` is regenerated; the full quality gate passes.

## Notes

No behaviour changes except under question 1, option A. No migration, no new dependency.
