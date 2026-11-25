import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectEvent } from "@/lib/schemas/events";
import { type Actor, humanActor } from "@/server/auth/actor";
import type { EventHub, EventSubscriber } from "@/server/services/event-hub";

import { openEventStream } from "./event-stream";

// The heartbeat's limits (WS-124): a fake hub, a fake credential check and fake timers, so
// no test waits on the clock or the database.

const HEARTBEAT_MS = 25_000;
const QUEUE_BYTES = 64 * 1024;
const PROJECT_ID = randomUUID();

const request = new Request("http://localhost/api/v1/projects/ONE/events");
const cleanups: (() => Promise<void>)[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
});

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  vi.useRealTimers();
});

function fakeHub(): { hub: EventHub; emit(count: number): void } {
  const subscribers = new Set<EventSubscriber>();
  return {
    hub: {
      subscribe(_projectId, subscriber) {
        subscribers.add(subscriber);
        return Promise.resolve(() => subscribers.delete(subscriber));
      },
    },
    emit(count) {
      for (let version = 1; version <= count; version++) {
        const event: ProjectEvent = {
          type: "task.updated",
          entity: "task",
          projectId: PROJECT_ID,
          entityId: randomUUID(),
          version,
          actorAccountId: randomUUID(),
        };
        for (const subscriber of [...subscribers]) subscriber.event(event);
      }
    },
  };
}

function reading(account: string): () => Promise<{ actor: Actor }> {
  const actor = humanActor({ accountId: account, role: "member" });
  return () => Promise.resolve({ actor });
}

/** A check that settles only when the test says so, one per call. */
function heldChecks(account: string) {
  const actor = humanActor({ accountId: account, role: "member" });
  const pending: { resolve: (value: { actor: Actor }) => void; reject: (e: Error) => void }[] = [];
  const authenticate = vi.fn(
    () =>
      new Promise<{ actor: Actor }>((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  );
  return {
    authenticate,
    resolveNext: () => pending.shift()?.resolve({ actor }),
    rejectNext: (error: Error) => pending.shift()?.reject(error),
  };
}

async function open(
  options: Partial<Parameters<typeof openEventStream>[0]> & { account: string },
): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const response = await openEventStream({
    request,
    projectId: PROJECT_ID,
    hub: fakeHub().hub,
    ...options,
  });
  if (!response.body) throw new Error("The response has no body.");
  const reader = response.body.getReader();
  cleanups.push(() => reader.cancel().catch(() => undefined));
  return reader;
}

/** Reads what is left until the stream ends; the bytes it had queued. */
async function drain(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<number> {
  let bytes = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) return bytes;
    bytes += chunk.value.byteLength;
  }
}

/** True when the account has no free place under a cap of one. */
async function placeHeld(account: string): Promise<boolean> {
  try {
    await open({ account, maxStreamsPerAccount: 1, authenticate: reading(account) });
    return false;
  } catch {
    return true;
  }
}

const text = new TextDecoder();

describe("openEventStream's queue limit (WS-124)", () => {
  it("closes a quiet stream nobody reads once heartbeats would pass 64 KiB, and frees its place", async () => {
    const account = randomUUID();
    const reader = await open({ account, authenticate: reading(account) });

    // 13 bytes a heartbeat: just over 5 000 of them fill 64 KiB.
    await vi.advanceTimersByTimeAsync(5_100 * HEARTBEAT_MS);

    expect(await placeHeld(account)).toBe(false);
    expect(await drain(reader)).toBeLessThanOrEqual(QUEUE_BYTES);
  });

  it("never queues an event past 64 KiB for a reader that has fallen behind", async () => {
    const account = randomUUID();
    const { hub, emit } = fakeHub();
    const reader = await open({ account, hub, authenticate: reading(account) });

    emit(1_000);

    expect(await placeHeld(account)).toBe(false);
    expect(await drain(reader)).toBeLessThanOrEqual(QUEUE_BYTES);
  });

  it("keeps a stream that is read open past 64 KiB of events and heartbeats", async () => {
    const account = randomUUID();
    const { hub, emit } = fakeHub();
    const reader = await open({ account, hub, authenticate: reading(account) });
    let bytes = 0;
    let ended = false;
    void (async () => {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
      }
      ended = true;
    })();

    for (let batch = 0; batch < 20; batch++) {
      emit(50);
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    }

    expect(bytes).toBeGreaterThan(QUEUE_BYTES);
    expect(ended).toBe(false);
  });
});

describe("openEventStream's heartbeat check (WS-124)", () => {
  it("keeps at most one check in flight, and starts the next one interval after it ends", async () => {
    const account = randomUUID();
    const checks = heldChecks(account);
    const reader = await open({ account, authenticate: checks.authenticate });
    await reader.read(); // retry and ": connected"

    await vi.advanceTimersByTimeAsync(5 * HEARTBEAT_MS);
    expect(checks.authenticate).toHaveBeenCalledTimes(1);

    checks.resolveNext();
    expect(text.decode((await reader.read()).value)).toBe(": heartbeat\n\n");
    expect(checks.authenticate).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(checks.authenticate).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["resolves", (checks: ReturnType<typeof heldChecks>) => checks.resolveNext()],
    [
      "fails",
      (checks: ReturnType<typeof heldChecks>) => checks.rejectNext(new Error("database down")),
    ],
  ])(
    "does nothing more when a check %s after the stream ended, and frees its place once",
    async (_, settle) => {
      const account = randomUUID();
      const checks = heldChecks(account);
      const logError = vi.fn();
      const reader = await open({ account, authenticate: checks.authenticate, logError });
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
      expect(checks.authenticate).toHaveBeenCalledTimes(1);

      await reader.cancel();
      settle(checks);
      await vi.advanceTimersByTimeAsync(5 * HEARTBEAT_MS);

      expect(checks.authenticate).toHaveBeenCalledTimes(1);
      expect(logError).not.toHaveBeenCalled();
      // The place came back, once: one stream fits under a cap of one, a second does not.
      expect(await placeHeld(account)).toBe(false);
      expect(await placeHeld(account)).toBe(true);
    },
  );
});
