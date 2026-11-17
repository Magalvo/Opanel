# WI-051 — Creation-time cursors are checked as dates

- Status: Done
- Work-track: none: a hardening item from the audit of 2026-11-17 (finding A08)
- Depends on: none
- Work-spec: [WS-051](../work-specs/WS-051-cursor-date-validation.md)

## Outcome

A creation-time cursor (`decodeCursor`, canonical doc 0004 section 5) carries its timestamp
as text with six fractional digits. Today it is checked only for the layout of its digits,
so a tampered cursor such as `2026-99-99T25:61:61.000000Z` passes, is cast to `timestamptz`
by the query and fails in PostgreSQL: the caller gets `500` instead of the documented `400`,
and the server logs an error. After this item every cursor whose timestamp is not a real
instant that PostgreSQL accepts is refused with `400` naming `cursor`, before any query runs.

Two endpoints use this cursor: `GET /api/v1/accounts` and
`GET /api/v1/tasks/{taskId}/comments`.

## Acceptance criteria

- [x] An impossible month, day, hour, minute or second, 29 February of a non-leap year, and
      year `0000` are a `400` with `{ path: "cursor", message: "Invalid cursor." }`.
- [x] A timestamp without exactly six fractional digits, or with an offset other than `Z`,
      is still refused.
- [x] Every cursor the API produces still decodes to the same text, microseconds kept
      (paging has no repeat and no gap, as before).
- [x] `GET /api/v1/accounts` and `GET /api/v1/tasks/{taskId}/comments` answer `400`, not
      `500`, to such a cursor, and log nothing.
- [x] No contract changes; the OpenAPI document does not change.
- [x] The full quality gate passes.

## Notes

Name and board cursors are not affected: they hold no timestamp and are compared as text.
