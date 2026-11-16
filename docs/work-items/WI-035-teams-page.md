# WI-035 — Teams page

- Status: Approved
- Work-track: [WT-03](../work-tracks/WT-03-board-core.md) (decisions 9, 17; in scope: "Teams
  and team membership (API and an admin page)")
- Depends on: WI-026
- Work-spec: [WS-035](../work-specs/WS-035-teams-page.md)

## Outcome

In the browser, every signed-in person finds "Teams" in the sidebar, sees the list of teams
and each team's members. A Manager or Admin creates a team, renames it, adds and removes
members (picked from the people directory) and deletes a team that no task uses. Viewers and
Members see the same pages without the controls. The page uses only the existing `/api/v1`
team and people endpoints.

## Acceptance criteria

- [ ] The sidebar shows a "Teams" link to every signed-in person.
- [ ] `/teams` lists teams by name with their member count, and loads more on request.
- [ ] `/teams/{teamId}` shows the team's name and its members, a deactivated member marked
      as such; an unknown team shows a plain "not found" message.
- [ ] A Manager or Admin creates a team (a duplicate name is shown at the name field),
      renames it, adds an active person found by name, removes a member, and deletes a team
      after confirming; deleting a team that tasks use shows that it is in use and keeps it.
- [ ] Viewers and Members see no create, rename, delete, add or remove controls.
- [ ] The delete-team contract documents `409 team_in_use`, which the endpoint already
      answers; the OpenAPI document is regenerated.
- [ ] The pages work by keyboard, announce outcomes, have no accessibility violations in
      light and dark mode, and have no horizontal page scroll at phone width.
- [ ] The full quality gate passes.

## Notes

No live updates: another person's change shows after a reload (WT-04 adds live sync).
