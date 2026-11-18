import { sql } from "drizzle-orm";

import { getEnv } from "@/server/env";

import { type Database, getDb } from "./client";

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

/**
 * A login member of `opanel_app`, for the tests that connect as the app does (WS-063). Its
 * password is a local default, like the rest of `.env.test`: test databases only.
 */
export const RUNTIME_TEST_ROLE = "opanel_app_test";

/** The URL of the same database, connecting as the runtime test role. */
export function runtimeTestUrl(url: string): string {
  const parsed = new URL(url);
  parsed.username = RUNTIME_TEST_ROLE;
  parsed.password = RUNTIME_TEST_ROLE;
  return parsed.toString();
}

/**
 * Creates the runtime test role once the migrations have created `opanel_app`. Run by the
 * test setups, as the owner, against a test database only.
 */
export async function ensureRuntimeTestRole(db: Database): Promise<void> {
  await db.execute(
    sql.raw(`
    do $$ begin
      if exists (select from pg_roles where rolname = 'opanel_app')
        and not exists (select from pg_roles where rolname = '${RUNTIME_TEST_ROLE}') then
        create role ${RUNTIME_TEST_ROLE} login password '${RUNTIME_TEST_ROLE}' in role opanel_app;
      end if;
    end $$`),
  );
}
