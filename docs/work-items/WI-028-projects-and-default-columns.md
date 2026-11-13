# WI-028 — Projects with default columns

- Status: Approved
- Work-track: [WT-03](../work-tracks/WT-03-board-core.md) (decisions 2, 3, 4, 7, 10, 16;
  amendment A2)
- Depends on: WI-025, WI-027
- Work-spec: [WS-028](../work-specs/WS-028-projects-and-default-columns.md)

## Outcome

Through the API, a Manager or Admin creates a project with a key, a name and a description,
edits it, archives it and brings it back; every signed-in person lists and reads projects.
A new project starts with the columns "To do", "In progress" and "Done". The `columns`
table exists, with byte-order positions, ready for the columns API of WI-029.

## Acceptance criteria

- [ ] A project key is 2 to 10 characters, uppercase letters and digits, starting with a
      letter, unique, and cannot be changed; a taken key is `409 project_key_taken`.
- [ ] Creating a project creates its three default columns, in order, with the categories
      `todo`, `in_progress` and `done`, in the same transaction.
- [ ] `PATCH` changes the name and description, requires `version`, and answers
      `409 version_conflict` with the current project when it is stale.
- [ ] An archived project is read-only: `PATCH` is `409 project_archived`; it is left out of
      the project list unless archived projects are asked for; it can be unarchived.
- [ ] Project paths accept the project's id or its key.
- [ ] Viewer and Member read projects and get `403` on every write.
- [ ] Every change writes one audit entry with its actor, in the same transaction.
- [ ] On the real database, positions that differ only by letter case come back from
      `order by position` in the order `src/lib/position.ts` gives them (amendment A2).
- [ ] The full quality gate passes, with the migration committed.
