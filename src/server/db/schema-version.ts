// Whether the database's schema is the one this build of the app was made for (WS-064,
// canonical doc 0006 section 6). The journal is imported, so the built app carries the
// migrations it knows; nothing is read from disk at run time.
import { sql } from "drizzle-orm";

import { describeError } from "@/server/http/safe-error";

import type { Database } from "./client";
import { hasPostgresCode } from "./errors";
import journal from "./migrations/meta/_journal.json";

/** PostgreSQL's code for a table that does not exist. */
const UNDEFINED_TABLE = "42P01";

export interface KnownMigration {
  tag: string;
  /** The migrator's `created_at` for it: the journal entry's `when`, in milliseconds. */
  when: number;
}

export const KNOWN_MIGRATIONS: readonly KnownMigration[] = journal.entries.map((entry) => ({
  tag: entry.tag,
  when: entry.when,
}));

export type SchemaComparison =
  | { kind: "match" }
  | { kind: "behind"; last: string | null; needed: string }
  | { kind: "ahead"; last: string; appliedAt: string };

/**
 * Compares the migrations the app knows with the latest one the database has applied (its
 * `created_at`, null when none), as the migrator itself decides what is applied.
 */
export function compareSchema(
  known: readonly KnownMigration[],
  applied: number | null,
): SchemaComparison {
  const latest = known.at(-1);
  if (latest === undefined) return { kind: "match" };
  if (applied === latest.when) return { kind: "match" };
  if (applied === null || applied < latest.when) {
    const last = applied === null ? null : (known.findLast((item) => item.when <= applied) ?? null);
    return { kind: "behind", last: last?.tag ?? null, needed: latest.tag };
  }
  return { kind: "ahead", last: latest.tag, appliedAt: new Date(applied).toISOString() };
}

/** What the operator reads when the server refuses to start. */
export function schemaMismatchMessage(
  result: Exclude<SchemaComparison, { kind: "match" }>,
): string {
  if (result.kind === "behind") {
    const has =
      result.last === null
        ? "no migration has been applied"
        : `its last migration is ${result.last}`;
    return (
      `The database schema is behind this version of Opanel: ${has}, ` +
      `this version needs ${result.needed}. Run migrate first.`
    );
  }
  return (
    "The database has a migration this version of Opanel does not know, applied at " +
    `${result.appliedAt}; this version's last is ${result.last}. Run the version ` +
    "that applied it, or restore the backup taken before the upgrade."
  );
}

/** What `appliedSchemaVersion` needs: the client or a transaction. */
type Executor = Pick<Database, "execute">;

/**
 * The `created_at` of the latest migration the database has applied: null when the
 * migrations' table does not exist yet (`42P01`) or is empty.
 */
export async function appliedSchemaVersion(db: Executor): Promise<number | null> {
  try {
    const rows = await db.execute<{ latest: string | null }>(
      sql`select max(created_at)::text as latest from drizzle.__drizzle_migrations`,
    );
    const latest = rows[0]?.latest ?? null;
    return latest === null ? null : Number(latest);
  } catch (error) {
    if (hasPostgresCode(error, UNDEFINED_TABLE)) return null;
    throw error;
  }
}

/**
 * Run when the server starts (WS-064 section 3): stops it on a schema it does not match.
 * A database it cannot read (unreachable, or without the grant) is tried again every
 * `retryEveryMs` until `giveUpAfterMs`; every
 * line logged names the error's class and code only (WS-042), never the connection string.
 */
export async function verifySchema({
  db,
  exit,
  log = console.error,
  retryEveryMs = 2_000,
  giveUpAfterMs = 30_000,
}: {
  db: Executor;
  exit: (code: number) => void;
  log?: (message: string) => void;
  retryEveryMs?: number;
  giveUpAfterMs?: number;
}): Promise<void> {
  const deadline = Date.now() + giveUpAfterMs;
  let applied: number | null;
  for (let attempt = 1; ; attempt++) {
    try {
      applied = await appliedSchemaVersion(db);
      break;
    } catch (error) {
      const last = Date.now() + retryEveryMs > deadline;
      if (attempt === 1 || last) {
        log(
          `Cannot read the database's schema version (${describeError(error)})` +
            (last ? ". Giving up." : `; trying again for ${String(giveUpAfterMs / 1000)} s.`),
        );
      }
      if (last) {
        exit(1);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, retryEveryMs));
    }
  }
  const result = compareSchema(KNOWN_MIGRATIONS, applied);
  if (result.kind === "match") return;
  log(schemaMismatchMessage(result));
  exit(1);
}
