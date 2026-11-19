# WI-077 — The Agents page

- Status: Done (2026-11-19)
- Work-track: [WT-05](../work-tracks/WT-05-agent-accounts-and-tokens.md) (item F)
- Depends on: WI-075 (done: the Admin API for agents and tokens)
- Work-spec: [WS-077](../work-specs/WS-077-agents-page.md)

## Outcome

An Admin manages agents in the web app, through the same `/api/v1/agents` endpoints an
agent author can read in the OpenAPI document. The Admin can:

- see every agent, with its role, status and when it was last seen;
- create an agent, choosing its role, scopes and projects;
- change any of these, disable the agent or re-enable it;
- create a token, which is shown once with a way to copy it, and revoke one.

Anyone without `agents:manage` sees neither the page nor its link.

## Acceptance criteria

- [x] `/agents` is linked from the sidebar next to People, for Admins only. For anyone
      else, the page is a plain not-found and the link is absent.
- [x] The list shows each agent's name, role, status and last seen, a page at a time
      ("Load more"), and an empty state that offers to create the first agent.
- [x] "New agent" asks for a name, a description, a role, scopes and projects. Scopes
      start as the role's own; the form offers only the role's scopes. Projects are
      "All projects" or a chosen list. The server's field errors, and the `409` code `agent_name_taken`, show next to
      their fields.
- [x] An agent's page (`/agents/{agentId}`) shows and edits the same fields, disables or
      re-enables the agent after a confirmation, and lists its tokens with their status.
- [x] "Create token" asks for a name and an expiry (30, 90 or 365 days, or none; 90
      preselected). It then shows the token once, with a copy button and the sentence
      that it will not be shown again; it is gone when the dialog closes. The `409` codes `too_many_tokens` and
      `agent_disabled` are explained.
- [x] "Revoke" asks for confirmation, and the list then shows the token as revoked.
- [x] Keyboard and screen-reader use works, and axe finds no violation on the list, the
      agent's page or the token dialog, in light and dark mode.
- [x] No API contract change. The full quality gate passes, with end-to-end tests of
      the flows above.
