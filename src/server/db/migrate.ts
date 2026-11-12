import { existsSync } from "node:fs";
import path from "node:path";

import { migrate } from "drizzle-orm/postgres-js/migrator";

import type { Database } from "./client";

export const MIGRATIONS_FOLDER = path.join(process.cwd(), "src/server/db/migrations");

export type MigrationResult = "applied" | "no-migrations";

/**
 * Applies pending migrations. Until the first migration has been generated there is no
 * journal file, which is treated as nothing to do rather than an error.
 */
export async function runMigrations(
  db: Database,
  migrationsFolder: string = MIGRATIONS_FOLDER,
): Promise<MigrationResult> {
  if (!existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
    return "no-migrations";
  }
  await migrate(db, { migrationsFolder });
  return "applied";
}
