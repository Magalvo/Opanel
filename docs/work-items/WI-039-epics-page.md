# WI-039 — Epics page

- Status: Done
- Work-track: [WT-03](../work-tracks/WT-03-board-core.md) (decision 18)
- Depends on: WI-033 (epics API), WI-036 (the project pages), WI-038 (the Markdown renderer
  and editor)
- Work-spec: [WS-039](../work-specs/WS-039-epics-page.md)

## Outcome

`/projects/KEY/epics` lists the project's epics with their progress, dates and status. A
Manager or Admin creates an epic, edits its title, Markdown description and dates, and closes
and reopens it, all from this page. Everyone else reads the epics and their descriptions. It is
the last item of WT-03: with it a project can be run from the browser, from the board to the
epics, with every action done through the same API an agent uses.

## Acceptance criteria

- [x] A link "Epics" on the project page, for every role, leads to `/projects/KEY/epics`; the
      page is the not-found page for an unknown project.
- [x] The page lists open epics by default, with a switch to closed ones and to all, in pages
      with "Load more". Each epic shows its title, its status, its dates and its progress as
      done tasks over all tasks, with a bar a screen reader can read.
- [x] Opening an epic shows its description rendered as Markdown. A Manager or Admin sees an
      edit form in the same place; everyone else sees the text.
- [x] A Manager or Admin creates an epic (title, optional description, optional dates); a
      target date before the start date is refused next to the field.
- [x] A Manager or Admin edits an epic with its `version`; a stale version shows the current
      values and says so.
- [x] A Manager or Admin closes and reopens an epic. Closing one that still has tasks that are
      not done asks first and says how many.
- [x] A Viewer and a Member see no create, edit, close or reopen control; an archived project
      shows none either.
- [x] Keyboard use, accessible names, announced outcomes, phone width, the dark theme, no axe
      violations and no Content Security Policy violation.
- [x] The full quality gate passes.

## Notes

Listing an epic's tasks and filtering or grouping the board by epic are WT-08. Story points
join the progress in WT-10. Epics are never deleted (doc 0003).
