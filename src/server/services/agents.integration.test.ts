import { describe, expect, it } from "vitest";

import { createTestAccount, createTestAgent } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";
import { projects } from "@/server/db/schema";

import { loadAgentActor } from "./agents";

async function project(key: string): Promise<string> {
  const [row] = await getDb().insert(projects).values({ key, name: key }).returning();
  if (!row) throw new Error("no project");
  return row.id;
}

describe("loadAgentActor (WS-071)", () => {
  it("reads an agent's role, scopes and listed projects", async () => {
    const [first, second] = [await project("ONE"), await project("TWO")];
    const agent = await createTestAgent({
      role: "worker_agent",
      scopes: ["tasks:read", "tasks:write"],
      projectIds: [first, second],
    });

    const loaded = await loadAgentActor(getDb(), agent.id);

    expect(loaded?.disabledAt).toBeNull();
    expect(loaded?.actor.kind).toBe("agent");
    expect(loaded?.actor.accountId).toBe(agent.id);
    expect(loaded?.actor.role).toBe("worker_agent");
    expect(loaded?.actor.permissions).toEqual(new Set(["tasks:read", "tasks:write"]));
    expect(loaded?.actor.projectIds).toEqual(new Set([first, second]));
  });

  it("keeps a restriction to no project apart from all projects", async () => {
    const none = await createTestAgent({ name: "None", projectIds: [] });
    const all = await createTestAgent({ name: "All", projectIds: null });

    expect((await loadAgentActor(getDb(), none.id))?.actor.projectIds).toEqual(new Set());
    expect((await loadAgentActor(getDb(), all.id))?.actor.projectIds).toBeNull();
  });

  it("gives an agent with no scope no permission, and reports it disabled", async () => {
    const agent = await createTestAgent({ scopes: [], disabled: true });

    const loaded = await loadAgentActor(getDb(), agent.id);

    expect(loaded?.actor.permissions.size).toBe(0);
    expect(loaded?.disabledAt).toBeInstanceOf(Date);
  });

  it("returns null for a human and for an unknown id", async () => {
    const human = await createTestAccount();

    expect(await loadAgentActor(getDb(), human.id)).toBeNull();
    expect(await loadAgentActor(getDb(), crypto.randomUUID())).toBeNull();
  });
});
