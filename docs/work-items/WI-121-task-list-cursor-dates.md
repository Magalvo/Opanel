# WI-121 — Task list cursors refuse impossible dates

- Status: Done (approved by the owner on 2026-11-24, with WS-121; done on 2026-11-24)
- Work-track: none: follow-up C01 of the independent audit of 2026-11-24, confirmed in the
  code of `main`
- Depends on: none
- Work-spec: [WS-121](../work-specs/WS-121-task-list-cursor-dates.md)

## Outcome

`GET /api/v1/tasks` answers `400 invalid_request` naming `cursor` for any cursor whose
dates are no real instant or calendar date, as every other paged list has since WI-051.
Today the cursor of WI-118 checks a `created`, `updated` or `dueDate` value by its shape
only (`src/server/services/tasks.ts`, `TIMESTAMP` and the due-date key), so a date such as
`2026-02-30`, a month 13 or an hour 25 reaches a PostgreSQL cast, which raises, and the
API answers `500 internal_error`. A timestamp in the year `0000` gets through the same way.

## Acceptance criteria

- [x] A `created` or `updated` cursor (either direction) whose value is not a real instant
      (February 30, month 13, day 32, hour 24 or 25, minute or second 60, year `0000`) is
      a `400 invalid_request` with the field error `cursor`, "Invalid cursor.".
- [x] A `dueDate` cursor (either direction) whose date is not a calendar date (February 30,
      month 13, day 32, February 29 of a common year, year `0000`) is the same `400`.
- [x] A valid cursor still pages as today, including one on a leap day (`2028-02-29`) and
      the `dueDate` cursor of a task with no due date (`0001-01-01`).
- [x] The rules are the shared ones: the paged-list cursor's instant rule (WS-051) and
      `calendarDateSchema` (WS-102, WS-114), not new regular expressions.
- [x] The full quality gate passes.

## Notes

The cursor is opaque, so only a tampered or hand-made cursor reaches this: the API never
issues one. It is still external input (`AGENTS.md` hard rule 4), and a `500` is logged as a
failure.
