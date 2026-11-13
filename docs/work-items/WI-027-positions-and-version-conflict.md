# WI-027 — Fractional positions and the `version_conflict` response

- Status: Proposed
- Work-track: [WT-03](../work-tracks/WT-03-board-core.md) (decisions 5 and 7, amendment A2)
- Depends on: none
- Work-spec: [WS-027](../work-specs/WS-027-positions-and-version-conflict.md)

## Outcome

Two building blocks that the projects, columns and tasks items (WI-028 to WI-031) need,
delivered and tested before any of them uses them:

1. A pure library that generates ordering keys: a key between any two keys, before the
   first, after the last, or several at once, so that moving a card or a column writes one
   row.
2. The `409 version_conflict` problem response, which carries the entity as it is now, and
   the means to declare it in an endpoint contract so it appears in the OpenAPI document.

No endpoint and no table changes in this item.

## Acceptance criteria

- [ ] `positionBetween(before, after)` returns a key strictly between the two, with `null`
      meaning "no neighbour on that side", for every valid pair; it refuses a pair that is
      not in order.
- [ ] Keys are compared by UTF-16 code unit (`<`), never with `localeCompare`, and only use
      the 62 ASCII letters and digits; the module says so and the tests use `<`.
- [ ] Appending at the end of a list many times keeps keys short (thousands of appends,
      a handful of characters); inserting repeatedly into the same gap grows a key by
      about one character per six inserts.
- [ ] `positionsBetween(before, after, count)` returns `count` ordered keys in the gap,
      used for the three default columns of a project.
- [ ] A `version_conflict` problem has status `409` and a `current` member with the entity;
      no other problem has `current`.
- [ ] A contract can declare a `409` version conflict for an entity schema, and the
      OpenAPI document then describes the problem body with that entity as `current`.
- [ ] The full quality gate passes.
