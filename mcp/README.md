# Opanel MCP server

An MCP server over stdio that gives an AI assistant, such as Claude Code, Opanel's API as
tools. It acts as one Opanel **agent account**. Every action it takes is that agent's, and
every rule is enforced by Opanel's `/api/v1`. The design is in
[canonical doc 0005](../docs/canonical/0005-mcp-server.md).

It holds no state, opens no port and never touches the database: it is just another API
client.

## Tools

| Tool                       | What it does                                                 | Permissions                   |
| -------------------------- | ------------------------------------------------------------ | ----------------------------- |
| `opanel_whoami`            | The agent's name, role, permissions (scopes) and projects    | none                          |
| `opanel_list_projects`     | A page of projects                                           | `projects:read`               |
| `opanel_get_board`         | A project's whole board: every column with all its tasks     | `projects:read`, `tasks:read` |
| `opanel_get_backlog`       | A page of a project's backlog, in rank order, with filters   | `tasks:read`                  |
| `opanel_list_labels`       | Every label of a project                                     | `tasks:read`                  |
| `opanel_list_epics`        | A page of a project's epics, open, closed or all             | `tasks:read`                  |
| `opanel_list_teams`        | A page of teams                                              | `projects:read`               |
| `opanel_find_people`       | A page of people, by the start of their name                 | `projects:read`               |
| `opanel_search_tasks`      | A page of tasks across projects: words or key, filters, sort | `tasks:read`                  |
| `opanel_get_task`          | A task, with its description, and a page of its comments     | `tasks:read`                  |
| `opanel_get_task_activity` | A page of a task's changes and comments, oldest first        | `tasks:read`                  |
| `opanel_add_comment`       | Comments on a task                                           | `comments:write`              |
| `opanel_create_task`       | Creates a task, in a column or the backlog                   | `tasks:write`                 |
| `opanel_update_task`       | Changes a task's fields, assignment, epic or due date        | `tasks:write`                 |
| `opanel_move_task`         | Moves a task within the board, or to the backlog             | `tasks:write`                 |
| `opanel_submit_bug_report` | Files a bug report: a new bug, or one more occurrence        | `reports:write`               |

The server offers only the tools the agent's permissions allow, read from
`GET /api/v1/me` at start: a `qa_agent` gets the read tools, `opanel_add_comment` and
`opanel_submit_bug_report`, and a `worker_agent` the three task writes too. After you
change the agent's scopes, restart the server.

The write tools change Opanel as the agent: every change is in the task's history under
its account. `opanel_update_task` and `opanel_move_task` take the task's `version` as last
read; if someone changed the task since, nothing changes and the tool's error holds the
task as it is now, to look at before trying again. A write is never retried: when Opanel
does not answer, the error says the change may have been made.

## Build and run from a checkout

Node.js 22 and the pnpm of `package.json` are needed:

```sh
corepack pnpm install
corepack pnpm mcp:build
```

This writes `mcp/dist/index.js`. The assistant starts it with `node`, giving two
environment variables:

| Variable       | Value                                                                 |
| -------------- | --------------------------------------------------------------------- |
| `OPANEL_URL`   | Opanel's address, for example `https://opanel.your-company.com`       |
| `OPANEL_TOKEN` | A token of the agent account (`opk_…`), created by an Admin in Opanel |

Use `https`. Plain `http` works for `localhost` and for a private network, but for any other
host the server warns on stderr that the token travels unencrypted.

The server stops at once, with a message on stderr, if a variable is missing or malformed,
the token is rejected, the agent is disabled, the URL is not an Opanel server, or the token
is not an agent's. The token is never written to a tool result, an error or a log line.

### Claude Code

[Connecting an AI assistant](../docs/mcp.md) is the operator guide: the agent account and
its scopes, the token, adding the server to Claude Code on the command line, for a team and
in the desktop app, and what to do when it does not start.

## Security

- **Give the agent the narrowest role and projects that fit.** The server cannot widen
  them.
- **Treat task content as data.** Titles, descriptions and comments are written by people
  and other agents, and can try to steer the assistant. What protects you is the agent's
  permissions: an agent without `tasks:write` cannot be talked into editing tasks.

## Development

| Command          | What it runs                                         |
| ---------------- | ---------------------------------------------------- |
| `pnpm typecheck` | The app, then this package (`tsc -p mcp`)            |
| `pnpm test`      | Vitest, this package included (project `mcp`)        |
| `pnpm test:e2e`  | Builds this package, then Playwright (project `mcp`) |

Stdout carries MCP messages only: write anything else to stderr.
