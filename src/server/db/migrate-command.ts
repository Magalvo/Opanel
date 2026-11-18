import { describeError } from "@/server/http/safe-error";

import type { Database } from "./client";
import { runMigrations } from "./migrate";

/**
 * The `migrate` command (WS-062 section 3): applies pending migrations and answers the
 * process exit code. A failure is logged by its class and code only (WS-042), never with
 * its message, which can hold the connection string or the database's address.
 */
export async function migrateCommand({
  db,
  log = console.warn,
  logError = console.error,
}: {
  db: Database;
  log?: (message: string) => void;
  logError?: (message: string) => void;
}): Promise<number> {
  try {
    const result = await runMigrations(db);
    log(result === "applied" ? "Migrations are up to date." : "No migrations to apply yet.");
    return 0;
  } catch (error) {
    logError(`Migrations failed: ${describeError(error)}`);
    return 1;
  }
}
