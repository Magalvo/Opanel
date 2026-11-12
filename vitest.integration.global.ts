// Runs once, in the main Vitest process, before any integration test file.
import { closeDb, getDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { assertTestDatabaseUrl } from "@/server/db/testing";
import { getEnv } from "@/server/env";
import { loadEnvFiles } from "@/server/env-files";

export default async function setup(): Promise<void> {
  loadEnvFiles();
  assertTestDatabaseUrl(getEnv().DATABASE_URL);

  try {
    await getDb().$client`select 1`;
  } catch (cause) {
    throw new Error(
      "Cannot reach the test database. Start it with `docker compose up -d` and try again.",
      { cause },
    );
  }

  await runMigrations(getDb());
  await closeDb();
}
