// Runs once, in the main Vitest process, before any integration test file.
import { closeDb, getDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import {
  assertTestDatabaseUrl,
  dropWorkerDatabases,
  ensureRuntimeTestRole,
  ensureTestDatabase,
} from "@/server/db/testing";
import { applyWorktreeTestDatabase } from "@/server/db/worktree";
import { getEnv } from "@/server/env";
import { loadEnvFiles } from "@/server/env-files";

export default async function setup(): Promise<() => Promise<void>> {
  loadEnvFiles();
  // This worktree's own database (WS-095); unchanged in the main checkout and in CI.
  applyWorktreeTestDatabase(process.env);
  const template = getEnv().DATABASE_URL;
  assertTestDatabaseUrl(template);

  try {
    await ensureTestDatabase(template);
    await getDb().$client`select 1`;
  } catch (cause) {
    throw new Error(
      "Cannot reach the test database. Start PostgreSQL with `docker compose up -d` and try again.",
      { cause },
    );
  }

  await runMigrations(getDb());
  await ensureRuntimeTestRole(getDb());
  // The migrated database is the template of every worker's (WS-097): nothing may stay
  // connected to it, and copies from an earlier run, maybe of an older schema, go.
  await closeDb();
  await dropWorkerDatabases(template);

  return async () => {
    await dropWorkerDatabases(template);
  };
}
