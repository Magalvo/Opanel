# WI-115 — WT-07 end-to-end flow, agents guide and exit check

- Status: In progress (approved by the owner on 2026-11-23)
- Work-track: [WT-07](../work-tracks/WT-07-backlog-priority-due-dates-labels.md) (item G)
- Depends on: [WI-109](WI-109-backlog-page.md), [WI-110](WI-110-priority-due-date-ui.md)
  and [WI-108](WI-108-labels-ui.md) (items D, E and F, all done)
- Work-spec: [WS-115](../work-specs/WS-115-planning-exit-check.md)

## Outcome

WT-07 is closed. One end-to-end test plans work as a team does: a Member fills the
backlog and gives a task a priority, a due date and a label in the UI, and an agent with a
token reads all of it through the API. `docs/agents.md` tells agent authors about the
backlog, priority, due dates and labels, and its doc check keeps that true. Docs 0002 and
0003 carry the approved proposals P1 to P3. Each WT-07 exit criterion is ticked, with a
link to the test that covers it.

## Acceptance criteria

- [ ] An end-to-end test, through the running app: a Member creates a task in the
      backlog, sets its priority, due date and a label in the task detail, and moves it to
      the board. A `worker_agent` with a token then reads the task with those fields,
      finds another task with `GET /api/v1/projects/{projectId}/backlog`, sets a priority
      (attributed to the agent in the history), moves a task to the backlog with
      `columnId: null`, and gets `403` when it sends `labelIds`.
- [ ] `docs/agents.md` describes a task's `columnId: null` (the backlog), the backlog
      endpoint, moving to and from the backlog, `priority`, `dueDate` and `labels`, that
      agents read labels but do not apply them, and the `label.changed` event.
- [ ] The doc check (`scripts/agents-guide.test.ts`) fails when the guide's priority values
      differ from `PRIORITIES`, or when it leaves out the backlog endpoint.
- [ ] Doc 0002's event table has the `label.changed` row (P1). Doc 0003 section 5 says
      where a new task goes and that a backlog task has no column (P2). Doc 0003 section 4
      says agents with `tasks:write` may set priority and the triage pipeline never does
      (P3).
- [ ] Every WT-07 exit criterion is ticked, with a link to the test that covers it. A
      criterion found without a test gets one, failing first.
- [ ] The full quality gate passes, and `pnpm db:generate` and `pnpm openapi:generate`
      leave no diff. WT-07's `Status:` line says Done.

## Notes

WT-07 item G: proposals P1 to P3, decision 15, and the exit criteria. No new endpoint, no
migration, no change to `/api/v1` and no UI change, unless the exit check finds a gap.
