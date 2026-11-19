# WS-081 — Name cursors fit the longest name they carry

- Status: Done (2026-11-19; approved by the owner the same day, questions 1 to 3 as proposed)
- Work-item: [WI-081](../work-items/WI-081-name-cursor-length.md)
- Canonical docs: [0004](../canonical/0004-api-conventions.md) section 5 (pagination);
  audit of 2026-11-19, finding B03

## Approach

`nameCursorSchema` in `src/server/http/pagination.ts:51-54` bounds `n` with
`z.string().max(100)`. Five services encode the last row's name with `encodeNameCursor`:
`agents.ts:192`, `epics.ts:112` (the title), `people.ts:62`, `projects.ts:185` and
`teams.ts:109`. Their names are bounded by `accountNameSchema` (100, `accounts.ts:16`; projects
and teams reuse it, `projects.ts:16`, `teams.ts:11`), `agentNameSchema` (80, `agents.ts:27`)
and `epicTitleSchema` (200, `epics.ts:15`). The columns are `text` with no limit
(`db/schema/epics.ts:16` and siblings). So an epic title of 101 to 200 characters makes a
`nextCursor` that `decodeNameCursor` refuses.

Two changes:

1. **The decoder bound.** `pagination.ts` exports `NAME_CURSOR_MAX_LENGTH = 200` and uses it in
   `nameCursorSchema`. A unit test reads `maxLength` from each name schema (Zod 4.6.7 exposes
   it; probed on 2026-11-19: `z.string().trim().min(1).max(200).maxLength === 200`) and
   asserts it is at most the constant. `agentNameSchema` is exported for that test only.
   Computing the constant from the schemas instead would make `server/http` import every
   domain schema; the test gives the same protection without the coupling.
2. **The query bound.** `paginationQuerySchema.cursor` is `max(512)`. Encoded sizes, measured
   on 2026-11-19: a 200-character ASCII title is 335 characters, a 200-character CJK title
   868, and the worst case (200 control characters, each escaped by JSON as `\uXXXX`) 1668.
   The bound becomes `MAX_CURSOR_LENGTH = 2048` in `src/lib/schemas/pagination.ts`, shared by
   every list. A unit test encodes the worst-case name cursor and parses it with
   `paginationQuerySchema`.

Units: Zod's `max` counts UTF-16 code units, as do the name schemas, so a name that passed
its own schema always fits the cursor. An emoji counts 2 in both.

`decodeNameCursor`, the services and the sort order do not change.

## Files

| Path                                                      | Change                                                     |
| --------------------------------------------------------- | ---------------------------------------------------------- |
| `src/server/http/pagination.ts`                           | modify: `NAME_CURSOR_MAX_LENGTH`, used by the schema       |
| `src/server/http/pagination.test.ts`                      | modify: new cases (tests first)                            |
| `src/lib/schemas/pagination.ts`                           | modify: `MAX_CURSOR_LENGTH = 2048` for the `cursor` param  |
| `src/lib/schemas/pagination.test.ts`                      | modify: the worst-case name cursor passes the query schema |
| `src/lib/schemas/agents.ts`                               | modify: export `agentNameSchema`                           |
| `src/app/api/v1/epics/[epicId]/route.integration.test.ts` | modify: paging across long titles                          |
| `docs/api/openapi.json`                                   | regenerate: `cursor` `maxLength` 512 to 2048               |
| `docs/README.md`, WI-081, WS-081                          | modify: statuses                                           |

No new dependency, no migration.

## Data model changes

None.

## API contract

The `cursor` query parameter of every list endpoint accepts up to 2048 characters instead of 512. This widens an input and breaks no client, so it stays in `/api/v1` (hard rule 9). The
OpenAPI document is regenerated from the Zod schema; nothing else in it changes.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                                                    | Covers criterion      |
| --- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| 1   | unit        | `decodeNameCursor` round-trips a 200-character name, ASCII and CJK (fails before); 201 characters is the `400` naming `cursor` (the existing 101-character case moves to 201)           | decoder bound         |
| 2   | unit        | `accountNameSchema`, `agentNameSchema`, `projectNameSchema`, `teamNameSchema` and `epicTitleSchema` each have a `maxLength` no greater than `NAME_CURSOR_MAX_LENGTH`                    | no drift              |
| 3   | unit        | `paginationQuerySchema` accepts the encoding of a name cursor of 200 `\u0001` characters (1668 characters; fails before), and refuses 2049 characters                                   | query bound           |
| 4   | integration | route: in project `OPA`, epics `a`, `b` + 200 × `x`, `b` + 200 × `名`, `c`; `GET .../epics?limit=1` followed through every `nextCursor` returns each epic once, in order (fails before) | paging across long    |
| 5   | integration | existing keyset paging tests of agents, epics, people, projects and teams kept: order and ties by id unchanged                                                                          | nothing else changes  |
| 6   | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`; `pnpm openapi:generate` changes only the `cursor` `maxLength` values                                                           | gate, contract change |

## Risks and open questions

For the owner:

1. **Widen the `cursor` parameter to 2048 for every list.** Without it, the decoder fix alone
   still leaves titles of 112 or more CJK characters unpageable. The alternative, a cursor
   that holds only the id and looks the name up, breaks when that row is deleted or renamed
   between pages (WS-026 chose the name for that reason). **Recommend: widen, one shared
   bound.**
2. **A constant plus a drift test, rather than a bound computed from the schemas.** Same
   guarantee, no import of domain schemas into `server/http`. **Recommend: as proposed.**
3. **Board cursors** (`pagination.ts:86-90`) allow positions of 2000 characters each, which
   also cannot fit 512, nor 2048. Real positions are short, so this is left out of scope.
   **Recommend: note it; a separate item if the audit wants it.**

## Deviations from the approved spec

1. **Test 4 lives in a new `describe` of the epics route test**, with titles of 200
   characters in total (`b` followed by 199 characters, so `b…` sorts between `a` and
   `c`), rather than `b` plus 200 characters, which an epic title refuses.

## Implementation record

- Red: the two 200-character round trips and the 2048 bound failed (`400`, and Zod's
  "expected string to have <=512 characters"); the drift test failed with
  `NAME_CURSOR_MAX_LENGTH` and `agentNameSchema` not exported; the route test got `400` on
  the cursor after the first long title.
- Green: 21 of 21 in the three files. The 101-character refusal moved to 201 (test 1).
- `pnpm openapi:generate`: 8 lines change, each the `maxLength` of a `cursor` parameter,
  512 to 2048 (test 6).
- `docs/work-specs/WS-018-account-management-api.md` still says the cursor may have up to
  512 characters; it is the record of that item and stays as written.
- Gate on 2026-11-19:
  - typecheck, lint and Prettier pass;
  - Vitest 1551 of 1551;
  - `pnpm test:e2e --retries=0` 86 of 87. The failure is
    `agents.spec.ts` "a Manager has neither the Agents link nor the page", which also fails
    without this item's changes: its unscoped `getByRole("link", { name: "Agents" })`
    matches projects named "Agents …" that the same spec creates, once they are on the
    first page of `/projects`. Listed under Follow-ups. In one other run
    `board.spec.ts:208` (keyboard move) and `live-pages.spec.ts:125` failed once and
    passed on the next run;
  - Linux, Node 22.23.5, pnpm 10, Compose PostgreSQL 18 on port 5432.
