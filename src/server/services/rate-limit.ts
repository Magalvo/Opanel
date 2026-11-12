import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import type { Database } from "@/server/db/client";

export type RateLimitExecutor = Pick<Database, "execute">;

export interface RateLimitRule {
  max: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window frees up; 0 when allowed. */
  retryAfterSeconds: number;
}

/** Sign-in: 10 attempts per email and 50 per address, per 15 minutes (WS-015). */
export const SIGN_IN_EMAIL_RULE: RateLimitRule = { max: 10, windowSeconds: 15 * 60 };
export const SIGN_IN_IP_RULE: RateLimitRule = { max: 50, windowSeconds: 15 * 60 };

/**
 * Records one attempt against `key` and says whether it is within the limit. A single
 * statement checks the window and increments, so concurrent calls cannot all pass on a
 * stale read.
 */
export async function consumeRateLimit(
  executor: RateLimitExecutor,
  key: string,
  { max, windowSeconds }: RateLimitRule,
): Promise<RateLimitResult> {
  const window = sql`make_interval(secs => ${windowSeconds})`;
  const rows = await executor.execute<{ count: number; retry_after: number }>(sql`
    insert into rate_limits (key, count, window_started_at)
    values (${key}, 1, now())
    on conflict (key) do update set
      count = case when rate_limits.window_started_at <= now() - ${window}
                    then 1 else rate_limits.count + 1 end,
      window_started_at = case when rate_limits.window_started_at <= now() - ${window}
                    then now() else rate_limits.window_started_at end
    returning count,
      ceil(extract(epoch from (window_started_at + ${window} - now())))::int as retry_after
  `);
  const row = rows[0];
  if (!row) {
    throw new Error("The rate limiter did not return a row.");
  }
  const allowed = row.count <= max;
  return { allowed, retryAfterSeconds: allowed ? 0 : Math.max(1, row.retry_after) };
}

/** Deletes counters whose window ended more than a day ago. */
export async function purgeExpiredRateLimits(executor: RateLimitExecutor): Promise<void> {
  await executor.execute(
    sql`delete from rate_limits where window_started_at < now() - interval '1 day'`,
  );
}

/**
 * The limiter keys of one sign-in attempt. The email is hashed so that no address is
 * stored; the address key exists only when a client address is known.
 */
export function signInKeys(
  email: string,
  clientIp: string | null,
): { email: string; ip: string | null } {
  const digest = createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
  return {
    email: `signin:email:${digest}`,
    ip: clientIp === null ? null : `signin:ip:${clientIp}`,
  };
}
