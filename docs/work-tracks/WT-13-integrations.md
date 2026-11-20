# WT-13 — Integrations (optional add-ons)

- Status: In progress (2026-11-20): WI-093 is done; the add-ons CI job has not run yet
- Canonical docs: [0001](../canonical/0001-ai-qa-agents-and-triage.md) (agent accounts,
  tokens, scopes, the bug report contract), [0004](../canonical/0004-api-conventions.md)
  (the API add-ons call)

## Goal

Operators who already use other tools can, if they choose, connect them to Opanel through
optional add-ons. Each add-on is an external client of `/api/v1` with its own agent
account; Opanel works exactly the same with or without any of them.

## Rules for every add-on

- **Optional.** Opanel installs, runs and passes its quality gate with no add-on. Nothing
  in `src/`, the database schema, the app's configuration or its container image refers
  to an add-on or to the tool it connects.
- **A client of the public API.** An add-on authenticates with an agent token, has no
  database access and gets no permission an agent role does not already grant (hard rule
  6). It imports request and response schemas from `src/lib/schemas/`.
- **Separate.** Each add-on lives in `addons/<name>/`, with its own tests and CI job. An
  add-on with code to build is a workspace package and, when it is a service, has its own
  container image; one that is only configuration for another tool (WS-093) needs neither.
  Removing its directory leaves the app untouched.
- **Not canonical.** Canonical docs describe Opanel, not add-ons. Each add-on has its own
  guide. An add-on that needs a new API capability asks for it as a normal work-item of
  the app, justified on its own merits.

## In scope

- The `addons/` workspace convention (AGENTS.md section 3) and the CI job that builds and
  tests add-ons apart from the app.
- The PostHog add-on (WI-093): PostHog error-tracking issues become Opanel bug reports.

## Out of scope

- Anything that makes Opanel call out to another tool: webhooks and notifications are out
  of v1 (doc 0001 section 9, doc 0004).
- Running or scheduling AI agents, and any LLM call.
- Publishing add-ons to npm or a public registry.
- Further add-ons (for example Sentry or GitHub issues). Each is proposed as its own
  work-item in this track when wanted.

## Work-items

| Item                                            | Title                                                             | Status | Depends on |
| ----------------------------------------------- | ----------------------------------------------------------------- | ------ | ---------- |
| [WI-093](../work-items/WI-093-posthog-addon.md) | Optional PostHog add-on: error-tracking issues become bug reports | Done   | WI-089     |

## Exit criteria

- [x] Removing `addons/` leaves the app's quality gate and its image build green
      (checked by hand in WI-093).
- [ ] The add-ons' CI job runs separately from the app's, and passes.
- [x] Every add-on has an operator guide covering its agent account, token, deployment and
      removal.
