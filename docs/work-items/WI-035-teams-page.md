# WI-035 — Teams page

- Status: Done
- Work-track: [WT-03](../work-tracks/WT-03-board-core.md) (decisions 8, 9, 17)
- Depends on: WI-026
- Work-spec: [WS-035](../work-specs/WS-035-teams-page.md)

## Outcome

Every signed-in person opens "Teams" from the sidebar and sees the teams and who is in each.
A Manager or Admin also creates, renames and deletes teams and adds and removes members,
from the same page, using the teams API of WI-026. The page is built from the same endpoints
agents will use.

## Acceptance criteria

- [x] A "Teams" link in the sidebar, for every signed-in role, leads to `/teams`.
- [x] The page lists teams by name with their member count, in pages with "Load more".
- [x] Opening a team shows its members by name, with a "Deactivated" badge for a member whose
      account is deactivated.
- [x] A Manager or Admin creates a team; a name already taken, ignoring case, is shown next
      to the field (`team_name_taken`).
- [x] A Manager or Admin renames a team, with the same name check.
- [x] A Manager or Admin deletes a team after a confirmation; a team that tasks are assigned
      to is refused and the page says so in plain words (`team_in_use`).
- [x] A Manager or Admin adds an active person found by name and removes a member.
- [x] A Member or Viewer sees no create, rename, delete, add or remove control.
- [x] The `409 team_in_use` of deleting a team is documented in the OpenAPI document.
- [x] The page works by keyboard, has accessible names and announced outcomes, does not
      scroll the page sideways at phone width, and renders in the dark theme.
- [x] The full quality gate passes.

## Notes

The audit of this item found one contract gap: the service already answers
`409 team_in_use` when deleting a team, but `deleteTeamContract` does not list it. WS-035
adds it, which changes the generated OpenAPI document and no behaviour.
