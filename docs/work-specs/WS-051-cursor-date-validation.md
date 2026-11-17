# WS-051 — Creation-time cursors are checked as dates

- Status: Done (approved by the owner on 2026-11-17, questions 1 to 3 as proposed)
- Work-item: [WI-051](../work-items/WI-051-cursor-date-validation.md)
- Canonical docs: [0004](../canonical/0004-api-conventions.md) section 5 (pagination);
  audit of 2026-11-17, finding A08

## Approach

`cursorSchema` in `src/server/http/pagination.ts` checks the `t` field with the regex
`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$`. `listAccounts`
(`account-management.ts:95`) and `listComments` (`comments.ts:77`) then cast it with
`::timestamptz`. A value of the right layout but no real date reaches PostgreSQL, which
raises `22008` (`datetime_field_overflow`); `route()` answers `500` and logs it.

The fix replaces the regex with the installed Zod's calendar-aware check, plus one bound:

```ts
t: z.iso.datetime({ precision: 6 }).refine((value) => !value.startsWith("0000-")),
```

- `z.iso.datetime({ precision: 6 })` (Zod 4.6.7): exactly six fractional digits, `Z` only
  (no offset, since `offset` is not enabled), and real calendar values. Probed against the
  installed version on 2026-11-17: it accepts `2026-11-12T10:00:00.123456Z` and
  `2024-02-29T…`, and refuses `2026-99-99T25:61:61.000000Z`, `2026-02-29T…` (not a leap
  year), `2026-02-30T…`, hour `24`, second `60`, three fractional digits and `+00:00`.
- Year `0000`: Zod accepts it, PostgreSQL refuses it ("date/time field value out of range",
  checked on the Compose database). The refinement closes that gap. Years `0001` to `9999`
  are accepted by both.
- The value stays text, never a JavaScript `Date`, so the microsecond precision the
  cursor exists for is kept (WS-018).

The `Cursor` interface, `encodeCursor` and both services do not change. The decoder already
turns any schema failure into the `400` of the API conventions.

### Why not catch the database error instead

Mapping `22008` to `400` in the services would still send the query, and would also turn a
genuine server-side date bug into a client error. Validating at the boundary is what hard
rule 4 asks for.

## Files

| Path                                                               | Change                                  |
| ------------------------------------------------------------------ | --------------------------------------- |
| `src/server/http/pagination.ts`                                    | modify: the `t` field of `cursorSchema` |
| `src/server/http/pagination.test.ts`                               | modify: new cases (tests first)         |
| `src/app/api/v1/accounts/route.integration.test.ts`                | modify: impossible-date cursor is `400` |
| `src/app/api/v1/tasks/[taskId]/comments/route.integration.test.ts` | modify: impossible-date cursor is `400` |
| `docs/README.md`, WI-051, WS-051                                   | modify: statuses                        |

No new dependency, no migration.

## Data model changes

None.

## API contract

None. Both endpoints already document `400` for an invalid cursor; this item makes them
keep that promise.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                            | Covers criterion         |
| --- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 1   | unit        | `decodeCursor` refuses, with the `400` naming `cursor`: month `99`, day `32`, `2026-02-29`, `2026-02-30`, hour `24`, minute `60`, second `60`, year `0000`, and a malformed uuid (fails before) | impossible dates         |
| 2   | unit        | it still refuses three or nine fractional digits, no fraction, `+00:00` and a lowercase `z` (existing shape cases kept)                                                                         | shape still checked      |
| 3   | unit        | it accepts and round-trips `2024-02-29T23:59:59.999999Z`, `0001-01-01T00:00:00.000000Z` and `9999-12-31T23:59:59.999999Z`, text unchanged                                                       | valid cursors            |
| 4   | integration | route: `GET /api/v1/accounts?cursor=<impossible date>` is `400` with the cursor problem body, and a spy on `console.error` is not called (fails before: `500`)                                  | `400` not `500`          |
| 5   | integration | route: the same for `GET /api/v1/tasks/{taskId}/comments`                                                                                                                                       | `400` not `500`          |
| 6   | integration | existing keyset paging tests of accounts and comments kept: no repeat, no gap, ties broken by id                                                                                                | microseconds kept        |
| 7   | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm openapi:generate` leaves no diff                                                                                                 | gate, no contract change |

## Risks and open questions

For the owner:

1. **Zod's datetime check instead of a hand-written calendar check.** It is the installed
   library's documented validator and was probed on the cases above; a hand-written one
   would need its own leap-year logic. **Recommend: Zod, with the year-`0000` refinement.**
2. **Cursors already handed out** are produced by `encodeCursor` from PostgreSQL's own
   timestamps, so every one is a real date and keeps working. **Recommend: no transition
   needed.**
3. **The year bound is not a lower bound on business data.** Nothing in Opanel is created
   before 2026, but the check stays "a value PostgreSQL accepts", not a product rule.
   **Recommend: as proposed.**

## Deviations from the approved spec

None yet.

## Implementation record

- Red: the new unit test failed because `decodeCursor` accepted
  `2026-99-99T25:61:61.000000Z` ("expected a failure"), and both route tests failed with
  `500` instead of `400` (run before the schema changed).
- Green: the `t` field of `cursorSchema` is `z.iso.datetime({ precision: 6 })` with the
  year-`0000` refinement. All 1097 Vitest tests pass (up from 1094); typecheck and lint
  pass; the changed files pass Prettier.
- E2E: 60 of 63 passed in the parallel run. The three that failed (accept-link,
  accessibility in light mode on the projects pages, keyboard move on the board) touch no
  cursor and all pass when rerun with `--workers=1`: the cross-test interference of the
  audit of 2026-11-17, finding A09.
- Run on Windows with Node 24 and the pinned pnpm 10.28.0, against the Compose
  PostgreSQL on port 5433 (`DATABASE_URL` and `E2E_DATABASE_URL` overridden; another
  server holds 5432 here). The repository-wide `format:check` fails in this checkout only
  because of CRLF line endings (finding A10); CI runs on Linux.
