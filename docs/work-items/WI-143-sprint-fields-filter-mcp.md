# WI-143 — The task's sprint in the UI, the sprint filter, the MCP tool

- Status: Proposed
- Work-track: [WT-10](../work-tracks/WT-10-sprints-and-story-points.md) (item F)
- Depends on: WI-141 (tasks in sprints) and WI-142 (starting and completing), both done
- Work-spec: [WS-143](../work-specs/WS-143-sprint-fields-filter-mcp.md)

## Outcome

On the task page of a project with sprints, a Member sees and changes a task's sprint, and
the page explains every refusal of the sprint rules in words. The timeline reads sprint
changes. The backlog and the list view filter by sprint (the active one, none, or a named
one), and the list view shows each task's sprint. An AI assistant lists a project's sprints
with `opanel_list_sprints` (WT-10 decisions 15 and 16, proposal P4).

## Acceptance criteria

- [ ] The task page shows "Sprint" in a project with sprints: the sprint's name and state,
      or "No sprint"; a Member changes it among the active and planned sprints, and the
      page follows the task wherever the change puts it.
- [ ] A sub-task's sprint is shown and not editable, with a note that it follows its
      parent; a completed sprint's task shows its sprint read-only.
- [ ] `no_active_sprint`, `subtask_follows_parent`, `sprint_completed` and
      `sprints_disabled`, from the sprint field or the column select, each show a sentence
      that says what to do.
- [ ] The timeline reads a sprint change ("put it in the sprint Sprint 4", "took it out
      of the sprint …", "changed the sprint from … to …"), and a deleted sprint as "a
      deleted sprint".
- [ ] The filter bar of the backlog and the list view has "Sprint": "Active sprint", "No
      sprint" and, with one project, its sprints; the chip names the choice; the filter
      lives in the URL.
- [ ] The list view has a "Sprint" column.
- [ ] `opanel_list_sprints` answers one page of a project's sprints with their state and
      progress, filtered by state; it needs `tasks:read`.
- [ ] Doc 0005 section 4, `docs/mcp.md` and `mcp/README.md` list the tool; a Viewer sees
      every sprint shown here and changes nothing; the full quality gate passes.

## Notes

- The backlog's sprint sections, the board's sprint header and the start and complete
  dialogs are item E; `docs/agents.md` on sprints is item G.
