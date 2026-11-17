import { describe, expect, it, vi } from "vitest";

import { EVENTS_CHANNEL, type ProjectEvent } from "@/lib/schemas/events";

import { createEventHub, type EventSubscriber, type Listen } from "./event-hub";

const PROJECT_A = "0193a1b7-0000-4000-8000-00000000000a";
const PROJECT_B = "0193a1b7-0000-4000-8000-00000000000b";
const ACTOR = "0193a1b7-0000-4000-8000-0000000000ac";

function event(projectId: string, n: number): ProjectEvent {
  return {
    id: `0193a1c2-0000-4000-8000-${String(n).padStart(12, "0")}`,
    type: "task.updated",
    entity: "task",
    projectId,
    entityId: "0193a1b7-0000-4000-8000-0000000000e1",
    version: n,
    actorAccountId: ACTOR,
    at: "2026-11-17T10:00:00.000Z",
  };
}

/** A `listen` that records its callbacks; it resolves unless told to fail. */
function fakeListen() {
  let onPayload: ((payload: string) => void) | undefined;
  let onListen: (() => void) | undefined;
  let failures = 0;
  const listen = vi.fn<Listen>((channel, payloadCallback, listenCallback) => {
    expect(channel).toBe(EVENTS_CHANNEL);
    if (failures > 0) {
      failures--;
      return Promise.reject(new Error("connection refused"));
    }
    onPayload = payloadCallback;
    onListen = listenCallback;
    return Promise.resolve().then(() => {
      listenCallback();
    });
  });
  return {
    listen,
    failNext(times = 1) {
      failures = times;
    },
    deliver(payload: unknown) {
      onPayload?.(typeof payload === "string" ? payload : JSON.stringify(payload));
    },
    /** What the library does once LISTEN is back after a lost connection. */
    reconnect() {
      onListen?.();
    },
  };
}

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

describe("createEventHub (WS-046)", () => {
  it("gives each event to every subscriber of its project, in order, and to no other", async () => {
    const fake = fakeListen();
    const hub = createEventHub({ listen: fake.listen });
    const first = recorder();
    const second = recorder();
    const other = recorder();
    await hub.subscribe(PROJECT_A, first);
    await hub.subscribe(PROJECT_A, second);
    await hub.subscribe(PROJECT_B, other);

    fake.deliver(event(PROJECT_A, 1));
    fake.deliver(event(PROJECT_A, 2));

    expect(first.events.map((e) => e.version)).toEqual([1, 2]);
    expect(second.events.map((e) => e.version)).toEqual([1, 2]);
    expect(other.events).toEqual([]);
  });

  it("resolves a subscription only once LISTEN is active, and listens once", async () => {
    const fake = fakeListen();
    let release: (() => void) | undefined;
    fake.listen.mockImplementationOnce((_channel, _payload, onListen) => {
      return new Promise<void>((resolve) => {
        release = () => {
          onListen();
          resolve();
        };
      });
    });
    const hub = createEventHub({ listen: fake.listen });

    let settled = 0;
    const pending = [1, 2, 3].map(() =>
      hub.subscribe(PROJECT_A, recorder()).then(() => {
        settled++;
      }),
    );
    await Promise.resolve();
    expect(settled).toBe(0);

    release?.();
    await Promise.all(pending);
    await hub.subscribe(PROJECT_B, recorder());

    expect(settled).toBe(3);
    expect(fake.listen).toHaveBeenCalledOnce();
  });

  it("fails the waiting subscriptions when LISTEN fails, and tries again on the next one", async () => {
    const fake = fakeListen();
    fake.failNext();
    const hub = createEventHub({ listen: fake.listen });

    await expect(hub.subscribe(PROJECT_A, recorder())).rejects.toThrow("connection refused");
    const later = recorder();
    await hub.subscribe(PROJECT_A, later);
    fake.deliver(event(PROJECT_A, 1));

    expect(fake.listen).toHaveBeenCalledTimes(2);
    expect(later.events).toHaveLength(1);
  });

  it("stops delivering after unsubscribe, which may be called twice or from inside event()", async () => {
    const fake = fakeListen();
    const hub = createEventHub({ listen: fake.listen });
    const gone = recorder();
    const unsubscribeGone = await hub.subscribe(PROJECT_A, gone);
    const once = recorder();
    const unsubscribeOnce: { current?: () => void } = {};
    unsubscribeOnce.current = await hub.subscribe(PROJECT_A, {
      ...once,
      event(received) {
        once.event(received);
        unsubscribeOnce.current?.();
      },
    });
    const stays = recorder();
    await hub.subscribe(PROJECT_A, stays);

    unsubscribeGone();
    unsubscribeGone();
    fake.deliver(event(PROJECT_A, 1));
    fake.deliver(event(PROJECT_A, 2));

    expect(gone.events).toEqual([]);
    expect(once.events.map((e) => e.version)).toEqual([1]);
    expect(stays.events.map((e) => e.version)).toEqual([1, 2]);
  });

  it.each([
    ["not JSON", "Secret-Marker-1 {"],
    ["not an event", { title: "Secret-Marker-1" }],
    ["a test sentinel", { sentinel: "Secret-Marker-1" }],
  ])("drops a payload that is %s and logs it without its content", async (_case, payload) => {
    const fake = fakeListen();
    const logError = vi.fn<(message: string) => void>();
    const hub = createEventHub({ listen: fake.listen, logError });
    const subscriber = recorder();
    await hub.subscribe(PROJECT_A, subscriber);

    fake.deliver(payload);
    fake.deliver(event(PROJECT_A, 1));

    expect(subscriber.events.map((e) => e.version)).toEqual([1]);
    expect(logError).toHaveBeenCalledOnce();
    expect(logError.mock.calls[0]?.[0]).toContain("opanel_events");
    expect(logError.mock.calls[0]?.[0]).not.toContain("Secret-Marker-1");
  });

  it("keeps delivering when a subscriber throws, and logs the error without its message", async () => {
    const fake = fakeListen();
    const logError = vi.fn<(message: string) => void>();
    const hub = createEventHub({ listen: fake.listen, logError });
    await hub.subscribe(PROJECT_A, {
      event() {
        throw new TypeError("Secret-Marker-2");
      },
      reset() {
        throw new TypeError("Secret-Marker-2");
      },
    });
    const healthy = recorder();
    await hub.subscribe(PROJECT_A, healthy);

    fake.deliver(event(PROJECT_A, 1));
    fake.reconnect();

    expect(healthy.events).toHaveLength(1);
    expect(healthy.resets).toBe(1);
    expect(logError).toHaveBeenCalledTimes(2);
    for (const [line] of logError.mock.calls) {
      expect(line).toContain("TypeError");
      expect(line).not.toContain("Secret-Marker-2");
    }
  });

  it("after a reconnection, resets and removes every subscriber; later ones get later events", async () => {
    const fake = fakeListen();
    const hub = createEventHub({ listen: fake.listen });
    const a = recorder();
    const b = recorder();
    await hub.subscribe(PROJECT_A, a);
    await hub.subscribe(PROJECT_B, b);
    expect(a.resets + b.resets).toBe(0);

    fake.reconnect();
    const fresh = recorder();
    await hub.subscribe(PROJECT_A, fresh);
    fake.deliver(event(PROJECT_A, 7));

    expect([a.resets, b.resets]).toEqual([1, 1]);
    expect(a.events).toEqual([]);
    expect(fresh.events.map((e) => e.version)).toEqual([7]);
    expect(fresh.resets).toBe(0);
    expect(fake.listen).toHaveBeenCalledOnce();
  });
});
