# WI-087 — The triage settings API

- Status: Approved (2026-11-20)
- Work-track: [WT-06](../work-tracks/WT-06-bug-reports-and-triage.md) (item B)
- Depends on: WI-086 (done)
- Work-spec: [WS-087](../work-specs/WS-087-triage-settings-api.md)

## Outcome

A project's triage settings, its triage team and the team of each layer, can be read by
anyone who reads the project and changed by Managers and Admins through
`/api/v1/projects/{projectId}/triage`, with the version rule, audited, and announced to
open pages. Deleting a team that triage uses says so and names the projects.

## Acceptance criteria

- [ ] `GET /api/v1/projects/{projectId}/triage` (`projects:read`) answers
      `{ triageTeamId, rules: { frontend, api, backend }, version }`, each a team id or
      `null`; `404` for an unknown project, `403` for a project outside an agent's
      restriction.
- [ ] Changing the settings needs `teams:manage` (Managers and Admins); a Member, a Viewer
      and any agent get `403`.
- [ ] A change sends the `version` it is based on; a stale one is
      `409 version_conflict` with the current settings, an archived project
      `409 project_archived`; the project's version grows by one.
- [ ] A team id that does not exist is a `400` naming the field (`triageTeamId`,
      `rules.api`, …); `null` clears a rule or the triage team.
- [ ] The change is one transaction, audited as `project.triage_updated` with the old and
      new team of each changed field, and publishes `project.changed`.
- [ ] Deleting a team that is a project's triage team or in a rule is
      `409 team_in_use` whose detail names those projects' keys; a team with tasks keeps
      today's message.
- [ ] The coverage test of `requireProjectAccess` covers the new service functions.
- [ ] The OpenAPI document describes both operations; the full quality gate passes.

## Notes

WT-06 decisions 4 and 5. The settings section of the project page is item G (WI-0xx).
