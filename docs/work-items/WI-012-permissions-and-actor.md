# WI-012 — Permission catalogue, human roles and the `Actor` type

- Status: Proposed
- Work-track: [WT-02](../work-tracks/WT-02-accounts-and-permissions.md)
- Depends on: none
- Work-spec: [WS-012](../work-specs/WS-012-permissions-and-actor.md)

## Outcome

The permission system of canonical docs 0001 (section 4) and 0003 (section 3) exists as
pure, tested code: one catalogue of named permissions, the four human roles as fixed
bundles of them, the `Actor` type every service function will take, and the functions that
ask "may this actor do this?".

Nothing in this item touches the database, the HTTP layer or the UI. It is the vocabulary
that WI-013 to WI-021 and every later work-track are written in, so it is built and agreed
first, with no dependency.

## Acceptance criteria

- [ ] There is one Zod schema listing every permission, and one listing the four human
      roles (`admin`, `manager`, `member`, `viewer`); their TypeScript types are inferred
      from them.
- [ ] The role-to-permission mapping reproduces the table in doc 0003 section 3 exactly:
      a test encodes that table and fails if any role gains or loses a permission.
- [ ] Roles are cumulative: every permission of Viewer is held by Member, of Member by
      Manager, of Manager by Admin.
- [ ] A human `Actor` can be built from an account id and a role, and carries exactly the
      permissions of that role. An unknown role is rejected, never given a default.
- [ ] `can(actor, permission)` answers whether the actor holds the permission.
- [ ] `requirePermission(actor, permission)` returns normally when allowed and throws the
      `forbidden` API error of doc 0004 when not. The error does not reveal which
      permissions the actor holds.
- [ ] The "Members may delete only tasks they reported; Managers and Admins any" rule of
      doc 0003 section 3 is one tested function.
- [ ] The permission an agent will need for bug reports (`reports:write`) is in the
      catalogue but in no human role.
- [ ] Docs 0001 and 0003 describe the catalogue and the `Actor` shape as implemented.
- [ ] The full quality gate passes.

## Notes

Agent roles (`qa_agent`, `worker_agent`), agent scopes stored per account, and the
per-project restriction of agents belong to WT-05. The `Actor` type is shaped so that
adding an agent variant there does not change any code that calls `can` or
`requirePermission`.

Enforcement of the board permissions (who may edit a task, and so on) is not part of this
item: each work-track that builds a feature calls `requirePermission` for it.
