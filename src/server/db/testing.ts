import { sql } from "drizzle-orm";
import postgres from "postgres";

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
 * test setups, as the owner, against a test database only. Roles belong to the whole
 * server, so two worktrees' setups may race to create it: the loser does nothing (WS-095).
 */
export async function ensureRuntimeTestRole(
  db: Database,
  role: string = RUNTIME_TEST_ROLE,
): Promise<void> {
  if (!/^[a-z0-9_]+$/.test(role)) {
    throw new Error("A test role name holds only lower-case letters, digits and underscores.");
  }
  await db.execute(
    sql.raw(`
    do $$ begin
      if exists (select from pg_roles where rolname = 'opanel_app')
        and not exists (select from pg_roles where rolname = '${role}') then
        create role ${role} login password '${role}' in role opanel_app;
      end if;
    exception when duplicate_object or unique_violation then null;
    end $$`),
  );
}

function databaseNameOf(url: string): string {
  return new URL(url).pathname.replace(/^\//, "");
}

/** The same server and user, connected to the maintenance database `postgres`. */
function maintenanceConnection(url: string): postgres.Sql {
  const parsed = new URL(url);
  parsed.pathname = "/postgres";
  return postgres(parsed.toString(), { onnotice: () => undefined, max: 1 });
}

/**
 * Creates the test database of the URL when it is missing (WS-095), owned by the connecting
 * user. Refuses any name that does not end in "_test". Two processes may race: the loser
 * does nothing.
 */
export async function ensureTestDatabase(url: string): Promise<void> {
  assertTestDatabaseUrl(url);
  const name = databaseNameOf(url);
  const server = maintenanceConnection(url);
  try {
    const found = await server`select 1 from pg_database where datname = ${name}`;
    if (found.length === 0) {
      await server`create database ${server(name)}`.catch((error: unknown) => {
        const code = (error as { code?: string }).code;
        if (code !== "42P04" && code !== "23505") {
          throw error;
        }
      });
    }
  } finally {
    await server.end();
  }
}

/**
 * Drops the test database of the URL (WS-095): "missing" when there is none. Refuses any
 * name that does not end in "_test". A database in use is not forced: PostgreSQL's error
 * (55006) reaches the caller.
 */
export async function dropTestDatabase(url: string): Promise<"dropped" | "missing"> {
  assertTestDatabaseUrl(url);
  const name = databaseNameOf(url);
  const server = maintenanceConnection(url);
  try {
    const found = await server`select 1 from pg_database where datname = ${name}`;
    if (found.length === 0) {
      return "missing";
    }
    await server`drop database if exists ${server(name)}`;
    return "dropped";
  } finally {
    await server.end();
  }
}
