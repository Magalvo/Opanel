# WI-073 — Project restrictions enforced in every service, with the coverage test

- Status: Proposed
- Work-track: [WT-05](../work-tracks/WT-05-agent-accounts-and-tokens.md) (item D)
- Depends on: [WI-071](WI-071-agent-data-model.md) (done)
- Work-spec: [WS-073](../work-specs/WS-073-project-restrictions.md)

## Outcome

An agent restricted to a list of projects reads and writes only those projects, as doc
0001 section 4 and WT-05 decision 7 say. Every service function that acts inside a project
(on the project itself, or on one of its columns, tasks, epics or comments) refuses another
project with `403 forbidden`; the projects list leaves other projects out; an events stream
of another project cannot be opened, and one that is open closes at the next heartbeat
once the project leaves the agent's list.

A coverage test lists every exported service function and fails when a new one is not
classified, or when a project-scoped one does not refuse a project outside the actor's
list. WT-06 to WT-10 add services that the test then forces to take a position.

Humans (`projectIds: null`) and agents with all projects are unaffected. Teams and people
are not project-scoped. Nothing changes in the API contract: `403` is already a declared
response of every non-public operation.

## Acceptance criteria

- [ ] `requireProjectAccess(actor, projectId)` throws the `forbidden` API error for an agent
      whose `projectIds` does not contain the project, and does nothing for a human, for an
      agent with all projects, or for a listed project.
- [ ] Every project-scoped service function (section 4 of WS-073) answers `403` to a
      restricted agent for a project outside its list, after the permission check and after
      an unknown id's `404`, and before any other refusal such as `409 project_archived`;
      nothing is written.
- [ ] The same functions work as before for a project in the agent's list, for an agent
      with all projects, and for every human role.
- [ ] `GET /projects` (`listProjects`) returns only the agent's projects, archived or not,
      with pagination intact; an agent restricted to no project gets an empty page.
- [ ] Opening the events stream of a project outside the list answers `403`; an open stream
      closes at the next heartbeat when the actor no longer reaches its project.
- [ ] The coverage test fails when an exported service function is not classified, and
      when a project-scoped one does not refuse a restricted actor; it passes on `main`.
- [ ] No migration and no API contract change. The full quality gate passes.

## Notes

- A token reaching the API is item B; an end-to-end check through `Authorization: Bearer`
  is item H. This item tests the services with agent actors built from real rows
  (`createTestAgent`, `loadAgentActor`), which is where the rule lives.
- Agents never hold `projects:manage` or `epics:manage` (decision 1), so the project,
  column and epic writes are unreachable for them today; they still call the helper, so
  the rule does not depend on that.
