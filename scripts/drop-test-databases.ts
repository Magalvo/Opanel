// `pnpm test:db:drop`: drops this checkout's integration and end-to-end databases, with the
// names the tests use. `pnpm test:db:drop --stale` lists the databases of worktrees that no
// longer exist (`opanel_<id>_test`, `opanel_<id>_e2e_test`); with `--yes` it drops them.
// Only names ending in "_test", never by force: a database in use is kept (WS-095).
import { execFileSync } from "node:child_process";

import postgres from "postgres";

import { dropTestDatabase } from "@/server/db/testing";
import {
  applyWorktreeTestDatabase,
  pathWorktreeId,
  staleTestDatabases,
  worktreeId,
} from "@/server/db/worktree";
import { loadEnvFiles } from "@/server/env-files";

import { E2E_DATABASE_URL } from "../tests/e2e/environment";

// The settings the tests read: `.env.test`, then the shell.
Object.assign(process.env, { NODE_ENV: "test" });
loadEnvFiles();
applyWorktreeTestDatabase(process.env);

function say(line: string): void {
  process.stdout.write(`${line}
`);
}

function nameOf(url: string): string {
  return new URL(url).pathname.replace(/^\//, "");
}

function withName(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

/** The IDs of every worktree Git knows, and this checkout's own. */
function liveWorktreeIds(): Set<string> {
  const listing = execFileSync("git", ["worktree", "list", "--porcelain"], { encoding: "utf8" });
  const ids = listing
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => pathWorktreeId(line.slice("worktree ".length)));
  const own = worktreeId(process.env);
  return new Set(own === undefined ? ids : [...ids, own]);
}

async function databaseNames(url: string): Promise<string[]> {
  const server = postgres(withName(url, "postgres"), { onnotice: () => undefined, max: 1 });
  try {
    const rows = await server<{ datname: string }[]>`select datname from pg_database`;
    return rows.map((row) => row.datname).sort();
  } finally {
    await server.end();
  }
}

async function drop(urls: readonly string[]): Promise<boolean> {
  let ok = true;
  for (const url of urls) {
    const name = nameOf(url);
    try {
      const result = await dropTestDatabase(url);
      say(result === "dropped" ? `Dropped ${name}.` : `${name} does not exist.`);
    } catch (error) {
      ok = false;
      const code = (error as { code?: string }).code;
      console.error(
        code === "55006"
          ? `Kept ${name}: it is in use, probably by a test run.`
          : `Could not drop ${name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return ok;
}

async function main(args: readonly string[]): Promise<boolean> {
  const integrationUrl = process.env.DATABASE_URL;
  if (integrationUrl === undefined || !URL.canParse(integrationUrl)) {
    console.error("DATABASE_URL is not set: it comes from .env.test or the shell.");
    return false;
  }

  if (!args.includes("--stale")) {
    return drop([integrationUrl, E2E_DATABASE_URL]);
  }

  const stale = staleTestDatabases(await databaseNames(integrationUrl), liveWorktreeIds());
  if (stale.length === 0) {
    say("No databases of removed worktrees.");
    return true;
  }
  if (!args.includes("--yes")) {
    say("Databases of worktrees that no longer exist:");
    for (const name of stale) {
      say(`  ${name}`);
    }
    say("Run `pnpm test:db:drop --stale --yes` to drop them.");
    return true;
  }
  return drop(stale.map((name) => withName(integrationUrl, name)));
}

try {
  process.exitCode = (await main(process.argv.slice(2))) ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
