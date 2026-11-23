# Connecting an AI assistant to Opanel

This guide is for the person who connects an AI assistant, such as Claude Code, to
Opanel: you create an agent account for it, give the assistant the agent's token, and the
assistant then reads boards, works tickets and files bugs through Opanel's MCP server. The
design is canonical doc [0005](canonical/0005-mcp-server.md). Writing a program of your own
instead? See the [agents guide](agents.md).

The steps were checked with Claude Code 2.1.330 on 2026-11-23. For anything Claude Code
does beyond them, see its [MCP documentation](https://code.claude.com/docs/en/mcp).

## What the assistant gets

- **One agent account.** The assistant acts as that agent. Every comment, task and bug it
  makes is in the task's history under the agent's name, with an "Agent" badge.
- **The tools the agent's permissions allow,** and no others. The list, with each tool's
  permissions, is in [the MCP server's README](../mcp/README.md#tools). A `qa_agent` reads
  the board, comments and files bugs; a `worker_agent` also creates, updates and moves
  tasks.
- **Nothing more.** The MCP server is an API client running beside the assistant. It
  cannot delete anything, change settings or reach a project the agent cannot.

## What you need

- **Opanel's address**, for example `https://opanel.your-company.com`.
- **An Admin of Opanel**, to create the agent and its token.
- **On the machine that runs the assistant:** Node.js 22, Claude Code, and a checkout of
  Opanel with the MCP server built:

  ```sh
  corepack pnpm install
  corepack pnpm mcp:build
  ```

  This writes `mcp/dist/index.js`. Note its absolute path: Claude Code starts it with
  `node`. Build again after you update the checkout.

## The agent account

An Admin creates it: **Agents** in the sidebar, then **New agent**, with a name, a role,
its scopes and its projects. Choose by what the assistant will do:

| The assistant will                                   | Role           | Scopes to remove                  |
| ---------------------------------------------------- | -------------- | --------------------------------- |
| Test a product and file the bugs it finds            | `qa_agent`     | none                              |
| Read boards and answer questions about them          | `qa_agent`     | `reports:write`, `comments:write` |
| Work tickets: comment, create, update and move tasks | `worker_agent` | `reports:write`, if unused        |

- **The narrowest fit.** Remove every scope the assistant does not need. A scope can be
  removed, never added beyond the role.
- **Its projects.** Restrict the agent to the projects the assistant works on. Other
  projects are then invisible to it.
- **One agent per assistant and purpose.** Give each assistant, or each kind of job, its
  own agent, so the history says which one did what, and you can stop one without the
  others.

The [agents guide](agents.md#what-a-token-can-do) lists what each scope allows.

## The token

On the agent's page, **Create token**: a name (where it is used, for example "Ana's
laptop") and an expiry. 90 days is a good default.

- **It is shown once.** Opanel keeps only a hash. Copy it straight into a password manager
  or your system's secret store.
- **Never commit it** to a repository, and never paste it into a chat with the assistant:
  the MCP server reads it only from its environment, never from a tool's arguments.
- **One token per machine.** Then revoking one machine's token leaves the others working.

## Claude Code on the command line

Add the server once for your user, so it is there in every project:

```sh
claude mcp add opanel --scope user -e OPANEL_URL=https://opanel.your-company.com -e OPANEL_TOKEN=opk_… -- node /path/to/opanel/mcp/dist/index.js
```

- **`opanel`** is the server's name in Claude Code; its tools appear as
  `mcp__opanel__opanel_whoami` and so on.
- **`--`** ends Claude Code's own options: what follows is the command that starts the
  server. Give the absolute path of `mcp/dist/index.js`. On Windows, write it with forward
  slashes, for example `C:/src/opanel/mcp/dist/index.js`; the same command works in
  PowerShell.
- **`--scope user`** keeps the server in your own settings for every project. Without
  it, the server is added for the current directory only (`local`).

Claude Code keeps the two variables in its settings file in your home directory
(`.claude.json`), in plain text. Keep that file private. `claude mcp get opanel` prints
the token too, so never paste its output anywhere.

To look at it and remove it:

```sh
claude mcp list
claude mcp get opanel
claude mcp remove opanel --scope user
```

`claude mcp list` starts the server to check it: `opanel: … - ✔ Connected` means it
started and Opanel accepted the token.

## Sharing with a team

To give a whole project's team the server, commit a `.mcp.json` at the project's root that
takes the address and the token from the environment, so no token is in the file:

```json
{
  "mcpServers": {
    "opanel": {
      "command": "node",
      "args": ["/path/to/opanel/mcp/dist/index.js"],
      "env": {
        "OPANEL_URL": "${OPANEL_URL}",
        "OPANEL_TOKEN": "${OPANEL_TOKEN}"
      }
    }
  }
}
```

- **Each person sets `OPANEL_URL` and `OPANEL_TOKEN`** in their own environment, to their
  own agent's token, before starting Claude Code. On Windows, set them as user
  environment variables (System settings, or `setx`), then open a new terminal or restart
  the desktop app.
- **The path** in `args` must be where the server is built on each machine. When people
  keep Opanel in different places, add the server with `claude mcp add` instead.
- **Claude Code asks before it starts a project's server.** Until someone approves it,
  `claude mcp list` shows `⏸ Pending approval`: run `claude` in the project and accept.
- **When a variable is not set,** `claude mcp list` warns
  `Missing environment variables: OPANEL_URL, OPANEL_TOKEN` and the server does not start.

## The desktop app

The Code tab of the Claude desktop app runs Claude Code itself, with the same settings in
your home directory. A server added with `claude mcp add --scope user` is there in every
Code tab session, and a project's `.mcp.json` in the sessions opened on that project.

- **The `claude` command.** The desktop app does not put one on your `PATH`. To run
  `claude mcp add`, install Claude Code's command line (see its
  [setup documentation](https://code.claude.com/docs/en/setup)): the server it adds is the
  desktop app's too.
- **Start a new session** after you add or change the server: a running session keeps the
  tools it started with.
- **Environment variables** for a `.mcp.json` come from the app's own environment: set
  them as user environment variables, then quit and reopen the app.

The chat of the desktop app, outside the Code tab, keeps MCP servers in a separate file of
its own, which this guide does not cover.

## Checking it works

1. In a Claude Code session, run `/mcp`: `opanel` is listed as connected. If it failed to
   connect, see [Troubleshooting](#troubleshooting).
2. Ask "Who are you in Opanel?". The assistant calls `opanel_whoami`, which answers the
   agent's name, role, permissions and projects. Check that they are the ones you chose.
3. Ask it to list the projects it can see, with `opanel_list_projects`.

After you change the agent's scopes or projects, reconnect the server in `/mcp`, or start
a new session: the server reads the agent's permissions when it starts.

## Troubleshooting

When the server cannot start, Claude Code shows only `✘ Failed to connect`. To see why,
start it by hand with the same two variables. It writes one line to stderr, beginning
`opanel-mcp:`, and stops:

```sh
OPANEL_URL=https://opanel.your-company.com OPANEL_TOKEN=opk_… node /path/to/opanel/mcp/dist/index.js
```

In PowerShell:

```powershell
$env:OPANEL_URL = "https://opanel.your-company.com"; $env:OPANEL_TOKEN = "opk_…"; node C:/path/to/opanel/mcp/dist/index.js
```

When it starts, it waits silently for Claude Code: stop it with Ctrl+C.

| The server says                                                                                   | What to do                                                                                  |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `OPANEL_URL is missing or not a valid http(s) URL without a query or fragment`                    | Set `OPANEL_URL` to Opanel's address alone, for example `https://opanel.your-company.com`   |
| `OPANEL_TOKEN is missing or not an Opanel agent token (opk_…)`                                    | Set `OPANEL_TOKEN` to the whole token, as it was shown when created                         |
| `OPANEL_TOKEN was rejected: it is wrong, revoked or expired.`                                     | Have an Admin create a new token, and replace the old one                                   |
| `The agent account of OPANEL_TOKEN is disabled.`                                                  | An Admin enables the agent on the Agents page                                               |
| `OPANEL_TOKEN is not an agent's: the MCP server acts only as an agent account.`                   | Use an agent's token, never a person's session                                              |
| `<OPANEL_URL> does not look like an Opanel server: GET /api/v1/me gave an unexpected answer`      | Check the address: it is Opanel's own, without `/api/v1`, and no proxy answers in its place |
| `Opanel is unreachable at <OPANEL_URL>.`                                                          | Check the address and the network from that machine                                         |
| `Warning: OPANEL_URL uses plain http to <host>; the token travels unencrypted.` (it still starts) | Use `https`, unless this is a private network you trust                                     |

Any other message names the request's id: an Admin can find that request in Opanel's logs.

Once it runs:

- **A tool is missing.** The agent lacks a scope it needs (the
  [README](../mcp/README.md#tools) lists them). Add the scope, then reconnect in `/mcp`.
- **A tool answers `403 forbidden`.** The project is not one of the agent's.
- **A tool answers `401`** after working before: the token expired or was revoked, or the
  agent was disabled.
- **The server is slow to start.** Claude Code waits a limited time for it; set
  `MCP_TIMEOUT` (in milliseconds) before starting Claude Code to wait longer.

## Rotating and revoking

- **Rotating.** Before the token expires, create a new one on the agent's page. Put it in
  place: run `claude mcp remove opanel --scope user`, then `claude mcp add` again, or
  change the environment variable. Reconnect in `/mcp`, check with `opanel_whoami`, then
  revoke the old token.
- **Stopping an assistant.** Revoke its token, or disable its agent, on the Agents page.
  Either takes effect at once: its next request is refused.
- **Removing it from Claude Code** does not revoke the token. Revoke it too when the
  machine no longer needs it.

## Security

- **Least privilege.** The agent's role, scopes and projects are the only limit on what
  the assistant can do. The MCP server cannot widen them.
- **Content is data, not instructions.** Task titles, descriptions and comments are
  written by people and other agents, and may try to steer the assistant. The tools mark
  that content as data, but what protects you is the agent's permissions: an agent
  without `tasks:write` cannot be talked into editing tasks.
- **`https`.** The token travels on every request. Plain `http` is for `localhost` and
  private networks only.
- **Everything is attributed.** Every change the assistant makes is in the task's history
  under the agent's name. Review it like any teammate's work.
