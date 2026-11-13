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
  /** True only for the attempt that crosses the limit: once per key and window. */
  firstRefusal: boolean;
  /** Attempts still allowed in this window after this one; 0 at and beyond the limit. */
  remaining: number;
}

/** Sign-in: 10 attempts per email and 50 per address, per 15 minutes (WS-015). */
export const SIGN_IN_EMAIL_RULE: RateLimitRule = { max: 10, windowSeconds: 15 * 60 };
export const SIGN_IN_IP_RULE: RateLimitRule = { max: 50, windowSeconds: 15 * 60 };

/**
 * Accepting a one-time link: 30 attempts per address per 15 minutes (WS-019). Applied only
 * when a client address is known; the token is 256 random bits, so guessing it is not the
 * risk, and a limit that applied to everyone would let anyone lock out every real link.
 */
export const ACCEPT_LINK_IP_RULE: RateLimitRule = { max: 30, windowSeconds: 15 * 60 };

/**
 * Changing one's own password: 10 attempts per account per 15 minutes (WS-021). Per account,
 * not per address: the risk is someone with a stolen session cookie guessing the password,
 * and they choose their address.
 */
export const CHANGE_PASSWORD_RULE: RateLimitRule = { max: 10, windowSeconds: 15 * 60 };

/**
 * Not a limit on signing in: the budget of `auth.sign_in_failed` audit rows for the whole
 * install, 200 per 15 minutes (WS-022). The audit log is append-only, so without it anyone
 * could grow that table by one row per request.
 */
export const SIGN_IN_FAILURE_AUDIT_RULE: RateLimitRule = { max: 200, windowSeconds: 15 * 60 };
export const SIGN_IN_FAILURE_AUDIT_KEY = "signin:failure-audit";

/** The longest window of any rule: a counter older than this means nothing any more. */
export const LONGEST_WINDOW_SECONDS = Math.max(
  SIGN_IN_EMAIL_RULE.windowSeconds,
  SIGN_IN_IP_RULE.windowSeconds,
  SIGN_IN_FAILURE_AUDIT_RULE.windowSeconds,
  ACCEPT_LINK_IP_RULE.windowSeconds,
  CHANGE_PASSWORD_RULE.windowSeconds,
);

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
  return {
    allowed,
    retryAfterSeconds: allowed ? 0 : Math.max(1, row.retry_after),
    firstRefusal: row.count === max + 1,
    remaining: Math.max(0, max - row.count),
  };
}

/** Deletes counters whose window has ended. */
export async function purgeExpiredRateLimits(executor: RateLimitExecutor): Promise<void> {
  await executor.execute(sql`
    delete from rate_limits
    where window_started_at < now() - make_interval(secs => ${LONGEST_WINDOW_SECONDS})`);
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
