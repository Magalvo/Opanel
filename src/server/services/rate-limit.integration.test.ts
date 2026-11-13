import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getDb } from "@/server/db/client";
import { rateLimits } from "@/server/db/schema";

import {
  ACCEPT_LINK_IP_RULE,
  CHANGE_PASSWORD_RULE,
  consumeRateLimit,
  LONGEST_WINDOW_SECONDS,
  purgeExpiredRateLimits,
  SIGN_IN_EMAIL_RULE,
  SIGN_IN_FAILURE_AUDIT_RULE,
  SIGN_IN_IP_RULE,
  signInKeys,
} from "./rate-limit";

const rule = { max: 3, windowSeconds: 900 };

describe("consumeRateLimit", () => {
  it("allows up to max, then refuses with a retry delay inside the window", async () => {
    for (let i = 0; i < 3; i++) {
      expect((await consumeRateLimit(getDb(), "k", rule)).allowed).toBe(true);
    }

    const refused = await consumeRateLimit(getDb(), "k", rule);

    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(900);
  });

  it("starts a new window once the old one has elapsed", async () => {
    for (let i = 0; i < 4; i++) await consumeRateLimit(getDb(), "k", rule);
    await getDb().execute(
      sql`update rate_limits set window_started_at = now() - interval '1 hour' where key = 'k'`,
    );

    expect((await consumeRateLimit(getDb(), "k", rule)).allowed).toBe(true);
    const [row] = await getDb().select().from(rateLimits);
    expect(row?.count).toBe(1);
  });

  it("counts concurrent calls exactly: 30 at once with max 10 allow 10", async () => {
    const results = await Promise.all(
      Array.from({ length: 30 }, () =>
        consumeRateLimit(getDb(), "race", { max: 10, windowSeconds: 900 }),
      ),
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(10);
  });

  it("marks the first refusal of a window, once, and again in a new window", async () => {
    const flags: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      flags.push((await consumeRateLimit(getDb(), "k", rule)).firstRefusal);
    }

    // max is 3: the 4th attempt is the first one refused.
    expect(flags).toEqual([false, false, false, true, false, false]);

    await getDb().execute(
      sql`update rate_limits set window_started_at = now() - interval '1 hour' where key = 'k'`,
    );
    const next: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      next.push((await consumeRateLimit(getDb(), "k", rule)).firstRefusal);
    }
    expect(next).toEqual([false, false, false, true]);
  });

  it("marks exactly one first refusal among concurrent calls", async () => {
    const results = await Promise.all(
      Array.from({ length: 30 }, () =>
        consumeRateLimit(getDb(), "race", { max: 10, windowSeconds: 900 }),
      ),
    );

    expect(results.filter((result) => result.firstRefusal)).toHaveLength(1);
  });

  it("reports how much of the limit is left", async () => {
    const remaining: number[] = [];
    for (let i = 0; i < 5; i++) {
      remaining.push((await consumeRateLimit(getDb(), "k", rule)).remaining);
    }

    expect(remaining).toEqual([2, 1, 0, 0, 0]);
  });

  it("keeps keys independent", async () => {
    for (let i = 0; i < 4; i++) await consumeRateLimit(getDb(), "a", rule);

    expect((await consumeRateLimit(getDb(), "b", rule)).allowed).toBe(true);
  });
});

describe("signInKeys", () => {
  it("never holds the raw email, ignores its case, and adds the address only when known", () => {
    const keys = signInKeys("Ada@Example.com", "203.0.113.7");
    const same = signInKeys("ada@example.com", null);

    expect(keys.email).toBe(same.email);
    expect(keys.email).not.toContain("ada");
    expect(keys.email).not.toContain("example");
    expect(keys.ip).toBe("signin:ip:203.0.113.7");
    expect(same.ip).toBeNull();
  });
});

describe("purgeExpiredRateLimits", () => {
  it("deletes rows older than a day and keeps recent ones", async () => {
    await consumeRateLimit(getDb(), "old", rule);
    await consumeRateLimit(getDb(), "recent", rule);
    await getDb().execute(
      sql`update rate_limits set window_started_at = now() - interval '2 days' where key = 'old'`,
    );

    await purgeExpiredRateLimits(getDb());

    const rows = await getDb().select().from(rateLimits);
    expect(rows.map((row) => row.key)).toEqual(["recent"]);
  });

  it("deletes a counter as soon as its window has ended, and keeps one inside its window", async () => {
    await consumeRateLimit(getDb(), "ended", rule);
    await consumeRateLimit(getDb(), "running", rule);
    const longest = String(LONGEST_WINDOW_SECONDS);
    await getDb().execute(sql`
      update rate_limits
      set window_started_at = now() - make_interval(secs => ${longest}::int + 1)
      where key = 'ended'`);
    await getDb().execute(sql`
      update rate_limits
      set window_started_at = now() - make_interval(secs => ${longest}::int - 60)
      where key = 'running'`);

    await purgeExpiredRateLimits(getDb());

    const rows = await getDb().select().from(rateLimits);
    expect(rows.map((row) => row.key)).toEqual(["running"]);
  });

  it("uses a window at least as long as every sign-in rule", () => {
    for (const limit of [SIGN_IN_EMAIL_RULE, SIGN_IN_IP_RULE, SIGN_IN_FAILURE_AUDIT_RULE]) {
      expect(LONGEST_WINDOW_SECONDS).toBeGreaterThanOrEqual(limit.windowSeconds);
    }
    expect(SIGN_IN_FAILURE_AUDIT_RULE).toEqual({ max: 200, windowSeconds: 900 });
  });
});

describe("ACCEPT_LINK_IP_RULE", () => {
  it("is 30 attempts per 15 minutes and is covered by the purge window", () => {
    expect(ACCEPT_LINK_IP_RULE).toEqual({ max: 30, windowSeconds: 900 });
    expect(LONGEST_WINDOW_SECONDS).toBeGreaterThanOrEqual(ACCEPT_LINK_IP_RULE.windowSeconds);
  });

  it("refuses the 31st attempt of one key with a retry delay", async () => {
    for (let i = 0; i < 30; i++) {
      expect(
        (await consumeRateLimit(getDb(), "accept:ip:203.0.113.9", ACCEPT_LINK_IP_RULE)).allowed,
      ).toBe(true);
    }

    const refused = await consumeRateLimit(getDb(), "accept:ip:203.0.113.9", ACCEPT_LINK_IP_RULE);

    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe("CHANGE_PASSWORD_RULE", () => {
  it("is 10 attempts per 15 minutes and is covered by the purge window", () => {
    expect(CHANGE_PASSWORD_RULE).toEqual({ max: 10, windowSeconds: 900 });
    expect(LONGEST_WINDOW_SECONDS).toBeGreaterThanOrEqual(CHANGE_PASSWORD_RULE.windowSeconds);
  });
});
