# WI-099 — The MCP server starts over stdio and answers opanel_whoami

- Status: Done (2026-11-21)
- Work-track: [WT-11](../work-tracks/WT-11-mcp-server.md) (item A)
- Depends on: WT-05 (done)
- Work-spec: [WS-099](../work-specs/WS-099-mcp-server-skeleton.md)

## Outcome

An operator builds the `mcp/` package, points an AI assistant at `node mcp/dist/index.js`
with `OPANEL_URL` and an agent's `OPANEL_TOKEN`, and the assistant gets one tool,
`opanel_whoami`, that answers who the agent is and what it may do. Everything later tools
need is in place: the workspace package, the pinned SDK, validated configuration, the API
client, the mapping of API problems to tool errors, and tools chosen by the agent's
permissions.

## Acceptance criteria

- [x] `mcp/` is a pnpm workspace package. `@modelcontextprotocol/server` is pinned and is
      a dependency of that package only; the web app, its image and its build never
      depend on it.
- [x] `OPANEL_URL` and `OPANEL_TOKEN` are validated with Zod at start. A missing or
      malformed value stops the server with a message naming the variable, never its
      value. Plain `http` to a host other than `localhost` (or `127.0.0.1`, `[::1]`)
      writes a warning to stderr and carries on.
- [x] At start the server calls `GET /api/v1/me`. A rejected token, an unreachable or
      wrong URL, or an account that is not an agent stops it with a clear message on
      stderr and a non-zero exit code.
- [x] The server offers only the tools whose permission the agent holds; `opanel_whoami`
      needs none and is always offered.
- [x] `opanel_whoami` answers the agent's `id`, `name`, `role`, `permissions` and
      `projectIds` as structured content checked against `agentMeSchema`, with a short
      text summary.
- [x] An API problem becomes a tool error carrying `status`, `code`, `detail`, field
      `errors` and `requestId`. An answer that does not match its response schema is a
      tool error and is never passed on.
- [x] The token never appears in a tool result, a tool error, or anything the server
      writes to stdout or stderr (tested). Nothing but MCP messages is written to stdout.
- [x] An end-to-end test starts the built server over stdio with the SDK's client,
      against the running app and a real agent token: it lists the tools, calls
      `opanel_whoami`, and checks that a revoked token stops the server.
- [x] The package's typecheck, unit tests, build and end-to-end test run within the
      existing quality gate commands, locally and in CI.

## Notes

WT-11 item A, doc 0005 sections 3, 5, 6 and 7. The read tools are item B. Running the
built server from a checkout is documented in the package's README; the full operator
guide is item E.
