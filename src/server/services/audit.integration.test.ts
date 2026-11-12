import { eq, sql } from "drizzle-orm";
import { describe, expect, expectTypeOf, it } from "vitest";

import { humanActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { accounts, auditLog } from "@/server/db/schema";
import { resetDatabase } from "@/server/db/testing";

import { type AuditEvent, recordAudit } from "./audit";

async function createAdmin() {
  const [account] = await getDb()
    .insert(accounts)
    .values({ kind: "human", name: "Ada", email: "ada@example.com", role: "admin" })
    .returning();
  if (!account) throw new Error("no account");
  return { account, actor: humanActor({ accountId: account.id, role: "admin" }) };
}

describe("recordAudit", () => {
  it("stores actor, action, entity, entity id, data and a timestamp", async () => {
    const { account, actor } = await createAdmin();

    const id = await recordAudit(getDb(), {
      actor,
      action: "account.role_changed",
      entity: "account",
      entityId: account.id,
      data: { from: "member", to: "admin" },
    });

    const [row] = await getDb().select().from(auditLog).where(eq(auditLog.id, id));
    expect(row).toMatchObject({
      actorAccountId: account.id,
      action: "account.role_changed",
      entity: "account",
      entityId: account.id,
      data: { from: "member", to: "admin" },
    });
    expect(row?.createdAt).toBeInstanceOf(Date);
  });

  it("commits with the caller's transaction and rolls back with it", async () => {
    const { actor } = await createAdmin();
    const event = { actor, action: "auth.sign_in", entity: "account" } as const;

    await getDb().transaction(async (tx) => {
      await recordAudit(tx, event);
    });
    expect(await getDb().select().from(auditLog)).toHaveLength(1);

    await expect(
      getDb().transaction(async (tx) => {
        await recordAudit(tx, event);
        throw new Error("the change failed");
      }),
    ).rejects.toThrow("the change failed");
    expect(await getDb().select().from(auditLog)).toHaveLength(1);
  });

  it("writes nothing for an unknown action or unsafe data", async () => {
    const { actor } = await createAdmin();

    await expect(
      recordAudit(getDb(), { actor, action: "account.exploded" as never, entity: "account" }),
    ).rejects.toThrow();
    await expect(
      recordAudit(getDb(), {
        actor,
        action: "account.password_changed",
        entity: "account",
        data: { password: "hunter2-hunter2" },
      }),
    ).rejects.toThrow(/password/);

    expect(await getDb().select().from(auditLog)).toHaveLength(0);
  });

  it("records an event with no actor only when null is written out", async () => {
    await recordAudit(getDb(), { actor: null, action: "auth.sign_in_failed", entity: "account" });

    const [row] = await getDb().select().from(auditLog);
    expect(row?.actorAccountId).toBeNull();
    expectTypeOf<AuditEvent["actor"]>().not.toBeUndefined();
    expectTypeOf<AuditEvent>().toHaveProperty("actor");
    expectTypeOf<Pick<AuditEvent, "actor">>().not.toEqualTypeOf<Partial<Pick<AuditEvent, "actor">>>();
  });
});

describe("audit_log table", () => {
  it("is append-only: update and delete fail, insert works, the test harness can still empty it", async () => {
    const { actor } = await createAdmin();
    const id = await recordAudit(getDb(), { actor, action: "auth.sign_out", entity: "account" });

    await expect(
      getDb().update(auditLog).set({ entity: "other" }).where(eq(auditLog.id, id)),
    ).rejects.toThrow();
    await expect(getDb().delete(auditLog).where(eq(auditLog.id, id))).rejects.toThrow();
    expect(await getDb().select().from(auditLog)).toHaveLength(1);

    await resetDatabase();
    expect(await getDb().select().from(auditLog)).toHaveLength(0);
  });

  it("only accepts a real account as actor, and an account with history cannot be deleted", async () => {
    await expect(
      getDb().insert(auditLog).values({
        actorAccountId: crypto.randomUUID(),
        action: "auth.sign_in",
        entity: "account",
      }),
    ).rejects.toThrow();

    const { account, actor } = await createAdmin();
    await recordAudit(getDb(), { actor, action: "auth.sign_in", entity: "account" });

    await expect(getDb().delete(accounts).where(eq(accounts.id, account.id))).rejects.toThrow();
  });

  it("is indexed by entity and by actor", async () => {
    const { account, actor } = await createAdmin();
    for (let i = 0; i < 300; i++) {
      await recordAudit(getDb(), {
        actor: i % 2 ? actor : null,
        action: "auth.sign_in",
        entity: "account",
        entityId: String(i),
      });
    }
    await getDb().execute(sql`analyze audit_log`);

    const plans = await getDb().transaction(async (tx) => {
      await tx.execute(sql`set local enable_seqscan = off`);
      const byEntity = await tx.execute<Record<string, string>>(
        sql`explain select * from audit_log where entity = 'account' and entity_id = '7'`,
      );
      const byActor = await tx.execute<Record<string, string>>(
        sql`explain select * from audit_log where actor_account_id = ${account.id}`,
      );
      return [byEntity, byActor].map((rows) => rows.map((row) => Object.values(row)[0]).join("\n"));
    });

    for (const plan of plans) expect(plan).toMatch(/Index|Bitmap/);
    expect(plans[0]).not.toMatch(/Seq Scan/);
  });
});
