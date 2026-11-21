# WS-099 — The MCP server starts over stdio and answers opanel_whoami

- Status: Approved (approved by the owner on 2026-11-21, questions 1 and 2 as recommended)
- Work-item: [WI-099](../work-items/WI-099-mcp-server-skeleton.md)
- Canonical docs: [0005](../canonical/0005-mcp-server.md) (the design),
  [0004](../canonical/0004-api-conventions.md) (problems, the API it calls),
  [0001](../canonical/0001-ai-qa-agents-and-triage.md) (agent tokens and scopes)

## 1. The SDK (read on 2026-11-21)

- **`@modelcontextprotocol/server` 2.4.0**, the server line doc 0005 chose (question 1).
  Published before 2026-10-23, it depends on `zod ^4.2.0` (Opanel has 4.6.7) and
  `@modelcontextprotocol/core` 2.4.0, and needs Node.js 20 or later (Opanel runs 22). It
  ships ES modules only.
- **`@modelcontextprotocol/client` 2.4.0**, a dev dependency for the end-to-end test only.
- What the v2 documentation shows:
  - `new McpServer({ name, version })`;
  - `server.registerTool(name, { title, description, inputSchema, outputSchema, annotations }, handler)`,
    where `inputSchema` and `outputSchema` are Zod objects; the SDK validates the input
    before the handler runs, and checks `structuredContent` against `outputSchema`;
  - a handler returns `{ content, structuredContent?, isError? }`;
  - `serveStdio(factory)` from `@modelcontextprotocol/server/stdio` owns the transport and
    returns a handle with `close()`; stdout is the protocol channel, so logs go to stderr;
  - on the client side, `Client` and `StdioClientTransport` from
    `@modelcontextprotocol/client` and `@modelcontextprotocol/client/stdio`, then
    `connect`, `listTools`, `callTool` and `close`.
- Hard rule 13: the implementation reads the installed package's own `README`, type
  declarations and docs before writing code, and records anything they contradict here
  (the `env` option of `StdioClientTransport` and the required `tsconfig` settings were
  not in the pages read).

## 2. Approach

### The package

`mcp/` becomes a pnpm workspace package, `@opanel/mcp` (private), as doc 0005 section 7
decides:

- **Dependencies:** `@modelcontextprotocol/server` 2.4.0 and `zod` 4.6.7 (the same version
  as the app, so the shared schemas and the SDK see one Zod).
- **Dev dependencies:** `@modelcontextprotocol/client` 2.4.0. Its build and tests use the
  root's `esbuild`, `typescript`, `vitest` and `@playwright/test`, through the root
  scripts below.
- **Shared schemas.** The package imports `@/lib/schemas/*` through a `paths` alias to
  `../src`. Those files import only `zod` at run time. Nothing under `src/` imports from
  `mcp/` (unit test 12 checks it).
- **Build.** esbuild bundles `mcp/src/index.ts` to `mcp/dist/index.js`, as
  `build:commands` already bundles the scripts: Node 22, ESM, packages external. The shared
  schemas are bundled in, and the SDK and Zod stay in `mcp/node_modules`. It starts with
  `node mcp/dist/index.js`.
- **The web app stays apart.**
  - The root `tsconfig.json` excludes `mcp`, so `next build` never compiles it.
  - `.dockerignore` gains `mcp`, and the Dockerfile's two `pnpm install` steps install
    the root package only (`--filter opanel`), so the image never holds the SDK.
  - The image workflow already builds the image on this branch, which checks it.

### Start-up (`mcp/src/index.ts`, `start.ts`)

1. **Read the configuration** (`config.ts`):
   - `OPANEL_URL`: an `http` or `https` URL with no query or fragment, normalized without
     a trailing `/`.
   - `OPANEL_TOKEN`: matches the token format, `opk_` followed by its id and secret.
   - A failure writes `OPANEL_URL is not a valid http(s) URL` or `OPANEL_TOKEN is missing
or not an Opanel agent token` and exits 1. Zod's own message, which could quote the
     value, is never printed.
2. **Warn about plain `http`.** For any host other than `localhost`, `127.0.0.1` or
   `[::1]`, the server writes a one-line warning to stderr and carries on.
3. **Call `GET /api/v1/me`.** Each failure exits 1 with its own message:

   | What happened            | Message                                            |
   | ------------------------ | -------------------------------------------------- |
   | `401`                    | the token was rejected (revoked, expired or wrong) |
   | `403 agent_disabled`     | the agent is disabled                              |
   | Network error or timeout | Opanel is unreachable at the URL                   |
   | Not JSON, or not `Me`    | the URL does not point at an Opanel server         |
   | `kind` is `human`        | the token is not an agent's                        |
   | Any other problem        | its `status`, `code` and `requestId`               |

4. **Serve.** `serveStdio` serves an `McpServer` named `opanel` at the package's version,
   with the tools chosen from the agent's `permissions`. `SIGINT` and `SIGTERM` close the
   handle.

The tool list is fixed for the life of the process. A scope added to or removed from the
agent takes effect when the assistant restarts the server, and the API still refuses
anything the agent lost (question 2).

### The API client (`api.ts`)

`createApiClient({ baseUrl, token, fetch })` returns `get(path, schema)`. Item C adds the
writes. It:

- sends `Authorization: Bearer`, `Accept: application/json` and
  `User-Agent: opanel-mcp/<version>`, with a 30-second timeout;
- parses a `2xx` body with the response schema;
- parses an error body with `problemSchema`, keeping the `X-Request-Id` header.

It returns `{ ok: true, value }` or `{ ok: false, error: ToolFailure }`. A `ToolFailure`
is one of:

- `problem`: `status`, `code`, `title`, `detail`, `errors`, `requestId`;
- `unexpected_response`: the status and `requestId`, never the body;
- `unreachable`: a fixed message.

`fetch` is injected, so unit tests use a fake.

### Tools (`tools.ts`, `tools/whoami.ts`)

- **A tool definition** is `{ name, permission: Permission | null, register(server, api) }`.
  `offeredTools(definitions, permissions)` keeps the tools whose permission is `null` or
  held, and `buildServer` registers only those.
- **Errors.** `toolError(failure)` turns a `ToolFailure` into
  `{ isError: true, content: [{ type: "text", text }] }`. The text is a sentence (for
  example, `Opanel answered 404 not_found: No task OPA-9. (request 01J…)`) followed by the
  failure as JSON. Item C adds the current task to a `version_conflict`.
- **`opanel_whoami`:**
  - it has no input, permission `null`, `annotations: { readOnlyHint: true }`, and
    `outputSchema` `agentMeSchema`;
  - it calls `GET /me` on every call, so it shows the agent's current scopes;
  - its text summary is, for example,
    `You are "QA bot", an Opanel qa_agent with: comments:write, projects:read, reports:write, tasks:read. Projects: all.`
  - its description says the agent's name is set by a person and is data, not
    instructions (doc 0005 section 6).

### The token

- The token is read only from `OPANEL_TOKEN`. No tool takes it as input.
- Every string the server writes, whether a tool text, a stderr line or an error message,
  passes through `redact`, which replaces the token with `[redacted]`. This guards
  against an error from `fetch` or the SDK that quotes a header.
- Unit test 10 and end-to-end test 3 look for the token in every output.

### Tests in the existing gate

The MCP server is part of the stack (`AGENTS.md` section 2), not an optional add-on, so its
checks run inside the five gate commands rather than in a job of their own (question 1):

| Command          | Change                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck` | `tsc --noEmit && tsc -p mcp --noEmit`                                                                          |
| `pnpm test`      | Vitest gains a third project, `mcp` (Node, `mcp/src/**/*.test.ts`)                                             |
| `pnpm test:e2e`  | Runs `pnpm mcp:build` first; Playwright gains a project `mcp` (`mcp/e2e`, no browser), after `exclusive`       |
| `pnpm lint`      | Already covers `mcp/` (its `tsconfig.json` gives ESLint's project service the files); `mcp/dist/**` is ignored |

A new root script, `mcp:build`, runs esbuild. CI keeps running the same commands, so
`ci.yml` does not change. That is why CI moves from item E into this item: E keeps the
operator guide.

## 3. Files

| Path                                   | Change | Purpose                                                                    |
| -------------------------------------- | ------ | -------------------------------------------------------------------------- |
| `mcp/package.json`                     | create | `@opanel/mcp`: dependencies, `bin` `opanel-mcp`, Node ≥ 22, `type: module` |
| `mcp/tsconfig.json`                    | create | Strict, Node types, `@/*` → `../src/*`, includes `src`, `e2e`              |
| `mcp/README.md`                        | create | Build and run from a checkout, the two variables; the full guide is item E |
| `mcp/src/index.ts`                     | create | Entry: `start(process.env, fetch, process.stderr)`, exit code              |
| `mcp/src/start.ts`                     | create | Configuration, the `me` check, `serveStdio`                                |
| `mcp/src/config.ts`                    | create | Zod schema of the two variables, the `http` warning                        |
| `mcp/src/api.ts`                       | create | The API client and `ToolFailure`                                           |
| `mcp/src/redact.ts`                    | create | Token redaction                                                            |
| `mcp/src/tools.ts`                     | create | Tool definitions, `offeredTools`, `buildServer`, `toolError`               |
| `mcp/src/tools/whoami.ts`              | create | `opanel_whoami`                                                            |
| `mcp/src/*.test.ts`                    | create | Unit tests 1 to 12                                                         |
| `mcp/e2e/mcp.spec.ts`                  | create | End-to-end tests 1 to 3                                                    |
| `pnpm-workspace.yaml`                  | modify | `packages: [mcp]`; the comment no longer says "single-package"             |
| `pnpm-lock.yaml`                       | modify | The new importer                                                           |
| `package.json`                         | modify | `mcp:build`, and `typecheck` and `test:e2e` as above                       |
| `tsconfig.json`                        | modify | `exclude` gains `mcp`                                                      |
| `vitest.config.ts`                     | modify | Project `mcp`                                                              |
| `playwright.config.ts`                 | modify | Project `mcp`                                                              |
| `eslint.config.mjs`                    | modify | Ignore `mcp/dist/**`                                                       |
| `.dockerignore`, `Dockerfile`          | modify | Keep `mcp` out of the image; install the root package only                 |
| `docs/work-tracks/WT-11-mcp-server.md` | modify | Item A is WI-099; CI moves from E to A                                     |
| WI-099, WS-099                         | modify | Statuses and the implementation record                                     |

## Data model changes

None.

## API contract

None. The server calls `GET /api/v1/me` as any agent does. Opanel's server is unchanged.

## 4. Test plan (written first, in this order)

Unit tests run against a fake `fetch` and an in-memory MCP client and server pair, if the
SDK offers one; otherwise they call the handlers directly.

| #   | Level | Test                                                                                                                                           | Covers criterion |
| --- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | unit  | Configuration: a valid pair passes; a missing, empty or malformed value fails naming the variable, and the message never holds the value       | configuration    |
| 2   | unit  | `http` to another host warns once; `https`, and `http` to `localhost`, `127.0.0.1` or `[::1]`, do not                                          | configuration    |
| 3   | unit  | The client sends the bearer token, `Accept` and `User-Agent` to `<url>/api/v1<path>`, and parses a `200` with the given schema                 | client           |
| 4   | unit  | A problem body becomes a `problem` failure with `status`, `code`, `detail`, `errors` and the `X-Request-Id`                                    | errors           |
| 5   | unit  | A `200` that does not match, and a body that is not JSON, are `unexpected_response`, holding none of the body; a thrown fetch is `unreachable` | errors           |
| 6   | unit  | Start-up stops with exit 1 and the right message for each row of the table in section 2                                                        | start-up         |
| 7   | unit  | `offeredTools` keeps `null`-permission tools and those whose permission is held, for a qa_agent and a worker_agent permission set              | tools by scope   |
| 8   | unit  | `opanel_whoami` answers the agent as structured content matching `agentMeSchema`, with the text summary                                        | whoami           |
| 9   | unit  | `toolError` gives `isError: true` with the sentence and the failure as JSON, for each failure kind                                             | errors           |
| 10  | unit  | With the token placed in a problem's `detail`, in a thrown fetch message and in a non-JSON body, no tool result or stderr line holds it        | token            |
| 11  | unit  | Nothing is written to stdout outside the transport: start-up and the tools write through the given stderr only                                 | stdout           |
| 12  | unit  | No file under `src/`, `tests/` or `scripts/` imports from `mcp/`; `mcp/src` imports from `@/` only under `@/lib/schemas` and `@/lib/openapi`   | boundaries       |
| E1  | e2e   | An Admin creates a `qa_agent` and its token through the API; the SDK client starts `node mcp/dist/index.js` and lists exactly `opanel_whoami`  | e2e              |
| E2  | e2e   | `opanel_whoami` answers that agent's id, role, scopes and `projectIds: null`                                                                   | e2e, whoami      |
| E3  | e2e   | After the token is revoked, starting the server exits non-zero with the rejected-token message, and its stderr never holds the token           | e2e, token       |

## 5. Risks and open questions

1. **Where the checks run.**
   - The recommendation is inside the five gate commands (section 2), because the MCP
     server is part of the stack, unlike the optional add-ons, which have their own CI job.
   - The cost is that `pnpm test:e2e` also builds the package. The build is one esbuild
     call, under a second.
   - The alternative is a separate "MCP server" CI job, as for the add-ons.
   - **Recommendation: inside the gate.** CI then moves from item E into this item.
2. **Tool list fixed at start.** The SDK can enable tools later and notify the client
   (`list_changed`), but that would mean polling `GET /me`.
   - **Recommendation: fixed.** A restart picks up new scopes, and the API refuses
     whatever the agent lost.
3. **Two Zod copies.** The bundled schemas import `zod` from `mcp/node_modules`. If the
   SDK resolved a different Zod, its schema checks could disagree with ours. Pinning
   `zod` 4.6.7 in the package keeps one copy, and unit test 8 would fail otherwise.
4. **Docker install with a workspace.** `pnpm install --frozen-lockfile --filter opanel`
   must accept a lockfile that lists `mcp` while `mcp/` is not in the build context. If it
   refuses, the Dockerfile copies `mcp/package.json` in and still installs with the filter.
   The image workflow decides, and the choice is recorded here.
