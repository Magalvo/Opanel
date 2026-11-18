// Runs before the app under test is built and started (see playwright.config.ts).
// Checks that the owner's connection (MIGRATION_DATABASE_URL) points at a reachable
// end-to-end database, migrates it, and creates the runtime test role the app connects as
// (WS-063).
import { sql } from "drizzle-orm";

import { closeMigrationDb, getMigrationDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { ensureRuntimeTestRole } from "@/server/db/testing";
import { getEnv, migrationDatabaseUrl } from "@/server/env";

import { E2E_DATABASE_SUFFIX } from "./environment";

function databaseName(url: string): string {
  return URL.canParse(url) ? new URL(url).pathname.replace(/^\//, "") : "";
}

async function prepare(): Promise<void> {
  const env = getEnv();
  if (
    !databaseName(env.DATABASE_URL).endsWith(E2E_DATABASE_SUFFIX) ||
    !databaseName(migrationDatabaseUrl(env)).endsWith(E2E_DATABASE_SUFFIX)
  ) {
    throw new Error(
      `Refusing to run end-to-end tests: the database name must end in "${E2E_DATABASE_SUFFIX}".`,
    );
  }

  try {
    await getMigrationDb().$client`select 1`;
  } catch {
    throw new Error(
      "Cannot reach the end-to-end database. Start it with `docker compose up -d`. " +
        "If the database does not exist yet, recreate the volume once: " +
        "`docker compose down -v && docker compose up -d`.",
    );
  }

  await runMigrations(getMigrationDb());
  await ensureRuntimeTestRole(getMigrationDb());

  // The first-run setup test needs an install with no accounts, and this database is not
  // emptied between runs. Safe: the name was checked above. Cascades to credentials,
  // sessions and the audit log; rate limits are emptied too so each run starts clean.
  await getMigrationDb().execute(
    sql`truncate table accounts, rate_limits restart identity cascade`,
  );
}

try {
  await prepare();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeMigrationDb();
}
