import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createTestAccount, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { createProject } from "@/server/services/projects";
import { createTask } from "@/server/services/tasks";

import { comments } from ".";

async function setup() {
  const account = await createTestAccount({ email: "m@example.com", role: "manager" });
  const actor = testActor(account);
  await createProject(actor, { key: "OPA", name: "Opanel" });
  const task = await createTask(actor, "OPA", { title: "First" });
  return { account, task };
}

// WS-034 section 1: comments are append-only, a user comment has an author, a body has a size.
describe("comments table", () => {
  it("refuses a user comment with no author", async () => {
    const { task } = await setup();

    await expect(
      getDb().insert(comments).values({ taskId: task.id, kind: "user", body: "Hello" }),
    ).rejects.toThrow();
    expect(await getDb().select().from(comments)).toHaveLength(0);
  });

  it("refuses a body of 0 or 10 001 characters and a kind other than user", async () => {
    const { account, task } = await setup();

    for (const values of [
      { body: "" },
      { body: "x".repeat(10_001) },
      { body: "ok", kind: "system" },
    ]) {
      await expect(
        getDb()
          .insert(comments)
          .values({ taskId: task.id, authorAccountId: account.id, ...values }),
      ).rejects.toThrow();
    }
    await expect(
      getDb()
        .insert(comments)
        .values({ taskId: task.id, authorAccountId: account.id, body: "x".repeat(10_000) }),
    ).resolves.toBeDefined();
  });

  it("refuses updates and deletes", async () => {
    const { account, task } = await setup();
    const [comment] = await getDb()
      .insert(comments)
      .values({ taskId: task.id, authorAccountId: account.id, body: "Hello" })
      .returning();

    await expect(
      getDb()
        .update(comments)
        .set({ body: "Changed" })
        .where(eq(comments.id, comment?.id ?? "")),
    ).rejects.toThrow();
    await expect(getDb().execute(sql`delete from comments`)).rejects.toThrow();
    expect(await getDb().select().from(comments)).toHaveLength(1);
  });
});
