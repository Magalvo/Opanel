import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getDb } from "@/server/db/client";
import { rateLimits } from "@/server/db/schema";

import { consumeRateLimit, purgeExpiredRateLimits, signInKeys } from "./rate-limit";

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

  it("keeps keys independent", async () => {
    for (let i = 0; i < 4; i++) await consumeRateLimit(getDb(), "a", rule);

    expect((await consumeRateLimit(getDb(), "b", rule)).allowed).toBe(true);
  });
});

describe("signInKeys", () => {
  it("never holds the raw email, ignores its case, and adds the address only when known", async () => {
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
});
