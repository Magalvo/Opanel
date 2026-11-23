# WI-107 — Labels in the data model and API

- Status: In progress
- Work-track: [WT-07](../work-tracks/WT-07-backlog-priority-due-dates-labels.md) (item C)
- Depends on: none ([WI-101](WI-101-backlog-api.md) and [WI-102](WI-102-priority-due-date.md),
  which touch the same files, are done)
- Work-spec: [WS-107](../work-specs/WS-107-labels-api.md)

## Outcome

A project has labels, each with a name and a colour from a fixed palette. Members create
labels and apply them to tasks; Managers rename, recolour and delete them. Every task
answer carries its labels, every change is in the task history or the audit log, and open
boards hear of label changes live. No UI yet (item F).

## Acceptance criteria

- [ ] Migration `0021_labels` adds `labels` (name unique per project ignoring case, colour
      from the palette, `version`) and `task_labels` (task and label, both cascading).
- [ ] `GET /projects/{projectId}/labels` (`tasks:read`) lists every label of the project
      by name, with `nextCursor: null`. `POST` (`labels:write`) creates one;
      `PATCH /labels/{labelId}` (`labels:manage`, with `version`) renames and recolours;
      `DELETE /labels/{labelId}` (`labels:manage`) deletes. A duplicate name is
      `409 label_name_taken`; a 201st label is `409 too_many_labels`; a stale `version` is
      `409 version_conflict` with the current label; an archived project is
      `409 project_archived`; a project the agent cannot reach is `403`.
- [ ] Each label write is audited (`label.created`, `label.updated`, `label.deleted`) and
      sends `label.changed`.
- [ ] `labelIds` on task create and `PATCH` sets the task's whole set of labels: at most
      20, no repeats, all of the task's project, else `400` naming `labelIds`. It needs
      `labels:write` as well as `tasks:write`; a body without it needs only `tasks:write`,
      so an agent with `tasks:write` gets `403` only when it sends `labelIds`.
- [ ] A change of labels is one `field_changed` entry for `labels`, its old and new values
      lists of `{ id, name }`; a `created` entry names the labels it was created with.
- [ ] Every answer with a task (get, both lists, create, update, move, restore, a `409`'s
      `current`) has `labels: [{ id, name, colour }]` ordered by name; renaming or
      recolouring a label shows in them with no task write.
- [ ] Deleting a label in use removes it from every task that has it, in one transaction:
      each gets a `field_changed` entry with the Manager as actor and a new `version`, each
      live one sends `task.updated`, and the audit entry counts them. Measured with 1 000
      labelled tasks.
- [ ] The MCP tools do not offer `labelIds`, which no agent may send; the OpenAPI document
      is regenerated.

## Notes

WT-07 item C: decisions 8 to 12, questions 3, 5 and 6. Proposal P1 (`label.changed` in doc 0002) is applied by item G with the others.
