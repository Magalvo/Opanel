# WI-078 — The agent flow end to end, and the guide for agent authors

- Status: Proposed
- Work-track: [WT-05](../work-tracks/WT-05-agent-accounts-and-tokens.md) (item H, the last)
- Depends on: WI-075, WI-076, WI-077, WI-073 (all done)
- Work-spec: [WS-078](../work-specs/WS-078-agent-flow-and-guide.md)

## Outcome

WT-05 built agents piece by piece: the data model, tokens, the Admin API, project
restrictions, `GET /me`, the Agents page and the Agent badge. Each piece is tested on its
own. This item adds three things:

- one end-to-end test that drives the whole flow, the way a real agent author lives it;
- the one guide that author reads, `docs/agents.md`;
- the WT-05 exit criteria that no item has proved yet. WT-05 then closes.

## Acceptance criteria

- [ ] An end-to-end test covers the whole flow:
  - an Admin creates a QA agent restricted to one project, and a token, in the UI;
  - with that token alone, and no cookie, the agent reads `GET /me`, lists only its
    project, reads a task, comments on it and opens the project's events stream;
  - it gets `403` on another project and on creating a task (no `tasks:write`);
  - the Admin sees the comment on the task with the Agent badge.
- [ ] An integration test tries every permission outside the five agent scopes, through
      `POST` and `PATCH /api/v1/agents`, and each is refused with `400 scopes`.
- [ ] An integration test shows that an agent's comment is attributed to the agent: its
      author is the agent's account.
- [ ] `docs/agents.md` exists, linked from `README.md` and from the description of the
      OpenAPI document. It covers getting a token, sending it, what the scopes and the
      project restriction allow, `GET /me`, the errors and limits, lists, the events
      stream, rotating and revoking tokens, and where to go next (WT-06 bug reports,
      WT-11 MCP).
- [ ] A test keeps the guide in step: every endpoint it names is in the API contracts,
      every error code is a known problem code, every scope is an agent scope, and every
      link resolves.
- [ ] WT-05's exit criteria are each ticked with the item or test that covers them, and
      WT-05 is `Done`.
- [ ] No API contract change. The full quality gate passes.
