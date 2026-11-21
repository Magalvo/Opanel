import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { prepare } from "./start";
import { buildServer, TOOLS } from "./tools";

// Opanel's MCP server (doc 0005): `node mcp/dist/index.js`, started by the assistant with
// OPANEL_URL and OPANEL_TOKEN. Stdout carries MCP messages only; everything else is stderr.

const prepared = await prepare({
  env: process.env,
  fetch: globalThis.fetch,
  stderr: process.stderr,
});

if (!prepared.ok) {
  process.exitCode = 1;
} else {
  const { api, redact, me } = prepared;
  const handle = serveStdio(() => buildServer(TOOLS, { api, redact }, me.permissions), {
    onerror: (error) => {
      process.stderr.write(`opanel-mcp: ${redact(error.message)}\n`);
    },
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void handle.close();
    });
  }
}
