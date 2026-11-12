// Applies pending database migrations: `pnpm db:migrate`.
import { closeDb, getDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { loadEnvFiles } from "@/server/env-files";

loadEnvFiles();

try {
  const result = await runMigrations(getDb());
  console.warn(result === "applied" ? "Migrations are up to date." : "No migrations to apply yet.");
} finally {
  await closeDb();
}
