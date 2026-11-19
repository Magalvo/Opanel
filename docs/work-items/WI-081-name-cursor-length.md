# WI-081 — Name cursors fit the longest name they carry

- Status: Approved (2026-11-19)
- Work-track: none: a fix from the audit of 2026-11-19 (finding B03)
- Depends on: none
- Work-spec: [WS-081](../work-specs/WS-081-name-cursor-length.md)

## Outcome

A name cursor (`encodeNameCursor`, WS-026) carries the last row's name. The decoder refuses a
name longer than 100 characters (`pagination.ts:52`), but epics page by title and a title may
be 200 characters (`epics.ts:15`). A page of epics that ends on a title longer than 100
characters therefore returns a `nextCursor` the API itself refuses with `400 Invalid cursor`:
the rest of the epics can never be listed, through the API or the epics page's "Load more".
The `cursor` query parameter has a second, independent bound of 512 characters
(`schemas/pagination.ts:12`), which a 112-character CJK title already exceeds once encoded.

After this item every cursor the API hands out is accepted back, and the bound derives from
the longest name a name cursor carries, so a later schema change cannot drift from it
unnoticed.

Five lists use name cursors: agents, epics, people, projects and teams.

## Acceptance criteria

- [ ] A name cursor holding a 200-character name round-trips; 201 characters is a `400`
      with `{ path: "cursor", message: "Invalid cursor." }`.
- [ ] A test fails if any name schema paged by a name cursor allows a longer name than the
      cursor bound.
- [ ] The longest name cursor the API can produce (200 characters, each escaped by JSON)
      passes the `cursor` query parameter's length bound.
- [ ] `GET /api/v1/projects/{projectId}/epics` pages across an epic with a 200-character
      title, and a 200-character CJK one, with no repeat and no gap.
- [ ] Shorter names and existing cursors keep working; paging order is unchanged.
- [ ] The only contract change is the widened `maxLength` of `cursor` in the OpenAPI
      document (owner question 1).
- [ ] The full quality gate passes.

## Notes

Lengths are Zod's `max`, which counts UTF-16 code units, the same unit as every name schema,
so the two bounds agree. The database columns are `text` with no length limit.
