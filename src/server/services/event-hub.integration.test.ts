import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProjectEvent } from "@/lib/schemas/events";
import { createTestAccount, testActor } from "@/server/auth/testing";
import { getDb } from "@/server/db/client";

import { closeEventHub, type EventSubscriber, getEventHub } from "./event-hub";
import { createProject } from "./projects";
import { createTask } from "./tasks";

afterEach(async () => {
  await closeEventHub();
});

function recorder(): EventSubscriber & { events: ProjectEvent[]; resets: number } {
  const subscriber = {
    events: [] as ProjectEvent[],
    resets: 0,
    event(received: ProjectEvent) {
      subscriber.events.push(received);
    },
    reset() {
      subscriber.resets++;
    },
  };
  return subscriber;
}

async function setup() {
  const manager = await createTestAccount({ email: "manager@example.com", role: "manager" });
  const actor = testActor(manager);
  const one = await createProject(actor, { key: "ONE", name: "One" });
  const two = await createProject(actor, { key: "TWO", name: "Two" });
  return { actor, one, two };
}

async function hubConnections(): Promise<number> {
  const rows = await getDb().execute<{ count: number }>(
    sql`select count(*)::int as count from pg_stat_activity
        where application_name = 'opanel-events' and datname = current_database()`,
  );
  return rows[0]?.count ?? 0;
}

describe("the process's event hub (WS-046)", () => {
  it("delivers a committed service event to the subscribers of its project only", async () => {
    const { actor, one, two } = await setup();
    const ofOne = recorder();
    const ofTwo = recorder();
    await getEventHub().subscribe(one.id, ofOne);
    await getEventHub().subscribe(two.id, ofTwo);

    const task = await createTask(actor, "ONE", { title: "Heard" });

    await vi.waitFor(() => {
      expect(ofOne.events).toEqual([
        expect.objectContaining({ type: "task.created", entityId: task.id }),
      ]);
    });
    expect(ofTwo.events).toEqual([]);
  });

  it("resets its subscribers once LISTEN is back after the connection was killed", async () => {
    const { actor, one } = await setup();
    const before = recorder();
    await getEventHub().subscribe(one.id, before);

    await getDb().execute(
      sql`select pg_terminate_backend(pid) from pg_stat_activity
          where application_name = 'opanel-events' and datname = current_database()`,
    );

    await vi.waitFor(
      () => {
        expect(before.resets).toBe(1);
      },
      { timeout: 10_000, interval: 50 },
    );
    const after = recorder();
    await getEventHub().subscribe(one.id, after);
    await createTask(actor, "ONE", { title: "After" });

    await vi.waitFor(() => {
      expect(after.events).toHaveLength(1);
    });
    expect(before.events).toEqual([]);
  });

  it("is one hub with one connection, however many subscriptions", async () => {
    const { one, two } = await setup();
    const hub = getEventHub();

    await Promise.all(
      Array.from({ length: 5 }, (_, i) => hub.subscribe(i % 2 ? one.id : two.id, recorder())),
    );

    expect(getEventHub()).toBe(hub);
    expect(await hubConnections()).toBe(1);
  });
});
