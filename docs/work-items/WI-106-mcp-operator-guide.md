# WI-106 — The MCP operator guide

- Status: In progress
- Work-track: [WT-11](../work-tracks/WT-11-mcp-server.md) (item E)
- Depends on: [WI-104](WI-104-mcp-write-tools.md) (done); [WI-105](WI-105-mcp-bug-report-tool.md)
  (done), so the guide covers every tool
- Work-spec: [WS-106](../work-specs/WS-106-mcp-operator-guide.md)

## Outcome

Someone who runs AI assistants for a team can connect Claude Code to Opanel without
reading the code: they know which agent account to create and with which role, scopes and
projects, how to create and keep its token, how to add the MCP server to Claude Code on
the command line and in the desktop app, how to check that it works, and what to do when
it does not. A test keeps the guide in step with the server.

## Acceptance criteria

- [ ] `docs/mcp.md` is the operator guide. It covers, in order: what the assistant gets;
      what is needed; the agent account (which role and scopes for which use, the project
      restriction, one agent per assistant); its token (expiry, kept as a secret, never in
      a repository); adding the server to Claude Code on the command line; sharing it with
      a team through a project's `.mcp.json` without a token in the file; the desktop app;
      checking it works; troubleshooting; rotating and revoking; security.
- [ ] Every start-up failure of the server has a row in the troubleshooting table, with
      the server's own message and the fix. A test makes each failure happen and finds its
      message in the guide.
- [ ] The tool table in `mcp/README.md` names every tool and its permissions, as `TOOLS`
      declares them, and the guide names no tool, role, scope or variable the server does
      not have (tested).
- [ ] No example in the guide holds a real-looking token; the `.mcp.json` example is valid
      JSON and takes the token from an environment variable (tested).
- [ ] The command-line and desktop-app steps were followed by hand against a local Opanel,
      and the work-spec records what was seen.
- [ ] `README.md`, `docs/agents.md` and `mcp/README.md` link to the guide; the agents
      guide no longer calls the MCP server "what comes next" (tested).

## Notes

WT-11 item E, doc 0005 sections 3, 6 and 7. Documentation and one test file; no change to
the app, `/api/v1` or the MCP server's behaviour. The last item of WT-11.
