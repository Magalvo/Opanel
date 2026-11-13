# WI-026 — Teams, membership and the people directory

- Status: Done
- Work-track: [WT-03](../work-tracks/WT-03-board-core.md) (decisions 9 and 17)
- Depends on: WI-025
- Work-spec: [WS-026](../work-specs/WS-026-teams-and-people.md)

## Outcome

Through the API, any signed-in person can list people and teams and see a team's members,
and a Manager or Admin can create, rename and delete teams and add and remove their
members. Every change is in the audit log. The Teams page (WI-035) and task assignment
(WI-030) build on this.

## Acceptance criteria

- [x] `GET /api/v1/people` lists people (human accounts that have chosen a password) as
      `{ id, name, active }`, ordered by name, paginated, filtered by a name prefix with
      `q`; it never returns an email, role or invitation state.
- [x] `GET /api/v1/teams` and `GET /api/v1/teams/{teamId}` are readable by every human
      role; the latter includes the members.
- [x] A Manager or Admin creates, renames and deletes a team, and adds and removes members;
      a Viewer or Member gets `403` on each of these.
- [x] Team names are unique regardless of letter case; a duplicate is `409 team_name_taken`.
- [x] Only active people can be added to a team; a deactivated member stays a member and is
      shown with `active: false`.
- [x] Each change writes one audit entry with the acting account, in the same transaction.
- [x] The full quality gate passes, with the migration committed.

## Notes

Decision 9's rule that a team with assigned tasks cannot be deleted is enforced from
WI-030, which creates the tasks table (see WS-026, section 6).
