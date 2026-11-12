# Opanel docs index

The spec system is described in `AGENTS.md` section 4. This file is the index: every doc is
listed here with its current status. Update it whenever a doc is added or changes status.

Statuses: `Draft` → `Proposed` → `Approved` → `In progress` → `Done` (or `Superseded`).

## Canonical docs (`canonical/`)

| Doc | Title | Status |
| --- | ----- | ------ |
| [0001](canonical/0001-ai-qa-agents-and-triage.md) | AI QA agents: identity, authentication and automated triage | Approved |
| [0002](canonical/0002-realtime-sync.md) | Real-time board sync | Approved |

## Work-tracks (`work-tracks/`)

| Track | Title | Status |
| ----- | ----- | ------ |
| [WT-01](work-tracks/WT-01-project-boilerplate.md) | Project boilerplate | Proposed |

Planned next, not yet drafted:

- WT-02 Accounts and human auth
- WT-03 Projects, teams, columns, epics, tasks (kanban core)
- WT-04 Real-time board sync
- WT-05 Agent accounts and API tokens
- WT-06 Bug reports and automated triage

## Work-items (`work-items/`) and work-specs (`work-specs/`)

| Item | Title | Item status | Spec | Spec status |
| ---- | ----- | ----------- | ---- | ----------- |
| [WI-001](work-items/WI-001-app-skeleton.md) | App skeleton: Next.js, strict TypeScript, Vitest | Proposed | [WS-001](work-specs/WS-001-app-skeleton.md) | Proposed |

WI-002 to WI-010 are outlined in WT-01 and get their own files when they are started.
