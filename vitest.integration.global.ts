// Runs once, in the main Vitest process, before any integration test file.
import { closeDb, getDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import {
  assertTestDatabaseUrl,
  ensureRuntimeTestRole,
  ensureTestDatabase,
} from "@/server/db/testing";
import { applyWorktreeTestDatabase } from "@/server/db/worktree";
import { getEnv } from "@/server/env";
import { loadEnvFiles } from "@/server/env-files";

export default async function setup(): Promise<void> {
  loadEnvFiles();
  // This worktree's own database (WS-095); unchanged in the main checkout and in CI.
  applyWorktreeTestDatabase(process.env);
  assertTestDatabaseUrl(getEnv().DATABASE_URL);

  try {
    await ensureTestDatabase(getEnv().DATABASE_URL);
    await getDb().$client`select 1`;
  } catch (cause) {
    throw new Error(
      "Cannot reach the test database. Start PostgreSQL with `docker compose up -d` and try again.",
      { cause },
    );
  }

  await runMigrations(getDb());
  await ensureRuntimeTestRole(getDb());
  await closeDb();
}
