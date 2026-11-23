# WS-114 — Epic dates in the year 0000 are refused with 400

- Status: Proposed
- Work-item: [WI-114](../work-items/WI-114-epic-date-year-zero.md)
- Canonical docs: [0004](../canonical/0004-api-conventions.md) section 3 (dates are
  `YYYY-MM-DD`; invalid input is a `400`); [WS-102](WS-102-priority-due-date.md) section 3
  and question 1 (the shared `calendarDateSchema` and why the year `0000` is refused)

## Approach

### 1. The defect

`src/lib/schemas/epics.ts` declares its own

```ts
const calendarDateSchema = z.iso.date().nullable();
```

and uses `z.iso.date()` again in the response schema `epicSchema`. `z.iso.date()` checks
the `YYYY-MM-DD` format and the calendar, but accepts the year `0000`, which PostgreSQL's
`date` type refuses ("date/time field value out of range"). The create and update services
pass the value to an `insert` or `update`, PostgreSQL raises, and the route wrapper answers
`500 internal_error` and logs the failure (WS-042). WS-102 found it and left it as a
follow-up; it added `calendarDateSchema` in `src/lib/schemas/dates.ts`, which refuses a
value starting with `0000-`.

### 2. The change

In `src/lib/schemas/epics.ts`:

- Remove the local `calendarDateSchema`. Import the shared one from `./dates`.
- Requests: `startDate` and `targetDate` of `createEpicRequestSchema` and
  `updateEpicRequestSchema` become `calendarDateSchema.nullable().optional()` (with the
  same `meta` descriptions as today). `null` still clears a date; leaving it out still
  leaves it unchanged. The `datesOrdered` refinement is unchanged.
- Response: `epicSchema`'s `startDate` and `targetDate` become
  `calendarDateSchema.nullable()`, so the response and the requests describe the same
  values, as `tasks.ts` does for `dueDate`.

No service or route changes: the route already validates the body with these schemas
through `readJson`, which turns a failed refinement into `400 invalid_request` with one
field error per failing path.

Criterion 4 (no bare `z.iso.date()` left) holds after this change: a search on
2026-11-23 found `z.iso.date()` only in `epics.ts` and inside `dates.ts` itself.
`z.iso.datetime()` timestamps are a different type and are out of scope; the pagination
cursor already refuses the year `0000` for its own timestamp (`pagination.ts`).

### 3. OpenAPI

`pnpm openapi:generate` is run and `docs/api/openapi.json` committed with any difference.
A refinement adds nothing to the generated schema, so no difference is expected (as for
`dueDate` in WS-102); the response and request fields stay `type: string, format: date`.

## Files

| Path                                                      | Change                                      |
| --------------------------------------------------------- | ------------------------------------------- |
| `src/lib/schemas/epics.ts`                                | modify: use the shared `calendarDateSchema` |
| `src/lib/schemas/epics.test.ts`                           | modify: tests 1 and 2                       |
| `src/app/api/v1/epics/[epicId]/route.integration.test.ts` | modify: tests 3 and 4                       |
| `docs/api/openapi.json`                                   | regenerate (expected unchanged)             |
| WI-114, WS-114                                            | modify: statuses, implementation record     |

No dependency, no migration. `docs/README.md` changes only by index commits on `main`: the
follow-up "An epic dated in the year `0000` answers `500`" is marked answered by WI-114
once it is done.

## Data model changes

None.

## API contract

No new endpoint or field. `POST /api/v1/projects/{projectId}/epics` and
`PATCH /api/v1/epics/{epicId}` answer `400 invalid_request` instead of `500` for a date in
the year `0000`; both already document `400`.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                         | Covers criterion |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| 1   | unit        | `epics.test.ts`: `createEpicRequestSchema` and `updateEpicRequestSchema` refuse `startDate` and `targetDate` `0000-01-01`, each on its own path. Fails today | 1, 2             |
| 2   | unit        | `epics.test.ts`: `0001-01-01`, `null` and an absent field are still accepted, and the target-before-start rule still holds (existing tests stay green)       | 3                |
| 3   | integration | epic route test: `POST` with `startDate: "0000-01-01"` is a `400` naming `startDate`, and the project's epic list is unchanged                               | 1                |
| 4   | integration | epic route test: `PATCH` with `targetDate: "0000-01-01"` is a `400` naming `targetDate`, and the epic's version is unchanged                                 | 2                |

The integration tests follow the shape of the task route's `dueDate: "0000-01-01"` test in
`src/app/api/v1/tasks/[taskId]/route.integration.test.ts`, against the real test database.
Criterion 4 is checked with a search in review; criterion 5 by running the generator.

## Risks and open questions

None known. The change only narrows what the API accepts to what the database could ever
store, so no existing client request that succeeds today is refused.
