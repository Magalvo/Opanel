# WS-012 — Permission catalogue, human roles and the `Actor` type

- Status: Approved (by the owner on 2026-11-12, all open questions accepted as proposed)
- Work-item: [WI-012](../work-items/WI-012-permissions-and-actor.md)
- Canonical docs: [0001](../canonical/0001-ai-qa-agents-and-triage.md) section 4,
  [0003](../canonical/0003-task-management.md) section 3,
  [0004](../canonical/0004-api-conventions.md) section 7; `AGENTS.md` sections 3 and 6

## Approach

Three small pure modules. None uses the database, `Request` or `Response`.

1. **Catalogue and role names** (`src/lib/schemas/permissions.ts`). `permissionSchema` is
   a Zod enum of every permission; `humanRoleSchema` is the enum of the four roles. Both
   live in `lib/schemas` because the People page (WI-020) needs the role list and the
   API will validate role changes with it (WI-018).

2. **Role bundles** (`src/server/auth/roles.ts`). `HUMAN_ROLE_PERMISSIONS` maps each role
   to a readonly set of permissions, built cumulatively (Viewer, then Member = Viewer +
   more, and so on) so the hierarchy cannot drift. `permissionsForRole(role)` returns the
   set; a value that is not a `HumanRole` throws, so a bad database value cannot become a
   silent default.

3. **Actor and checks** (`src/server/auth/actor.ts`).
   - `Actor` is `{ accountId: string; kind: "human"; role: HumanRole; permissions:
ReadonlySet<Permission> }`. It is a discriminated union on `kind`; WT-05 adds the
     `"agent"` member. Code that uses only `permissions` is unaffected by that addition.
   - `humanActor({ accountId, role })` builds one, with the permissions of the role.
   - `can(actor, permission)` is `actor.permissions.has(permission)`.
   - `requirePermission(actor, permission)` throws `forbidden()` from
     `src/server/http/errors.ts` (services may throw API errors, WS-011). The detail is
     fixed text; it names neither the permission nor the actor's role.
   - `canDeleteTask(actor, { reporterId })` is true when the actor holds
     `tasks:delete_any`, or holds `tasks:delete_own` and `reporterId === actor.accountId`.

### The catalogue

Permissions use the `resource:action` form of doc 0001. The first five are the agent
scopes already defined there, kept with their meaning; the others are the rows of doc 0003
that doc 0001 does not cover.

| Permission            | Allows                                                                                                                  | Viewer | Member | Manager | Admin |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- | :----: | :----: | :-----: | :---: |
| `projects:read`       | Read projects, boards, teams, routing rules                                                                             |   ✓    |   ✓    |    ✓    |   ✓   |
| `tasks:read`          | Read tasks, epics, comments, history                                                                                    |   ✓    |   ✓    |    ✓    |   ✓   |
| `tasks:write`         | Create, edit, move tasks and sub-tasks; assign; set priority, due date, points; link; put in or out of a sprint/backlog |        |   ✓    |    ✓    |   ✓   |
| `comments:write`      | Comment on tasks                                                                                                        |        |   ✓    |    ✓    |   ✓   |
| `reports:write`       | Submit bug reports (agents only; in no human role)                                                                      |        |        |         |       |
| `labels:write`        | Apply labels; create new labels                                                                                         |        |   ✓    |    ✓    |   ✓   |
| `tasks:delete_own`    | Soft-delete tasks one reported                                                                                          |        |   ✓    |    ✓    |   ✓   |
| `tasks:delete_any`    | Soft-delete any task; restore deleted tasks                                                                             |        |        |    ✓    |   ✓   |
| `projects:manage`     | Create, edit, archive projects; configure columns                                                                       |        |        |    ✓    |   ✓   |
| `epics:manage`        | Create, edit, close epics                                                                                               |        |        |    ✓    |   ✓   |
| `sprints:manage`      | Enable sprints on a project; create, start, complete sprints                                                            |        |        |    ✓    |   ✓   |
| `labels:manage`       | Rename and delete labels                                                                                                |        |        |    ✓    |   ✓   |
| `teams:manage`        | Manage teams and membership; edit triage routing rules                                                                  |        |        |    ✓    |   ✓   |
| `accounts:manage`     | Invite, deactivate, reactivate, change role of human accounts; generate reset links                                     |        |        |         |   ✓   |
| `agents:manage`       | Create and manage agent accounts and API tokens                                                                         |        |        |         |   ✓   |
| `organization:manage` | Organization settings                                                                                                   |        |        |         |   ✓   |

Why finer than one permission per table row: doc 0003 gives Members deletion of their own
tasks only, and Managers (not Members) rename and delete labels while Members create and
apply them, so those rows need two permissions each. Everything else is one permission per
row, so that a later work-track enforcing a row calls exactly one name.

### Doc changes in this item

- Doc 0001 section 4 says the `Actor` is `{ accountId, kind, role, scopes }`, and doc 0003
  section 3 says "permission". This spec uses **`permissions`** for the field and in code,
  and moves doc 0001's scope table into one catalogue (above). Doc 0001 and doc 0003 are
  updated to say so and to link to the catalogue as the single list.
- `docs/README.md` and WT-02 statuses.

## Files

| Path                                             | Change                                                      |
| ------------------------------------------------ | ----------------------------------------------------------- |
| `src/lib/schemas/permissions.ts`                 | create                                                      |
| `src/lib/schemas/permissions.test.ts`            | create (written first)                                      |
| `src/server/auth/roles.ts`                       | create                                                      |
| `src/server/auth/roles.test.ts`                  | create (written first)                                      |
| `src/server/auth/actor.ts`                       | create                                                      |
| `src/server/auth/actor.test.ts`                  | create (written first)                                      |
| `docs/canonical/0001-ai-qa-agents-and-triage.md` | modify: `Actor` field name, scope table points to catalogue |
| `docs/canonical/0003-task-management.md`         | modify: section 3 links to the catalogue                    |
| `docs/README.md`, `docs/work-tracks/WT-02-*.md`  | modify: statuses                                            |

No new dependencies. `src/server/auth/` is in the layout of `AGENTS.md` section 3 but does
not exist yet; this item creates it.

## Data model changes

None. The role stored on `accounts` arrives in WI-013 and is validated with
`humanRoleSchema`.

## API contract

None.

## Test plan (written first, in this order)

| #   | Level | Test                                                                                                                                                | Covers criterion         |
| --- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 1   | unit  | `permissionSchema` accepts every listed permission and rejects an unknown string, an empty string and a wrong case                                  | one schema               |
| 2   | unit  | `humanRoleSchema` accepts exactly `admin`, `manager`, `member`, `viewer` and rejects `agent`, `owner`, `""`                                         | one schema               |
| 3   | unit  | table-driven: the expected role × permission matrix of doc 0003 section 3, written out literally in the test, equals `HUMAN_ROLE_PERMISSIONS`       | matches doc 0003         |
| 4   | unit  | Viewer ⊂ Member ⊂ Manager ⊂ Admin as sets                                                                                                           | cumulative roles         |
| 5   | unit  | `reports:write` is in the catalogue and in no human role; every catalogue permission is held by Admin except `reports:write`                        | agent-only permission    |
| 6   | unit  | `permissionsForRole` returns the bundle for each role and throws for an unknown value (`"root"`, `undefined`)                                       | no silent default        |
| 7   | unit  | `humanActor` returns `kind: "human"`, the given id and role, and the role's permissions                                                             | building an actor        |
| 8   | unit  | `can` is true for held and false for not-held permissions, for each role at one boundary (Viewer `tasks:write`, Manager `accounts:manage`)          | `can`                    |
| 9   | unit  | `requirePermission` returns for an allowed permission and throws an `ApiError` with status `403` and code `forbidden` otherwise                     | `requirePermission`      |
| 10  | unit  | the thrown error's detail contains neither the permission name nor the role name                                                                    | no permission disclosure |
| 11  | unit  | `canDeleteTask`: Viewer never; Member only when `reporterId` equals own id; Manager and Admin always                                                | delete rule              |
| 12  | unit  | a catalogue guard: a permission added to `permissionSchema` without being placed in some bundle, or deliberately listed as agent-only, fails a test | catalogue stays complete |
| 13  | gate  | `typecheck`, `lint`, `format:check`, `test`, `test:e2e`                                                                                             | gate                     |

All unit tests; no database is involved, so there are no integration or end-to-end tests
in this item. Both are exercised by the first endpoint that calls `requirePermission`
(WI-015).

## Risks and open questions

For the owner's decision before approval:

1. **Granularity of the catalogue.** I split two rows of doc 0003 into two permissions
   (deleting, labels) and kept the rest at one permission per row, with `tasks:write`
   covering assignment, priority, linking and sprint membership. A finer split (for
   example `tasks:assign`) is easy to add later; splitting after endpoints enforce the
   coarse one is not. Is the coarse set acceptable for v1?
2. **`permissions` vs `scopes`.** Doc 0001 names the `Actor` field `scopes`. I propose
   `permissions` everywhere, since doc 0003 already says one mechanism, and amending
   doc 0001 as above (hard rule 11: I will not pick silently).
3. **Who can submit bug reports.** `reports:write` is held by no human role. Is that
   intended, or should Admins (or Managers) be able to file one by hand through the API?
4. **Restoring deleted tasks** is folded into `tasks:delete_any` (doc 0003: restore is a
   Manager action). A separate `tasks:restore` is the alternative.
5. **Error detail.** `requirePermission` says only that the action is not permitted,
   without naming the missing permission. This is safer, but gives agent developers less
   to debug with. Naming it is a one-line change if preferred.
