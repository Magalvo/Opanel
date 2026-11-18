import { sql } from "drizzle-orm";

import { type Database, getDb } from "@/server/db/client";

import { purgeExpiredRateLimits } from "./rate-limit";

/** How long a used link, or an unused one past its expiry, is kept (doc 0006 section 8). */
export const LINK_RETENTION_DAYS = 30;

export interface MaintenanceResult {
  sessions: number;
  links: number;
  rateLimits: number;
  verifications: number;
}

/**
 * Deletes what has expired (WS-066, canonical doc 0006 section 8): expired sessions, links
 * used or expired more than `LINK_RETENTION_DAYS` ago, ended rate-limit counters and expired
 * `verification` rows. Each is its own statement. Nothing a person did is removed: the audit
 * log, the task history and comments are never touched, and no audit entry is written.
 * Runs as the runtime role (WS-063).
 */
export async function runMaintenance(
  db: Pick<Database, "execute"> = getDb(),
): Promise<MaintenanceResult> {
  const sessions = await db.execute(sql`delete from sessions where expires_at < now()`);
  const links = await db.execute(sql`
    delete from account_tokens
    where (used_at is not null and used_at < now() - make_interval(days => ${LINK_RETENTION_DAYS}))
       or (used_at is null and expires_at < now() - make_interval(days => ${LINK_RETENTION_DAYS}))`);
  const rateLimits = await purgeExpiredRateLimits(db);
  const verifications = await db.execute(sql`delete from verification where expires_at < now()`);
  return {
    sessions: sessions.count,
    links: links.count,
    rateLimits,
    verifications: verifications.count,
  };
}
