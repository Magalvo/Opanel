import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { getEnv, getMigrationEnv, migrationDatabaseUrl } from "@/server/env";

import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema> & { $client: postgres.Sql };

// Kept on globalThis so that hot reload in development reuses the pool instead of
// opening a new one for every reloaded copy of this module.
const store = globalThis as typeof globalThis & {
  __opanelDb?: Database;
  __opanelMigrationDb?: Database;
};

/**
 * The application's database client. Created on first call, so importing this module
 * opens no connection and `next build` needs no database.
 */
export function getDb(): Database {
  store.__opanelDb ??= drizzle({
    client: postgres(getEnv().DATABASE_URL, {
      // Notices (for example "table does not exist, skipping") are not errors.
      onnotice: () => undefined,
    }),
    schema,
  });
  return store.__opanelDb;
}

/** Closes the pool. Used by scripts and tests so the process can exit. */
export async function closeDb(): Promise<void> {
  const db = store.__opanelDb;
  delete store.__opanelDb;
  await db?.$client.end();
}

/**
 * The schema owner's connection, for `migrate` only (WS-063): `MIGRATION_DATABASE_URL`, or
 * `DATABASE_URL` when it is not set. Created on first call.
 */
export function getMigrationDb(): Database {
  store.__opanelMigrationDb ??= drizzle({
    client: postgres(migrationDatabaseUrl(getMigrationEnv()), { onnotice: () => undefined }),
    schema,
  });
  return store.__opanelMigrationDb;
}

/** Closes the migration connection. */
export async function closeMigrationDb(): Promise<void> {
  const db = store.__opanelMigrationDb;
  delete store.__opanelMigrationDb;
  await db?.$client.end();
}
