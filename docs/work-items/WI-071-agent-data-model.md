# WI-071 — Agent accounts in the data model, and the agent `Actor`

- Status: Done (2026-11-19)
- Work-track: [WT-05](../work-tracks/WT-05-agent-accounts-and-tokens.md) (item A)
- Depends on: WT-04 (done)
- Work-spec: [WS-071](../work-specs/WS-071-agent-data-model.md)

## Outcome

The database can hold agent accounts as WT-05 decided: an agent row with its role,
description and project scope, its scopes, the projects it is restricted to, and its API
tokens. The database refuses any agent row or child row that breaks the rules of
decisions 1 to 3, whatever code writes it. The code can build an agent `Actor` from those
rows, carrying its scopes as permissions and its project restriction.

Nothing is reachable through the API yet: creating agents and tokens is item C, and
authenticating with a token is item B. Doc 0001 gets the amendment WT-05 approved
(decision 1, question 2).

## Acceptance criteria

- [x] An agent row must have the role `qa_agent` or `worker_agent`, no email, and a name
      no other agent has in any letter case; a human may share an agent's name.
- [x] A scope row must be one of the five agent scopes of doc 0001 and belong to an
      agent account; a project-restriction row and a token row must belong to an agent
      account. Each refusal is a database error, tested by writing such rows directly.
- [x] A token row stores a 12-character lowercase base32 `public_id` (unique) and the
      SHA-256 of its secret, never the secret.
- [x] An agent with "all projects" has no restriction; an agent restricted to a list of
      projects is restricted even when that list is empty.
- [x] `agentActor` gives an agent exactly its stored scopes as permissions and refuses a
      scope its role does not include; human actors are unchanged and carry no
      restriction.
- [x] `loadAgentActor` reads an agent's role, scopes and projects in one query, and
      returns nothing for a human or an unknown id.
- [x] The runtime role has the usual rights on the new tables (the WS-063 test).
- [x] Doc 0001 sections 3 and 7 carry the amendment; no API contract change. The full
      quality gate passes.

## Notes

- Projects are archived, never deleted, so a restriction list does not shrink on its own
  today; the explicit "all projects" flag still keeps "no rows" from ever meaning "every
  project".
