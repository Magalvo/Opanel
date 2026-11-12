// Runs before the app under test is built and started (see playwright.config.ts).
// Checks that DATABASE_URL points at a reachable end-to-end database, then migrates it.
import { closeDb, getDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { getEnv } from "@/server/env";

import { E2E_DATABASE_SUFFIX } from "./environment";

function databaseName(url: string): string {
  return URL.canParse(url) ? new URL(url).pathname.replace(/^\//, "") : "";
}

async function prepare(): Promise<void> {
  if (!databaseName(getEnv().DATABASE_URL).endsWith(E2E_DATABASE_SUFFIX)) {
    throw new Error(
      `Refusing to run end-to-end tests: the database name must end in "${E2E_DATABASE_SUFFIX}".`,
    );
  }

  try {
    await getDb().$client`select 1`;
  } catch {
    throw new Error(
      "Cannot reach the end-to-end database. Start it with `docker compose up -d`. " +
        "If the database does not exist yet, recreate the volume once: " +
        "`docker compose down -v && docker compose up -d`.",
    );
  }

  await runMigrations(getDb());
}

try {
  await prepare();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
