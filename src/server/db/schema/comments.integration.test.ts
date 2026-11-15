import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createTestAccount, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { createProject } from "@/server/services/projects";
import { createTask } from "@/server/services/tasks";

import { comments } from ".";

async function aTask() {
  const account = await createTestAccount({ email: "m@example.com", role: "manager" });
  const actor = testActor(account);
  await createProject(actor, { key: "OPA", name: "Opanel" });
  const task = await createTask(actor, "OPA", { title: "First" });
  return { account, task };
}

describe("comments table", () => {
  it("refuses a user comment without an author, and allows a system comment without one", async () => {
    const { task } = await aTask();

    await expect(
      getDb().execute(sql`
        insert into comments (task_id, kind, body) values (${task.id}, 'user', 'Hi')`),
    ).rejects.toThrow();
    await getDb().execute(sql`
      insert into comments (task_id, kind, body) values (${task.id}, 'system', 'Seen again')`);
    await expect(
      getDb().execute(sql`
        insert into comments (task_id, kind, body) values (${task.id}, 'other', 'Hi')`),
    ).rejects.toThrow();
    expect(await getDb().select().from(comments)).toHaveLength(1);
  });

  // WT-03 question 2: comments are never edited or deleted.
  it("refuses updates and deletes", async () => {
    const { account, task } = await aTask();
    const [comment] = await getDb()
      .insert(comments)
      .values({ taskId: task.id, authorAccountId: account.id, body: "Hi" })
      .returning();

    await expect(
      getDb()
        .update(comments)
        .set({ body: "Edited" })
        .where(eq(comments.id, comment?.id ?? "")),
    ).rejects.toThrow();
    await expect(getDb().execute(sql`delete from comments`)).rejects.toThrow();
    expect((await getDb().select().from(comments))[0]?.body).toBe("Hi");
  });
});
