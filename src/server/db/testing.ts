import { sql } from "drizzle-orm";

import { getEnv } from "@/server/env";

import { getDb } from "./client";

/**
 * Throws unless the URL points at a database whose name ends in "_test".
 * The message never contains the URL, which may hold credentials.
 */
export function assertTestDatabaseUrl(url: string): void {
  const name = URL.canParse(url) ? new URL(url).pathname.replace(/^\//, "") : "";
  if (!name.endsWith("_test")) {
    throw new Error(
      'Refusing to touch this database: the database name in DATABASE_URL must end in "_test". ' +
        "Integration tests read their configuration from .env.test.",
    );
  }
}

/** Empties every table in the public schema. Only ever runs against a test database. */
export async function resetDatabase(): Promise<void> {
  assertTestDatabaseUrl(getEnv().DATABASE_URL);

  const db = getDb();
  const tables = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  if (tables.length === 0) {
    return;
  }

  const names = sql.join(
    tables.map((table) => sql.identifier(table.tablename)),
    sql`, `,
  );
  await db.execute(sql`truncate table ${names} restart identity cascade`);
}
