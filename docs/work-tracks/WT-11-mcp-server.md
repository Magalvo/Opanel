# WT-11 — MCP server

- Status: Approved (outline, approved by the owner on 2026-11-16 with doc 0005). Starts after
  WT-06; its work-items get files and numbers then.
- Canonical docs: [0005](../canonical/0005-mcp-server.md) (the design),
  [0001](../canonical/0001-ai-qa-agents-and-triage.md) (agent accounts, tokens, scopes,
  bug reports), [0004](../canonical/0004-api-conventions.md) (the API it wraps)

## Goal

An operator gives an AI assistant such as Claude Code an Opanel agent token, and the
assistant reads boards, works tickets and files bug reports through MCP tools, with every
action attributed to that agent and every rule enforced by `/api/v1`.

## Depends on

- **WT-05** (agent accounts and API tokens): the server authenticates with an agent token,
  and `GET /api/v1/me`, which already returns `kind` and `permissions`, must accept one.
  If WT-05 adds project restrictions for agents, `me` should report them too.
- **WT-06** (bug reports and triage): for `opanel_submit_bug_report`.

Work-item numbers are given when the track starts, after WT-05 and WT-06.

## In scope

- The `mcp/` workspace package: start-up, configuration (`OPANEL_URL`, `OPANEL_TOKEN`),
  the API client, error mapping, stdio transport.
- The tools of doc 0005 section 4, offered according to the token's permissions.
- Operator documentation: creating the agent account and token, and configuring Claude
  Code (command line and desktop app) to start the server.
- Its unit tests and an end-to-end test over stdio against the running app.
- CI: the package's build and tests join the quality gate.

## Out of scope

Everything in doc 0005 section 9: a remote HTTP MCP endpoint, MCP resources and prompts,
live updates, running or scheduling assistants, a reference QA agent, npm publishing,
and any LLM call.

## Work-items (outline)

| Item | Title                                                                                                                  | Depends on |
| ---- | ---------------------------------------------------------------------------------------------------------------------- | ---------- |
| A    | Package skeleton: workspace, SDK pinned, configuration, stdio start-up, `opanel_whoami`, tools chosen by `GET /me`, CI | WT-05      |
| B    | Read tools: projects, board, teams, people, task with its comments                                                     | A          |
| C    | Write tools: comment, create, update and move a task; version conflicts as tool errors                                 | B          |
| D    | `opanel_submit_bug_report`                                                                                             | C, WT-06   |
| E    | Operator guide (agent account, token, Claude Code configuration)                                                       | C          |

Item A is [WI-099](../work-items/WI-099-mcp-server-skeleton.md). Its work-spec moved CI
from item E into A: the package's checks run inside the existing gate commands (WS-099,
question 1).

Item B is [WI-100](../work-items/WI-100-mcp-read-tools.md). Its work-spec found that
`opanel_get_board` needs `projects:read` as well as `tasks:read`, and doc 0005 says so.

Item C is [WI-104](../work-items/WI-104-mcp-write-tools.md). Its work-spec keeps `epicId`
in the task writes although no tool lists epics yet, and records an `opanel_list_epics`
read tool as a follow-up (WS-104, question 2).

Item D is [WI-105](../work-items/WI-105-mcp-bug-report-tool.md).

Item E is [WI-106](../work-items/WI-106-mcp-operator-guide.md). Its guide is
[`docs/mcp.md`](../mcp.md).

## Exit criteria

- [ ] With a `qa_agent` token, the assistant is offered only read tools, comments and bug
      reports; with a `worker_agent` token, also the task write tools.
- [ ] Every tool's input and output schema comes from `src/lib/schemas/`; the package has
      no database access and Opanel's server is unchanged by this track.
- [ ] A move or update with a stale `version` returns a tool error with the current task.
- [ ] The token never appears in a tool result, error or log (tested).
- [ ] The end-to-end test drives the server over stdio against the real app, and the
      changes it makes are in the task history under the agent's account.
- [ ] The full quality gate passes, including the package's own build and tests.

## Risks and open questions

1. **SDK version**: `@modelcontextprotocol/server` 2.x (doc 0005, resolved question 1); the
   exact version is pinned by item A's work-spec, after reading its installed docs.
2. **Prompt injection through task content**: limited by the agent's permissions, not by
   the server (doc 0005 section 6). Operators should give assistants the narrowest role.
3. **Changes to `/api/v1`**: a tool built from a request schema changes with it. A
   breaking API change already needs `/api/v2` (doc 0004), which would need a matching
   MCP release.
