# WS-121 — Task list cursors refuse impossible dates

- Status: In progress (approved by the owner on 2026-11-24, as proposed)
- Work-item: [WI-121](../work-items/WI-121-task-list-cursor-dates.md)
- Canonical docs: [0004](../canonical/0004-api-conventions.md) section 4 (invalid input is
  a `400` with field errors) and section 5 (cursors); [WS-051](WS-051-cursor-date-validation.md)
  (the paged-list cursor's instant rule); [WS-102](WS-102-priority-due-date.md) section 3
  and [WS-114](WS-114-epic-date-year-zero.md) (`calendarDateSchema`);
  [WS-118](WS-118-task-list-across-projects.md) section 5 and deviation 2 (the task list
  cursor and its shape checks)

## Approach

### 1. The defect

`GET /api/v1/tasks` (WI-118) pages with a cursor holding the sort, the last row's sort
values as text and its id (`encodeTaskListCursor`, `src/server/http/pagination.ts`).
`listAllTasks` (`src/server/services/tasks.ts`) checks each value against its sort key's
`shape`, a regular expression, then casts it in SQL (`::timestamptz`, `::date`):

- `created` and `updated` use `TIMESTAMP`,
  `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/`: digits in place, nothing more;
- `dueDate`'s date key uses `/^(?!0000)\d{4}-\d{2}-\d{2}$/`.

So `2026-02-30T12:00:00.000000Z`, `2026-13-01T…`, `2026-11-12T25:00:00.000000Z` or
`0000-01-01T00:00:00.000000Z` in a `created` or `updated` cursor, and `2026-02-30` or
`2026-13-01` in a `dueDate` cursor, pass the check. PostgreSQL then refuses the cast
("date/time field value out of range", reproduced by the audit), the route wrapper answers
`500 internal_error` and logs a failure (WS-042). Every other paged list refuses such a
cursor with `400` since WI-051.

### 2. The change

The key's check becomes a Zod schema built from the rules the other lists already use:

- In `src/server/http/pagination.ts`, the instant rule of `cursorSchema`'s `t`
  (`z.iso.datetime({ precision: 6 })` refined to refuse the year `0000`) is exported as
  `cursorInstantSchema`, and `cursorSchema` uses it. No behaviour change there: the tests of
  WS-051 stay green as they are.
- In `tasks.ts`, `SortKey.shape: RegExp` becomes `SortKey.value: z.ZodType<string>`:
  - `created` and `updated` (`timestampKey`): `cursorInstantSchema`. `TIMESTAMP` is
    removed. The values the API writes (`to_char(… at time zone 'utc', ISO_US)`) are
    exactly six fractional digits and `Z`, which the schema requires.
  - `dueDate`'s date key: `calendarDateSchema` (`src/lib/schemas/dates.ts`). It accepts
    `0001-01-01`, the value written for a task with no due date (`NO_DUE_DATE`).
  - The other keys keep their expressions, as `z.string().regex(…)`: `key`, `number`,
    `title`, `priority` and the due date's `true`/`false` flag. Their casts (`::int`,
    `::text`, `::boolean`) cannot fail on a value those expressions accept.
- The check in `listAllTasks` becomes
  `keys.every((key, index) => key.value.safeParse(cursor.values[index] ?? "").success)`,
  and still throws the same `invalidRequest` (`cursor`, "Invalid cursor.").

`decodeTaskListCursor` keeps checking the cursor's structure, its sort and the number of
values: it knows nothing of the keys, which stay in the service.

Zod's calendar checks were confirmed on the installed version (2026-11-24):
`z.iso.datetime({ precision: 6 })` refuses February 30 and hour 25 and accepts
`2028-02-29`; `z.iso.date()` refuses `2026-02-29` and month 13; both accept the year
`0000`, which the shared rules refuse.

## Files

| Path                                                | Change                                            |
| --------------------------------------------------- | ------------------------------------------------- |
| `src/server/http/pagination.ts`                     | modify: export `cursorInstantSchema`, used by `t` |
| `src/server/services/tasks.ts`                      | modify: sort keys check values with Zod schemas   |
| `src/server/services/all-tasks.integration.test.ts` | modify: tests 1 to 3                              |
| `src/app/api/v1/tasks/route.integration.test.ts`    | modify: test 4                                    |
| WI-121, WS-121                                      | modify: statuses, implementation record           |

No dependency, no migration. `docs/README.md` changes only by index commits on `main`:
follow-up C01 is marked answered by WI-121 once it is done.

## Data model changes

None.

## API contract

No new endpoint, parameter or field, and no change to the generated OpenAPI document (the
cursor is an opaque string there). `GET /api/v1/tasks` answers `400 invalid_request` with
the field error `cursor` instead of `500` for a cursor holding an impossible date; it
already documents `400`.

## Test plan (written first, in this order)

Each bad cursor is made with `encodeTaskListCursor` from a real page's cursor, changing
only the date, so the sort, the number of values and the id stay valid and the date is the
only thing wrong.

| #   | Level       | Test                                                                                                                                                                                                                                                     | Covers criterion |
| --- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | integration | `all-tasks.integration.test.ts`: for `created`, `-created`, `updated` and `-updated`, a cursor dated February 30, month 13, day 32, hour 24, hour 25, minute 60, second 60 and year `0000` is a `400` naming `cursor`. Fails today with a database error | 1                |
| 2   | integration | same file: for `dueDate` and `-dueDate`, a cursor dated `2026-02-30`, `2026-13-01`, `2026-11-32`, `2026-02-29` and `0000-01-01` is the same `400`. Fails today with a database error                                                                     | 2                |
| 3   | integration | same file: tasks created and due around `2028-02-29` (with one task with no due date) page by `created`, `updated` and `dueDate`, both ways, `limit` 1, with each cursor on the leap day or `0001-01-01` accepted and no task repeated or missed         | 3                |
| 4   | integration | `route.integration.test.ts`: `GET /api/v1/tasks?sort=-updated&cursor=…` with an `updated` value of `2026-02-30T12:00:00.000000Z` answers `400` with the field error `cursor`, not `500`                                                                  | 1                |

The existing tests of `pagination.test.ts` (WS-051) check `cursorInstantSchema` through
`decodeCursor` and stay as they are. Criterion 4 is checked in review: no date or time
regular expression is left in `tasks.ts`.

## Risks and open questions

None known. The change only refuses values the database could never cast, so every cursor
the API issues is still accepted, as test 3 checks.

## Deviations from the approved spec

None yet.

## Implementation record

Not started.
