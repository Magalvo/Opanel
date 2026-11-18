import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

import { authenticate } from "@/server/auth/authenticate";
import { createTestAccount, signInCookie, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import * as schema from "@/server/db/schema";
import { runtimeTestUrl } from "@/server/db/testing";
import { getEnv } from "@/server/env";

import { createComment } from "./comments";
import { runMaintenance } from "./maintenance";
import { createProject } from "./projects";
import { createTask } from "./tasks";

const DAY = "1 day";

async function count(table: string, where = "true"): Promise<number> {
  const rows = await getDb().execute<{ n: number }>(
    sql.raw(`select count(*)::int as n from ${table} where ${where}`),
  );
  return rows[0]?.n ?? 0;
}

/** Seeds one account's expired session, links of every age, counters and verifications. */
async function seed() {
  const owner = await createTestAccount({ email: "owner@example.com", role: "manager" });
  const db = getDb();
  const link = (name: string, used: string | null, expires: string) =>
    db.execute(
      sql.raw(`insert into account_tokens (account_id, kind, token_hash, expires_at, used_at, created_by)
        values ('${owner.id}', 'reset', '${name}', now() + interval '${expires}',
          ${used === null ? "null" : `now() - interval '${used}'`}, '${owner.id}')`),
    );
  await db.execute(
    sql.raw(`insert into sessions (account_id, token, expires_at)
      values ('${owner.id}', 'expired-${randomUUID()}', now() - interval '1 minute')`),
  );
  await link("used-31-days", "31 days", "-24 days");
  await link("used-29-days", "29 days", "-22 days");
  await link("expired-31-days", null, "-31 days");
  // Only one unused link per account (WS-059): the other unused ones belong to others.
  const other = await createTestAccount({ email: "other@example.com" });
  const third = await createTestAccount({ email: "third@example.com" });
  await db.execute(
    sql.raw(`insert into account_tokens (account_id, kind, token_hash, expires_at, created_by)
      values ('${other.id}', 'reset', 'expired-29-days', now() - interval '29 days', '${owner.id}'),
             ('${third.id}', 'reset', 'still-valid', now() + interval '6 days', '${owner.id}')`),
  );
  await db.execute(
    sql.raw(`insert into rate_limits (key, count, window_started_at)
      values ('ended', 3, now() - interval '30 days'), ('running', 1, now())`),
  );
  await db.execute(
    sql.raw(`insert into verification (identifier, value, expires_at)
      values ('old', 'x', now() - interval '${DAY}'), ('new', 'y', now() + interval '${DAY}')`),
  );
  const actor = testActor(owner);
  const project = await createProject(actor, { key: "MNT", name: "Maintenance" });
  const task = await createTask(actor, project.key, { title: "Kept forever" });
  await createComment(actor, task.key, { body: "Kept forever too." });
  return { owner };
}

describe("runMaintenance (WS-066 section 2)", () => {
  it("deletes what has expired, keeps the rest, and says how many", async () => {
    await seed();
    const cookie = await signInCookie("owner@example.com");
    const history = {
      audit: await count("audit_log"),
      events: await count("task_events"),
      comments: await count("comments"),
    };

    const deleted = await runMaintenance();

    expect(deleted).toEqual({ sessions: 1, links: 2, rateLimits: 1, verifications: 1 });
    expect(
      (
        await getDb().execute<{ token_hash: string }>(
          sql`select token_hash from account_tokens order by token_hash`,
        )
      ).map((row) => row.token_hash),
    ).toEqual(["expired-29-days", "still-valid", "used-29-days"]);
    expect(await count("rate_limits")).toBe(1);
    expect(await count("verification", "identifier = 'new'")).toBe(1);
    expect(await count("sessions", "expires_at < now()")).toBe(0);
    const request = new Request("http://localhost:3000/api/v1/me", { headers: { cookie } });
    expect((await authenticate(request)).account.email).toBe("owner@example.com");
    expect({
      audit: await count("audit_log"),
      events: await count("task_events"),
      comments: await count("comments"),
    }).toEqual(history);
    expect(history.events).toBeGreaterThan(0);
    expect(history.comments).toBe(1);
  });

  it("deletes nothing the second time", async () => {
    await seed();
    await runMaintenance();

    expect(await runMaintenance()).toEqual({
      sessions: 0,
      links: 0,
      rateLimits: 0,
      verifications: 0,
    });
  });

  it("runs as the runtime role (WS-063)", async () => {
    await seed();
    const client = postgres(runtimeTestUrl(getEnv().DATABASE_URL), { onnotice: () => undefined });
    try {
      const deleted = await runMaintenance(drizzle({ client, schema }));
      expect(deleted.links).toBe(2);
    } finally {
      await client.end();
    }
  });
});
