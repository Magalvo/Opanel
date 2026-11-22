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

let tableNames: Promise<string[]> | undefined;

/**
 * Empties every table in the public schema. Only ever runs against a test database (WS-097):
 * the list of tables is read once per module instance, and the rows are deleted in one
 * transaction with `session_replication_role = replica`, which turns off the triggers (the
 * append-only ones and the foreign-key checks) for that transaction only. Needs a superuser,
 * as the test owner is locally and in CI.
 */
export async function resetDatabase(): Promise<void> {
  assertTestDatabaseUrl(getEnv().DATABASE_URL);

  const db = getDb();
  tableNames ??= db
    .execute<{ tablename: string }>(
      sql`select tablename from pg_tables where schemaname = 'public' order by tablename`,
    )
    .then((rows) => rows.map((row) => row.tablename));
  const names = await tableNames;
  if (names.length === 0) {
    return;
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role = replica`);
    for (const name of names) {
      await tx.execute(sql`delete from ${sql.identifier(name)}`);
    }
  });
}

const POOL_ID = /^[1-9]\d*$/;

/**
 * The database of one Vitest worker (WS-097): `opanel_test` and pool 2 give
 * `opanel_w2_test`, `opanel_<id>_test` gives `opanel_<id>_w2_test`. `poolId` is
 * `VITEST_POOL_ID`, a positive integer.
 */
export function workerDatabaseUrl(url: string, poolId: string | undefined): string {
  assertTestDatabaseUrl(url);
  if (poolId === undefined || !POOL_ID.test(poolId)) {
    throw new Error("VITEST_POOL_ID must be a positive integer.");
  }
  const parsed = new URL(url);
  parsed.pathname = `/${workerPrefix(databaseNameOf(url))}${poolId}_test`;
  return parsed.toString();
}

/** `opanel_test` gives `opanel_w`; every worker database's name is this, a number, `_test`. */
function workerPrefix(templateName: string): string {
  return `${templateName.slice(0, -"_test".length)}_w`;
}

/** Whether `name` is the database of one of the workers of the test database `templateName`. */
export function isWorkerDatabaseOf(templateName: string, name: string): boolean {
  const prefix = workerPrefix(templateName);
  return (
    name.startsWith(prefix) &&
    name.endsWith("_test") &&
    POOL_ID.test(name.slice(prefix.length, -"_test".length))
  );
}

/**
 * Creates this worker's database from the template when it is missing, with
 * `synchronous_commit` off (a crash may lose its last commits, never corrupt it), and returns
 * its URL (WS-097). Nothing may be connected to the template meanwhile.
 */
export async function ensureWorkerDatabase(
  templateUrl: string,
  poolId: string | undefined,
): Promise<string> {
  const url = workerDatabaseUrl(templateUrl, poolId);
  const name = databaseNameOf(url);
  const server = maintenanceConnection(templateUrl);
  try {
    const found = await server`select 1 from pg_database where datname = ${name}`;
    if (found.length === 0) {
      await server`create database ${server(name)} template ${server(databaseNameOf(templateUrl))}`;
      await server`alter database ${server(name)} set synchronous_commit = off`;
    }
  } finally {
    await server.end();
  }
  return url;
}

/** Drops every worker database of the template (WS-097) and returns their names. */
export async function dropWorkerDatabases(templateUrl: string): Promise<string[]> {
  assertTestDatabaseUrl(templateUrl);
  const template = databaseNameOf(templateUrl);
  const server = maintenanceConnection(templateUrl);
  try {
    const rows = await server<{ datname: string }[]>`select datname from pg_database`;
    const names = rows
      .map((row) => row.datname)
      .filter((name) => isWorkerDatabaseOf(template, name));
    for (const name of names) {
      await server`drop database if exists ${server(name)}`;
    }
    return names;
  } finally {
    await server.end();
  }
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
