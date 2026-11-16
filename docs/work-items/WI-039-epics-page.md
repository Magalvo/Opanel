# WI-039 — Epics page: list, create, edit, close, progress

- Status: Done
- Work-track: [WT-03](../work-tracks/WT-03-board-core.md) (decisions 14 and 18)
- Depends on: WI-033, WI-036, WI-038 (the Markdown renderer and editor)
- Work-spec: [WS-039](../work-specs/WS-039-epics-page.md)

## Outcome

Every project gets an "Epics" tab at `/projects/KEY/epics`. Everyone signed in lists the
project's epics with their status, dates and progress (done tasks over total), and opens one
to read its Markdown description. A Manager or Admin creates epics, edits their title,
description and dates, and closes and reopens them. The page uses only the existing
`/api/v1` epic endpoints. With it, WT-03 has all its items, and its exit criteria are checked
and the track closed.

## Acceptance criteria

- [x] The project's navigation shows "Epics" to everyone, between Board and Settings, marked
      current on the epics page.
- [x] `/projects/KEY/epics` lists the open epics by title with status, start and target
      dates, and progress; a "Show" select also lists Closed and All; "Load more" while
      there are more.
- [x] Progress is a progress bar with an accessible name ("2 of 5 tasks done") and the
      numbers as text; an epic with no tasks says "No tasks".
- [x] Opening an epic shows its title, dates, status, progress and the description rendered
      safely as Markdown.
- [x] A person with `epics:manage` creates an epic (title, description with a preview,
      optional dates) and edits one, saving only the changes with the epic's `version`. A
      target date before the start date is refused at the field. A version conflict shows
      the current values and says so.
- [x] Closing and reopening send the new status with the `version`; closing an epic whose
      tasks are not all done asks first and says how many are left.
- [x] Members and Viewers, and everyone on an archived project, see the epics with no create,
      edit, close or reopen control; on an archived project a line says why.
- [x] The page works by keyboard, announces outcomes, has no accessibility violations in
      light and dark mode, and has no horizontal page scroll at phone width.
- [x] Every exit criterion of WT-03 is checked and recorded, and WT-03 is marked Done.
- [x] The full quality gate passes.

## Notes

An epic's list of tasks, and filtering the board by epic, belong to WT-08 (search and
filters); story points join progress in WT-10. Epics are never deleted (WS-033).
