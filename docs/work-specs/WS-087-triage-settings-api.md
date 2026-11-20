# WS-087 — The triage settings API

- Status: Approved (by the owner on 2026-11-20, questions 1 to 4 as recommended: PATCH)
- Work-item: [WI-087](../work-items/WI-087-triage-settings-api.md)
- Canonical docs: [0001](../canonical/0001-ai-qa-agents-and-triage.md) section 6 (routing);
  [0003](../canonical/0003-task-management.md) section 3 (Managers edit routing rules);
  [0004](../canonical/0004-api-conventions.md) sections 4, 6 and 7;
  [WT-06](../work-tracks/WT-06-bug-reports-and-triage.md) decisions 4 and 5;
  [WS-086](WS-086-triage-data-model.md) (the tables)

## Approach

### 1. A conflict with doc 0004, raised first (hard rule 11)

WT-06 decision 4 says `GET` and **`PUT`** `/projects/{projectId}/triage`. Doc 0004 section
6 says "`PUT` is not used in v1". The two disagree, so this spec does not pick silently
(question 1). It proposes **`PATCH`** with the usual rules of doc 0004 section 6: an
absent field is left as it is, `null` clears it. Nothing else in this spec depends on the
choice: with `PUT`, the body would require every field and doc 0004 would gain one
sentence.

### 2. The contract (`src/lib/schemas/triage.ts`, new)

```ts
const teamRef = z.uuid().nullable();
export const triageSettingsSchema = z
  .strictObject({
    triageTeamId: teamRef,
    rules: z.strictObject({ frontend: teamRef, api: teamRef, backend: teamRef }),
    version: z.int().min(1), // the project's version
  })
  .meta({ id: "TriageSettings" });

export const updateTriageRequestSchema = z
  .strictObject({
    triageTeamId: teamRef.optional(),
    rules: z
      .strictObject({ frontend: teamRef, api: teamRef, backend: teamRef })
      .partial()
      .optional(),
    version: z.int().min(1),
  })
  .meta({ id: "UpdateTriageRequest" });
```

`rules` uses the layers of `ROUTED_LAYERS` (WS-086); `unknown` is not a key, since it
always goes to the triage team.

| Operation                                   | Access          | Answers                                                                                                             |
| ------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/projects/{projectId}/triage`   | `projects:read` | `200 TriageSettings`; `400` bad path; `404`; `401`/`403`/`429` added by the document                                |
| `PATCH /api/v1/projects/{projectId}/triage` | `teams:manage`  | `200 TriageSettings`; `400` body or unknown team; `404`; `409` version conflict or `project_archived`; `413`; `415` |

The `409` is `versionConflictResponse(triageSettingsSchema, ["project_archived"])`
(WS-083), so `current` is the settings as they are now.

### 3. The version (WT-06 decision 4)

The settings carry the **project's** version, and a change bumps it, as decision 4
decided. A Manager editing the project's name and another editing its triage at the same
time therefore conflict, and the second sees the current state and retries: the project
page already handles `version_conflict` (WS-036). A version of its own would let the two
edits pass but adds a column and a second rule to learn (question 2).

### 4. The service (`src/server/services/triage.ts`, new)

- `getTriage(actor, projectRef)`: `requirePermission(actor, "projects:read")`; the
  project (`404`), `requireProjectAccess`; reads `triage_team_id`, `version` and the rows
  of `routing_rules`; a missing row is `null`.
- `updateTriage(actor, projectRef, input)`: `requirePermission(actor, "teams:manage")`;
  in one transaction:
  1. the project (`404`), `requireProjectAccess`;
  2. every team id given (not `null`) must exist, else `fieldError(<path>, "There is no
such team.")`, as `assertTeam` does for tasks (`services/tasks.ts:175-178`);
  3. `update projects set triage_team_id = …, version = version + 1, updated_at = now()
where id = … and version = $version and archived_at is null returning …`; no row:
     `404`, `409 project_archived` or `versionConflict(current settings)`, as
     `updateProject` does (`services/projects.ts:260-272`);
  4. for each layer given: `delete` its rule when `null`, else `insert … on conflict
(project_id, origin_layer) do update set team_id = excluded.team_id`;
  5. `recordAudit`: `project.triage_updated`, entity `project`, `data: { changed: { <field>:
{ from, to } } }` with team ids (not secret), only the fields that changed; nothing
     when none did;
  6. `publishProjectChanged` (WS-045), so open project pages read the project again.

A request that changes nothing still bumps the version, like `updateProject`.

### 5. Teams in use (WT-06 decision 5)

`deleteTeam` maps any reference violation to `teamInUse()`, whose detail speaks of tasks
(`errors.ts:120-124`). It now reads the violated constraint: for
`projects_triage_team_id_teams_id_fk` or `routing_rules_team_id_teams_id_fk` it answers
`teamInUse("This team handles triage in OPA, WEB. Choose another team in their triage
settings first.")`, the keys of every project that names it (read after the failed
delete, in a new statement); for a task it keeps today's detail. The code stays
`team_in_use`, so clients branching on it are unchanged.

### 6. Access coverage

`project-access.integration.test.ts` lists every exported service function and fails on
one it does not classify (WS-073). `triage.getTriage` and `triage.updateTriage` join
`PROJECT_SCOPED`, each with a call that a restricted agent makes on another project and
that must answer `403`.

## Files

| Path                                                            | Change                                      |
| --------------------------------------------------------------- | ------------------------------------------- |
| `src/lib/schemas/triage.ts`, `.test.ts`                         | create: schemas and contracts (tests first) |
| `src/lib/openapi/contracts.ts`                                  | modify: register both contracts             |
| `src/server/services/triage.ts`, `triage.integration.test.ts`   | create (tests first)                        |
| `src/app/api/v1/projects/[projectId]/triage/route.ts`, its test | create: `GET`, `PATCH` (tests first)        |
| `src/server/services/teams.ts`, `teams.integration.test.ts`     | modify: the triage detail of `team_in_use`  |
| `src/server/services/project-access.integration.test.ts`        | modify: the two functions                   |
| `docs/api/openapi.json`                                         | regenerate                                  |
| `docs/README.md`, WT-06, WI-087, WS-087                         | modify: statuses                            |

No migration, no new dependency.

## Data model changes

None (WS-086 created the tables).

## API contract

Section 2. Additive: two new operations, one new schema each for the body and the answer.

## Test plan (written first, in this order)

| #   | Level       | Test                                                                                                                                                              | Covers criterion |
| --- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit        | `updateTriageRequestSchema`: requires `version`; refuses `rules.unknown`, an unknown key, a non-uuid; accepts `null` and absent fields                            | 4                |
| 2   | integration | `getTriage`: a new project answers all `null` and its version; after rows are written by SQL, the teams                                                           | 1                |
| 3   | integration | `updateTriage` by a Manager: sets the triage team and two rules, clears one, leaves the absent one; the version grows by one; the rows are as expected            | 3, 4             |
| 4   | integration | a stale version is `409 version_conflict` with `current` the settings; an archived project is `409 project_archived`; an unknown team is `400` naming `rules.api` | 3, 4             |
| 5   | integration | a Member, a Viewer and an agent with every scope get `403` on the change; a Viewer reads; a restricted agent reading another project gets `403`                   | 1, 2             |
| 6   | integration | the audit entry lists only the changed fields with `from` and `to`; a `project.changed` event is published with the new version                                   | 5                |
| 7   | integration | `deleteTeam` of a triage team names `OPA` and `WEB` in its detail; of a team with tasks keeps today's detail; both are `team_in_use`                              | 6                |
| 8   | integration | the route: `GET` and `PATCH` through `route()`, with a cookie and with a token; `PATCH` without `Origin` is `403`; an unknown query parameter is `400` (WS-083)   | 1 to 5           |
| 9   | integration | `project-access`: the coverage test classifies both functions; the restricted calls answer `403`                                                                  | 7                |
| 10  | unit        | the OpenAPI document: both operations, `PATCH`'s `409` is `anyOf` `TriageSettingsVersionConflict` and `Problem`; `docs/api/openapi.json` regenerated              | 8                |
| 11  | gate        | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`                                                                                                           | 8                |

## Risks and open questions

For the owner:

1. **`PATCH` rather than the `PUT` of WT-06 decision 4**, because doc 0004 section 6 says
   `PUT` is not used in v1 (section 1). The alternative is `PUT` with the whole document
   and a one-line amendment to doc 0004. **Recommend: `PATCH`, and WT-06 decision 4 is
   read as "the triage settings are changed with the version rule".**
2. **The settings share the project's version** (section 3), as decision 4 says, rather
   than a version of their own. **Recommend: as decided.**
3. **Agents with `projects:read` may read the settings** (`GET`), which tells a QA agent
   which team its layers go to. **Recommend: allowed.**
4. **The `team_in_use` detail names the projects** (section 5): the keys of projects are
   visible to every signed-in person (doc 0003 section 3). **Recommend: as proposed.**

## Deviations from the approved spec

None yet.

## Implementation record

Not started.
