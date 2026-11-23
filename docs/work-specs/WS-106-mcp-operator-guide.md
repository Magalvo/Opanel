# WS-106 — The MCP operator guide

- Status: Approved (approved by the owner on 2026-11-23, questions 1 to 4 as proposed)
- Work-item: [WI-106](../work-items/WI-106-mcp-operator-guide.md)
- Canonical docs: [0005](../canonical/0005-mcp-server.md) (sections 3, 6 and 7),
  [0001](../canonical/0001-ai-qa-agents-and-triage.md) (sections 3 and 4: roles, scopes,
  tokens)

## 1. Approach

A new guide, `docs/mcp.md`, beside `docs/agents.md` (for people writing an agent program)
and `docs/operations.md` (for people running Opanel). It is for the **operator** of an AI
assistant: the person who creates the agent account and connects Claude Code to it
(question 1). `mcp/README.md` keeps what belongs to the package (the tools, building,
development) and sends operators to the guide; its short "Claude Code" section and the
line "The full operator guide … is WT-11 item E" are replaced by that link.

Nothing changes in the app, `/api/v1` or the server's behaviour.

### The guide's sections

1. **What the assistant gets.** One agent account, the tools its permissions allow (the
   table stays in `mcp/README.md`, linked), every change in the task history under the
   agent's name.
2. **What you need.** Node.js 22, a checkout built with `corepack pnpm mcp:build`, the
   Opanel address, and an Admin to create the agent.
3. **The agent account.** Which role for which use:

   | The assistant will                                   | Role           | Scopes to remove                  |
   | ---------------------------------------------------- | -------------- | --------------------------------- |
   | Test a product and file bugs                         | `qa_agent`     | none                              |
   | Read the board and answer questions about it         | `qa_agent`     | `reports:write`, `comments:write` |
   | Work tickets: comment, create, update and move tasks | `worker_agent` | `reports:write` if unused         |

   The project restriction; one agent per assistant and purpose, so the history says
   which one did what; scopes can only be narrowed, never widened beyond the role.

4. **The token.** Created on the agent's page; an expiry (90 days suggested); shown once;
   kept in a password manager or the shell's secret store, never in a repository.
5. **Claude Code, on the command line.** `claude mcp add` with `--scope user` (one person,
   every project), `--transport stdio`, `--env OPANEL_URL=… --env OPANEL_TOKEN=…`, then
   `--` and `node <absolute path>/mcp/dist/index.js`. That the token is then kept in
   Claude Code's own settings file in the user's home, to keep private (question 2).
   `claude mcp list`, `claude mcp get opanel`, `claude mcp remove opanel`.
6. **Sharing with a team.** A project's `.mcp.json`, committed, with
   `"OPANEL_URL": "${OPANEL_URL}"` and `"OPANEL_TOKEN": "${OPANEL_TOKEN}"`: each person
   sets the two variables to their own agent's values, and Claude Code asks once before
   it starts a project's server. Windows paths in JSON use forward slashes.
7. **The desktop app.** What the Code tab of the Claude desktop app uses, as checked by
   hand (question 3).
8. **Checking it works.** `/mcp` shows `opanel` connected; asking "who are you in
   Opanel?" makes the assistant call `opanel_whoami`, which names the agent, its role,
   permissions and projects.
9. **Troubleshooting.** A table of the server's start-up messages (all begin
   `opanel-mcp:` on stderr) and what to do: `OPANEL_URL is missing…`,
   `OPANEL_TOKEN is missing…`, `OPANEL_TOKEN was rejected…`, `The agent account of
OPANEL_TOKEN is disabled…`, `OPANEL_TOKEN is not an agent's…`, `… does not look like
an Opanel server…`, an unreachable server, and the plain-`http` warning. Then: a tool
   is missing (a scope is missing; restart after a change); a tool answers `403` (the
   project is not the agent's); slow start (`MCP_TIMEOUT`).
10. **Rotating and revoking.** Create the new token, change the variable or run
    `claude mcp add` again, reconnect in `/mcp`, then revoke the old one. Revoking or
    disabling the agent stops it at once.
11. **Security.** The narrowest role and projects; content is data, not instructions;
    `https`; every change attributed to the agent (doc 0005 section 6).

### Other docs

- `README.md`: a line beside the agents guide's link: connecting an AI assistant.
- `docs/agents.md`: "What comes next" says the MCP server is done and links the guide
  (its heading stays, so `scripts/agents-guide.test.ts` keeps its section list).
- `docs/work-tracks/WT-11-mcp-server.md`: "Item E is WI-106."

### The test

`mcp/src/guide.test.ts`, in the `mcp` Vitest project. It lives in the package, not in
`scripts/`, because it needs `TOOLS`, `readConfig` and `prepare`, and
`mcp/src/boundaries.test.ts` forbids the app, its tests and its scripts from importing
the package. It reads the Markdown files with `node:fs` and has its own small helpers
(section headings, code spans, links), since the package may not import
`scripts/doc-checks.ts` either.

## 2. Files

| Path                                                      | Change                    |
| --------------------------------------------------------- | ------------------------- |
| `docs/mcp.md`                                             | create                    |
| `mcp/src/guide.test.ts`                                   | create                    |
| `mcp/README.md`                                           | modify                    |
| `docs/agents.md`                                          | modify                    |
| `README.md`                                               | modify                    |
| `docs/work-tracks/WT-11-mcp-server.md`                    | modify                    |
| `docs/work-items/WI-106-mcp-operator-guide.md`, this file | modify (statuses, record) |

## 3. Data model changes

None.

## 4. API contract

None.

## 5. Test plan (written first, in this order)

All in `mcp/src/guide.test.ts` (unit, project `mcp`), except test 8.

| #   | Level  | Test                                                                                                                                                                                                                                                                                 | Covers criterion |
| --- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| 1   | unit   | `docs/mcp.md` exists and has the sections of section 1, in order                                                                                                                                                                                                                     | 1                |
| 2   | unit   | Each start-up failure, made to happen (`readConfig` without each variable; `prepare` against a fake fetch answering `401`, `agent_disabled`, a person's `/me`, a non-Opanel answer, no answer; plain `http` to a remote host), writes a message whose first sentence the guide holds | 2                |
| 3   | unit   | The tool table of `mcp/README.md` lists exactly the tools of `TOOLS`, in order, each with its declared permissions                                                                                                                                                                   | 3                |
| 4   | unit   | Every `opanel_*` name in the guide is a tool; every role and scope it names is one of `scopesOfRole`'s; each role's row names only scopes of that role; every `OPANEL_*` variable is one `readConfig` reads                                                                          | 3                |
| 5   | unit   | No code block or span matches the token pattern; the `.mcp.json` block parses as JSON, its `OPANEL_TOKEN` is `${OPANEL_TOKEN}`, and its `args` end in `mcp/dist/index.js`, the package's `bin`                                                                                       | 4                |
| 6   | unit   | Every relative link of the guide resolves; the `claude mcp add` example has `--` before `node` and `--env` before the server's name                                                                                                                                                  | 1, 3             |
| 7   | unit   | `README.md`, `docs/agents.md` and `mcp/README.md` link to `docs/mcp.md`; `docs/agents.md` no longer says the MCP server "will" come                                                                                                                                                  | 6                |
| 8   | manual | On this machine, against `corepack pnpm dev` and a `qa_agent` token: `claude mcp add` (user scope), `claude mcp list` shows it connected, `opanel_whoami` answers, a project `.mcp.json` with the variables works, and the desktop app's Code tab shows the server; recorded here    | 5                |

`pnpm check`, `pnpm test` and `pnpm test:e2e` as for any item.

## 6. Risks and open questions

1. **Where the guide lives.** **Recommend `docs/mcp.md`**, a guide of its own like
   `docs/agents.md` and `docs/operations.md`, with `mcp/README.md` kept to the package.
   Alternative: grow `mcp/README.md` into the guide, one place but mixing operators with
   contributors.
2. **Where the token is kept.** `claude mcp add --env` keeps the token in Claude Code's
   settings file in the user's home, in plain text; a project's `.mcp.json` can take it
   from an environment variable (`${OPANEL_TOKEN}`) instead. **Recommend showing both**:
   `--scope user` for one person, saying the settings file then holds the token, and the
   `.mcp.json` with variables for a team. Alternative: only the variables, which keeps
   the token out of every file but is harder to set up for one person.
3. **The desktop app.** Claude Code's MCP documentation (read 2026-11-23) does not say
   whether the desktop app's Code tab uses the servers added with `claude mcp add` and a
   project's `.mcp.json`. **Recommend documenting what test 8 shows**, and leaving out the
   desktop app's chat (its own `claude_desktop_config.json`), since WT-11 names Claude
   Code. If the Code tab does not pick the server up, the guide says how it was added
   there, and I tell you before writing it. Alternative: also document the chat's
   configuration file.
4. **Claude Code changes.** The guide describes another product's commands, which may
   change. It says which Claude Code version it was checked with, and links Claude Code's
   MCP documentation for anything beyond it.

## Implementation record

- Red: `0f31b2a`, `mcp/src/guide.test.ts`, tests 1 to 7: six failing because
  `docs/mcp.md` did not exist and no doc linked it; the README's tool table (test 3)
  already passed.
- Green: `1771f50` (the guide) and `fa76762` (the links, WT-11). `dd23e71` makes the
  test pass lint.
- Gate: `pnpm check`, `pnpm test` (1988 passed) and `pnpm test:e2e` (100 passed) locally.
- Test 8, by hand on 2026-11-23 with Claude Code 2.1.330 on Windows. The app ran on port
  3106 against a throwaway database, with a `qa_agent` and a 30-day token. Claude Code
  used its own configuration directory (`CLAUDE_CONFIG_DIR`), so the owner's settings
  were not touched. What happened:
  - `claude mcp add opanel --scope user -e … -e … -- node …/mcp/dist/index.js` worked in
    Git Bash and in Windows PowerShell 5.1. `claude mcp list` showed `✔ Connected`.
  - The token was then kept in plain text in `.claude.json`, and `claude mcp get opanel`
    printed it. The guide says so.
  - A project `.mcp.json` with `${OPANEL_URL}` and `${OPANEL_TOKEN}` warned
    `Missing environment variables: OPANEL_URL, OPANEL_TOKEN` when the variables were
    unset, and showed `⏸ Pending approval` until it was approved. Once approved it
    showed `✔ Connected` with the variables set, and `✘ Failed to connect` with a wrong
    token.
  - Started by hand with a wrong token, the server wrote `opanel-mcp: OPANEL_TOKEN was
rejected: …` and stopped. The guide's troubleshooting starts from this.
  - **Not done here.** The tool call (`opanel_whoami`) was not tried through Claude Code:
    `claude -p` could not sign in from this session. The same call over stdio is covered
    by `mcp/e2e/mcp.spec.ts`.
  - **Not seen yet.** No one has yet seen the desktop app's Code tab show the server. It
    is likely to: this session runs in it on the bundled `claude.exe` 2.1.330, with
    `CLAUDE_CODE_ENTRYPOINT=claude-desktop` and no `CLAUDE_CONFIG_DIR`. The owner checks
    it in the app (question 3).

## Deviations

- The `claude mcp add` example puts the server's name before `-e`, as
  `claude mcp add --help` does in 2.1.330. A name after a variadic `-e` would be read as
  one more variable. Test 6 checks this order, not "`--env` before the name" as section 5
  said.
