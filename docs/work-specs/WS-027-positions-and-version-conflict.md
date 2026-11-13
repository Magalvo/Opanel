# WS-027 — Fractional positions and the `version_conflict` response

- Status: Approved (approved by the owner on 2026-11-13, questions 1 and 2 as proposed)
- Work-item: [WI-027](../work-items/WI-027-positions-and-version-conflict.md)
- Canonical docs: [0002](../canonical/0002-realtime-sync.md) section 4;
  [0004](../canonical/0004-api-conventions.md) sections 4, 6;
  [WT-03](../work-tracks/WT-03-board-core.md) decisions 5 and 7, amendment A2

## Approach

### 1. Ordering keys: `src/lib/position.ts`

Doc 0002 orders cards with "a fractional `position` value, so moving one card writes one
row". WT-03 decision 5 chose text keys over a floating-point number. This module
generates them. It has no dependency and no database access; it lives in `src/lib`
because it is pure logic that both the server and, later, the board UI can use.

**Alphabet.** The 62 characters `0-9`, `A-Z`, `a-z`, in that order, which is also their
ASCII order. Keys are compared by UTF-16 code unit: in JavaScript with `<` and `>`, in
PostgreSQL under `COLLATE "C"` (amendment A2). The module's header says this, and that
`localeCompare` must never be used on keys.

**Key format** (the scheme published by David Greenspan as "fractional indexing", used by
several collaborative editors). A key is an _integer part_ followed by an optional
_fraction_:

- The integer part starts with a head character that gives its length: `a` means one digit
  follows, `b` two digits, up to `z` (26 digits); `Z` means one digit for a negative
  integer, `Y` two, down to `A`. So `a0` < `a1` < … < `az` < `b00` < `b01` < … and
  `Zz` < `a0`. Every integer sorts correctly as text.
- The fraction is any digits not ending in `0`, so every key has exactly one spelling.
- The first key of an empty list is `a0`.

Why this scheme and not plain fractions (`0.5`, `0.75`, …): a board mostly **appends** cards
to the end of a column. With a plain fraction every append halves the remaining gap and
the key grows by a character every six appends; here an append increments the integer part,
and the key grows by one character only when the integer part needs another digit (`a` has
62 values, `b` 3 844, `c` 238 328). Inserts **between** two neighbours still use the
fraction and grow by about one character per six inserts into the same gap, which is the
unavoidable cost of never renumbering other rows.

**Functions.**

```ts
/** A key strictly between `before` and `after`; `null` means no neighbour on that side. */
export function positionBetween(before: string | null, after: string | null): string;

/** `count` keys in order, all strictly between `before` and `after` (count >= 0). */
export function positionsBetween(
  before: string | null,
  after: string | null,
  count: number,
): string[];

/** True if `key` is a well-formed key of this scheme. */
export function isPositionKey(key: string): boolean;
```

`positionBetween` throws a plain `Error` (a programming mistake, not a client error) if a
key is malformed or `before >= after`. Callers on the server read both neighbours from the
database inside the transaction that writes the new key, so the inputs are always ordered.
`positionsBetween` with no upper bound counts up (`a0`, `a1`, `a2` for three default
columns); between two keys it bisects recursively, so the keys share the gap evenly instead
of crowding at one end.

**Limits.** Keys are not bounded in length by the scheme. With the integer part, a list
can grow to about 240 000 appended items with keys of at most four characters. A pathological
sequence of thousands of inserts into the same gap gives keys of a few hundred characters,
which PostgreSQL `text` stores without issue. Rebalancing (rewriting keys) is out of scope
in v1, as doc 0002 wants one row per move; see question 1.

### 2. `version_conflict`: the error

- `PROBLEM_CODES` gains `version_conflict`.
- `ApiError` gains an optional read-only `current: unknown`. `src/server/http/errors.ts`
  gains `versionConflict(current: unknown, detail?)`, `409`, code `version_conflict`,
  default detail "This was changed by someone else. Reload it and try again."
- `route()`'s problem response adds `current` to the body when the error has it. Only
  `versionConflict` sets it. The caller passes the entity exactly as the endpoint's `GET`
  returns it, so `current` never contains anything the caller could not already read
  (hard rule 7).
- `problemSchema` gains `current: z.unknown().optional()`, described as "Only with
  `version_conflict`: the entity as it is now". The base schema stays strict.

How a service uses it (written here so WI-028 to WI-031 follow one pattern; nothing in this
item calls it):

```sql
update <table> set ..., version = version + 1, updated_at = now()
where id = $id and version = $expected
returning ...
```

No row returned: read the entity; if it does not exist, `404`; otherwise
`versionConflict(current)`. Versions start at 1 and are positive integers; the shared
request field is `versionSchema = z.int().min(1)` in `src/lib/schemas/version.ts`.

### 3. `version_conflict`: the contract

`ResponseContract` (`src/lib/openapi/contract.ts`) gains a fourth kind:

```ts
/** `409 version_conflict` for an entity: a problem body whose `current` is that entity. */
export interface VersionConflictResponseContract {
  description: string;
  conflictOf: z.ZodType; // the entity schema, e.g. projectSchema
}
```

`buildOpenApiDocument` describes it as `application/problem+json` with the schema
`problemSchema.extend({ code: z.literal("version_conflict"), current: <entity> })`,
registered once per entity under the id `<EntityId>VersionConflict` (for example
`ProjectVersionConflict`), so the document names it and clients can generate a type for it.
A helper `versionConflictResponse(entitySchema)` in `src/lib/openapi/responses.ts` returns
the contract entry with a standard description, so endpoints write
`409: versionConflictResponse(projectSchema)`.

An entity schema used this way must carry a `meta({ id })`; the document builder throws if
it does not, so the generated name is never `undefined`.

### Alternatives considered

- **A `double precision` position.** Rejected in WT-03 decision 5.
- **An npm package for fractional indexing.** The scheme is about 150 lines, decision 5
  asked for no dependency, and owning it lets the tests pin the exact behaviour amendment
  A2 depends on.
- **Returning only the current `version` in the conflict, not the entity.** Doc 0002 and
  doc 0004 both say the conflict returns the current entity, so the UI can show it without
  another request.

## Files

| Path                                        | Change                                         |
| ------------------------------------------- | ---------------------------------------------- |
| `src/lib/position.ts`, `position.test.ts`   | create                                         |
| `src/lib/schemas/problem.ts`, `.test.ts`    | modify: `version_conflict`, `current`          |
| `src/lib/schemas/version.ts`, `.test.ts`    | create: `versionSchema`                        |
| `src/server/http/errors.ts`, `.test.ts`     | modify: `current`, `versionConflict()`         |
| `src/server/http/route.ts`, `route.test.ts` | modify: `current` in the problem body          |
| `src/lib/openapi/contract.ts`               | modify: `VersionConflictResponseContract`      |
| `src/lib/openapi/responses.ts`              | create: `versionConflictResponse()`            |
| `src/lib/openapi/document.ts`, `.test.ts`   | modify: describe the conflict schema           |
| `docs/api/openapi.json`                     | regenerate (only the `Problem` schema changes) |
| `docs/canonical/0004-api-conventions.md`    | modify: section 6 names the update pattern     |
| `docs/README.md`, WI-027, WS-027, WT-03     | modify: statuses                               |

No new dependency.

## Data model changes

None. The first position and `version` columns arrive with WI-028.

## API contract

No endpoint changes. The `Problem` schema in the OpenAPI document gains the optional
`current` member and the code `version_conflict`; both are additive (doc 0004 section 8).

## Test plan (written first, in this order)

| #   | Level | Test                                                                                                                                                                                                                                                       | Covers criterion   |
| --- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 1   | unit  | the first key is `a0`; after `a0` comes `a1`, after `az` comes `b00`; before `a0` comes `Zz`                                                                                                                                                               | key format         |
| 2   | unit  | `positionBetween` returns a key strictly between for: two integers, an integer and a fraction, two fractions, adjacent integers (`a0`, `a1`)                                                                                                               | between            |
| 3   | unit  | keys that differ only by case (`aZ`, `aa`) order as the library says with `<`, the opposite of `localeCompare` in English                                                                                                                                  | code-unit order    |
| 4   | unit  | refuses malformed keys (`""`, `a`, `a00`… with a trailing `0` fraction, `a!`) and `before >= after`                                                                                                                                                        | input checks       |
| 5   | unit  | 10 000 appends: every key greater than the last, none longer than 4 characters; 10 000 prepends likewise                                                                                                                                                   | short keys         |
| 6   | unit  | 1 000 inserts into the same gap: still strictly ordered, longest key at most 200 characters                                                                                                                                                                | growth bound       |
| 7   | unit  | 5 000 random inserts at random places (seeded generator): the list is always strictly ordered and every key passes `isPositionKey`                                                                                                                         | ordering, property |
| 8   | unit  | `positionsBetween(null, null, 3)` is `a0`, `a1`, `a2`; `count` keys between two keys are ordered and inside the gap; `count` 0 gives `[]`                                                                                                                  | several keys       |
| 9   | unit  | `versionConflict(entity)` is `409`, code `version_conflict`, `current` the entity; no other constructor sets `current`                                                                                                                                     | the error          |
| 10  | unit  | through `route()`: the body has `current` and validates against `problemSchema`; a `404` body has no `current` key                                                                                                                                         | the response       |
| 11  | unit  | `versionSchema` accepts 1 and larger whole numbers, refuses 0, -1, 1.5 and strings                                                                                                                                                                         | request field      |
| 12  | unit  | document: a test contract with `409: versionConflictResponse(thingSchema)` gets a `ThingVersionConflict` problem schema whose `current` refers to `Thing`; an entity schema without an id makes the builder throw; the document is still valid OpenAPI 3.1 | contract           |

## Risks and open questions

1. **No rebalancing.** If a real board ever produces very long keys, a later item can add
   an occasional rewrite of one column's keys. Proposed: not in v1; WI-037 measures key
   lengths when it loads 1 000 tasks.
2. **`current` is untyped in the base `Problem` schema.** The precise type is in each
   endpoint's `<Entity>VersionConflict` schema. Clients that only know `Problem` see an
   optional `current` of any shape.
