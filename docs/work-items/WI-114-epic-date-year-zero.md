# WI-114 — Epic dates in the year 0000 are refused with 400

- Status: Proposed
- Work-track: none: a follow-up of WI-102 (WS-102 question 1), confirmed in the code by the
  project audit of 2026-11-23
- Depends on: none
- Work-spec: [WS-114](../work-specs/WS-114-epic-date-year-zero.md)

## Outcome

Creating or updating an epic with a `startDate` or `targetDate` in the year `0000` is
answered `400 invalid_request`, naming the field, like any other invalid date. Today
`src/lib/schemas/epics.ts` validates epic dates with `z.iso.date()`, which accepts
`0000-01-01`; PostgreSQL's `date` refuses it, so the request fails inside the service and
the API answers `500 internal_error` (and logs a failure). WI-102 added the shared
`calendarDateSchema` (`src/lib/schemas/dates.ts`) that refuses the year `0000` for a
task's due date; epics now use it too.

## Acceptance criteria

- [ ] `POST /api/v1/projects/{key}/epics` with `startDate` or `targetDate` `0000-01-01`
      answers `400 invalid_request` with a field error on that field, and creates nothing.
- [ ] `PATCH /api/v1/epics/{id}` with `startDate` or `targetDate` `0000-01-01` answers
      `400 invalid_request` with a field error on that field, and changes nothing.
- [ ] Valid dates, `null` (to clear) and leaving the fields out behave as today, including
      the rule that the target date may not come before the start date.
- [ ] No schema in `src/lib/schemas/` validates a calendar date with a bare `z.iso.date()`
      any more: each uses `calendarDateSchema`.
- [ ] The generated OpenAPI document is regenerated; any difference is committed.
- [ ] The full quality gate passes.

## Notes

No data model or UI change. An epic stored with such a date cannot exist (PostgreSQL never
accepted one), so no data needs repair.
