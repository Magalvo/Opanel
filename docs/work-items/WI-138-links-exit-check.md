# WI-138 — Sub-tasks and links end to end, the agents guide, the exit check

- Status: Done (approved by the owner on 2026-11-27, with WS-138; done on 2026-11-27)
- Work-track: [WT-09](../work-tracks/WT-09-subtasks-and-links.md) (item F)
- Depends on: [WI-135](WI-135-subtasks-ui.md) (item C), [WI-136](WI-136-links-ui.md) (item
  D) and [WI-137](WI-137-mcp-link-tools.md) (item E), all done
- Work-spec: [WS-138](../work-specs/WS-138-links-exit-check.md)

## Outcome

WT-09 is closed. One end-to-end test splits and connects work as a team does: a Member
makes sub-tasks and links tasks of two projects in the UI. A `worker_agent` adds and
removes a link of each type through the API. A `qa_agent` and a restricted agent are
refused. `docs/agents.md` tells agent authors about sub-tasks and links, and its doc check
keeps that true. Doc 0003 carries the approved proposals P1 to P3. Each WT-09 exit
criterion is ticked, with a link to the test that covers it.

## Acceptance criteria

- [x] An end-to-end test, through the running app:
  - A Member makes a task a sub-task and adds a link across two projects in the UI.
  - A `worker_agent`, with its token, adds and removes a link of each of the four types
    across the two projects. It reads the sub-task's parent and the parent's
    `done/total`.
  - The Member's open page follows the agent's link with no reload, and the timeline names
    the agent.
  - A `qa_agent` gets `403` when it links.
  - An agent restricted to one project gets `403` when it links to the other project, and
    does not see that project's task in `links`.
- [x] `docs/agents.md` has a section "Sub-tasks and links". It describes `parentId` on
      create and edit, one level, the epic that follows the parent, `parent`, `subtasks`
      and `subtaskList`, the link types and directions, and the two link endpoints with
      `tasks:write` on both tasks. It also names the codes `has_subtasks`,
      `too_many_subtasks`, `link_exists` and `too_many_links`.
- [x] The doc check fails when that section is missing, when its link types differ from
      the API's, when it leaves out the link endpoints, or when it names a code that does
      not exist.
- [x] Doc 0003 carries P1 and P2 in section 7 and P3 in section 3, and its header names
      WT-09.
- [x] Every WT-09 exit criterion is ticked, with a link to the test that covers it. A
      criterion found without a test gets one. That test first fails when the behaviour is
      missing, or, if the behaviour is already there, when its expectation is made wrong.
- [x] The full quality gate passes, and `pnpm db:generate` and `pnpm openapi:generate`
      leave no diff. WT-09's `Status:` line says Done.

## Notes

- No feature is added. A gap that needs more than a test is raised with the owner before
  it is fixed, and may become its own work-item.
