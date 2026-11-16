# WI-036 — Projects list, navigation and project settings

- Status: Proposed (awaiting owner approval)
- Work-track: [WT-03](../work-tracks/WT-03-board-core.md) (decisions 2, 4, 5, 7, 10, 11, 12;
  question 3)
- Depends on: WI-029, WI-032
- Work-spec: [WS-036](../work-specs/WS-036-projects-pages.md)

## Outcome

In the browser, every signed-in person finds "Projects" in the sidebar, lists the active
projects (and, on request, the archived ones) and opens a project at `/projects/KEY`. A
Manager or Admin creates a project, and on the project's settings page edits its name and
description, archives and unarchives it, adds, renames, recategorises, reorders and deletes
columns, and restores deleted tasks. The pages use only the existing `/api/v1` endpoints.

## Acceptance criteria

- [ ] The sidebar shows "Projects" to every signed-in person, first in the list.
- [ ] `/projects` lists active projects by name with their key; an "Archived" view lists
      archived ones. A Manager or Admin creates a project there; a taken key is shown at
      the key field.
- [ ] `/projects/KEY` shows the project's header (name, key, an "Archived" badge) and its
      navigation; a key the API does not know shows a plain "not found" message.
- [ ] `/projects/KEY/settings` is for Managers and Admins only (others get a not-found
      page). It edits name and description with `version`, showing a conflict as "someone
      changed this" with the current values; archives (after confirming) and unarchives.
- [ ] On the same page: columns in board order; add, rename, change category, move up and
      down, delete after confirming. "Last done column", "column not empty", version
      conflicts and archived projects are each explained in plain words.
- [ ] On the same page: deleted tasks with key, title and deletion time; each can be
      restored.
- [ ] An archived project's settings show everything read-only except "Unarchive".
- [ ] The delete-column contract documents `409 column_not_empty`, which the endpoint
      already answers; the OpenAPI document is regenerated.
- [ ] The pages work by keyboard, announce outcomes, have no accessibility violations in
      light and dark mode, and have no horizontal page scroll at phone width.
- [ ] The full quality gate passes.

## Notes

The board itself is WI-037; until then `/projects/KEY` shows the project's header and an
empty board area. The epics page is WI-039.
