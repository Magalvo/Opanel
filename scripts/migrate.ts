// Applies pending database migrations: `pnpm db:migrate` in development, and
// `node dist/migrate.mjs` in the production image, where it is bundled (WS-062). It
// connects as the schema owner: MIGRATION_DATABASE_URL, else DATABASE_URL (WS-063).
import { closeMigrationDb, getMigrationDb } from "@/server/db/client";
import { migrateCommand } from "@/server/db/migrate-command";
import { EnvValidationError } from "@/server/env";
import { loadEnvFiles } from "@/server/env-files";

loadEnvFiles();

try {
  process.exitCode = await migrateCommand({ db: getMigrationDb() });
} catch (error) {
  // A bad environment: its message names the variables, never their values (WS-003).
  if (!(error instanceof EnvValidationError)) throw error;
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await closeMigrationDb();
}
