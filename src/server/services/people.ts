import { sql } from "drizzle-orm";

import type { PeopleQuery, Person, PersonPage } from "@/lib/schemas/people";
import { type Actor, requirePermission } from "@/server/auth/actor";
import { type Database, getDb } from "@/server/db/client";
import { decodeNameCursor, encodeNameCursor } from "@/server/http/pagination";

/**
 * A person (WS-026 section 1): a human account that has chosen a password. Invited accounts
 * and agents are not people. `alias` is the name the query gives the `accounts` table.
 */
export function isPerson(alias: string) {
  const a = sql.identifier(alias);
  return sql`(${a}.kind = 'human' and exists (
    select 1 from credentials c where c.account_id = ${a}.id and c.password_hash is not null))`;
}

export interface PersonRow extends Record<string, unknown> {
  id: string;
  name: string;
  active: boolean;
}

export function toPerson(row: PersonRow): Person {
  return { id: row.id, name: row.name, active: row.active };
}

/** `%`, `_` and `\` match themselves in a `like` pattern built from this. */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** The people directory (WT-03 decision 17), ordered by name then id. */
export async function listPeople(
  actor: Actor,
  query: PeopleQuery,
  db: Database = getDb(),
): Promise<PersonPage> {
  requirePermission(actor, "projects:read");

  const after =
    query.cursor === undefined
      ? sql``
      : (() => {
          const cursor = decodeNameCursor(query.cursor);
          return sql`and (lower(a.name) collate "C", a.id) > (lower(${cursor.name}::text) collate "C", ${cursor.id}::uuid)`;
        })();
  const prefix = query.q === undefined ? sql`` : sql`and a.name ilike ${`${escapeLike(query.q)}%`}`;

  const rows = await db.execute<PersonRow>(sql`
    select a.id, a.name, a.disabled_at is null as active
    from accounts a
    where ${isPerson("a")} ${prefix} ${after}
    order by lower(a.name) collate "C", a.id
    limit ${query.limit + 1}`);

  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(toPerson),
    nextCursor:
      rows.length > query.limit && last ? encodeNameCursor({ name: last.name, id: last.id }) : null,
  };
}
