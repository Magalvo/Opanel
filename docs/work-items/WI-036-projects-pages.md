# WI-036 — Projects list, navigation and project settings

- Status: Done
- Work-track: [WT-03](../work-tracks/WT-03-board-core.md) (decisions 2, 4, 10, 12)
- Depends on: WI-029, WI-032 (the sidebar link joins the one WI-035 added)
- Work-spec: [WS-036](../work-specs/WS-036-projects-pages.md)

## Outcome

Every signed-in person opens "Projects" from the sidebar, sees the projects and opens one. A
Manager or Admin creates a project, and from its settings page edits its name and
description, archives and unarchives it, manages its columns, and restores deleted tasks.
All of it uses the projects, columns and tasks API of WI-028 to WI-032.

## Acceptance criteria

- [x] A "Projects" link in the sidebar, for every signed-in role, leads to `/projects`.
- [x] The list shows each active project's key and name, in pages with "Load more", with a
      switch to show archived projects instead. Opening a project goes to `/projects/KEY`.
- [x] A Manager or Admin creates a project from the list: key (2 to 10 uppercase letters and
      digits, said to be permanent), name and an optional description. A taken key is shown
      next to the field (`project_key_taken`).
- [x] `/projects/KEY` shows the project's key, name, description and an "Archived" badge, and
      a Settings link for a Manager or Admin. It is the place the board will take (WI-037).
- [x] `/projects/KEY/settings` is for a Manager or Admin; anyone else gets the not-found page.
- [x] Settings edit the name and description with the project's `version`; a stale version
      reloads the current values and says so. The key is shown and cannot be edited.
- [x] Settings archive a project after a confirmation and unarchive it. In an archived
      project every other control of the page is off.
- [x] Settings add a column (name and category), rename it, change its category, move it
      earlier or later, and delete it after a confirmation. A column that holds tasks
      (`column_not_empty`) and the last `done` column (`last_done_column`) are refused with a
      plain-words message.
- [x] Settings list the project's deleted tasks, in pages, and restore one; the restored task
      leaves the list.
- [x] Everything works by keyboard, has accessible names and announced outcomes, does not
      scroll the page sideways at phone width, and renders in the dark theme.
- [x] The full quality gate passes.

## Notes

The board itself, task creation on it and drag and drop are WI-037. Rendering a description
as Markdown arrives with `react-markdown` in WI-038; until then descriptions are plain text.
