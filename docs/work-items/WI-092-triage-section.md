# WI-092 — The project's "Triage" settings section

- Status: Done (2026-11-20)
- Work-track: [WT-06](../work-tracks/WT-06-bug-reports-and-triage.md) (item G)
- Depends on: WI-087 (done)
- Work-spec: [WS-092](../work-specs/WS-092-triage-section.md)

## Outcome

A project's settings page has a "Triage" section where a Manager or an Admin chooses the
project's triage team and the team of each layer (`frontend`, `api`, `backend`), each a
team or none, and saves them through `PATCH /api/v1/projects/{projectId}/triage`. The
section follows changes made elsewhere live, and a concurrent change is shown the way the
page's other sections show one.

## Acceptance criteria

- [x] The settings page shows a "Triage" region with four labelled selects, "Triage team",
      "Frontend", "API" and "Backend", each listing "No team" and every team by name, set
      from `GET /api/v1/projects/{projectId}/triage`; a hint says that bugs of an unknown
      layer, or of a layer with no team, go to the triage team.
- [x] "Save" sends `PATCH /api/v1/projects/{projectId}/triage` with the four values
      (`null` for "No team") and the version the section was loaded with, then shows the
      answer and says "Saved.".
- [x] A `409 version_conflict` shows the `current` settings and says that someone else
      changed the project; a `409 project_archived` says the project is archived; a `400`
      for a team that no longer exists says so and reads the teams again; any other failure
      says "Could not save. Try again." and keeps the choices.
- [x] After its own save the section brings the page's project to the new version, so the
      Details form, with no unsaved edits, saves without a conflict.
- [x] When the page's project gets a newer version (someone else's change, or a save in
      another section), the section reads the settings again if it has no unsaved choices;
      with unsaved choices it keeps them and its version, says that saving will show the
      other version first, and the next save gets the conflict above. A reconnect reads the
      settings and the teams again.
- [x] An archived project shows the section read-only. Someone without `teams:manage`
      sees it read-only (as WS-092 question 1 settles).
- [x] The section uses only `/api/v1` (`GET /teams`, `GET`/`PATCH /projects/…/triage`).
- [x] Unit tests cover each criterion above; an end-to-end test sets the triage team and a
      layer's team as a Manager and finds them after a reload. The full quality gate passes.

## Notes

WT-06 decisions 4 and 15; WS-087 (the API); WS-036 and WS-049 (the settings page and its
live updates). Reports and severity in the task detail are item F (WI-091).
