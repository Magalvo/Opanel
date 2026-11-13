import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createTestAccount, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { createProject } from "@/server/services/projects";
import { createTask } from "@/server/services/tasks";

import { taskEvents } from ".";

// Doc 0003 section 9: history is append-only.
describe("task_events", () => {
  it("refuses updates and deletes", async () => {
    const actor = testActor(await createTestAccount({ email: "m@example.com", role: "manager" }));
    await createProject(actor, { key: "OPA", name: "Opanel" });
    await createTask(actor, "OPA", { title: "First" });
    const [event] = await getDb().select().from(taskEvents);

    await expect(
      getDb()
        .update(taskEvents)
        .set({ field: "x" })
        .where(eq(taskEvents.id, event?.id ?? 0)),
    ).rejects.toThrow();
    await expect(getDb().execute(sql`delete from task_events`)).rejects.toThrow();
    expect(await getDb().select().from(taskEvents)).toHaveLength(1);
  });
});
