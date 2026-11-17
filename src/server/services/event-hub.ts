import postgres from "postgres";

import { EVENTS_CHANNEL, type ProjectEvent, projectEventSchema } from "@/lib/schemas/events";
import { getEnv } from "@/server/env";
import { describeError } from "@/server/http/safe-error";

/** Someone who wants the events of one project: in WI-047, an open stream. */
export interface EventSubscriber {
  /** An event of the subscribed project, in commit order. */
  event(event: ProjectEvent): void;
  /** Events may have been missed: start over (WT-04 decision 5). Called at most once. */
  reset(): void;
}

/** The part of postgres.js the hub uses (`sql.listen`), so unit tests can give a fake. */
export type Listen = (
  channel: string,
  onPayload: (payload: string) => void,
  onListen: () => void,
) => Promise<unknown>;

export interface EventHub {
  /** Resolves once LISTEN is active; returns the unsubscribe function. */
  subscribe(projectId: string, subscriber: EventSubscriber): Promise<() => void>;
}

/**
 * The event hub (WS-046): one LISTEN on {@link EVENTS_CHANNEL}, fanned out to the
 * subscribers of each project.
 *
 * postgres.js calls `onListen` once LISTEN is active, and again each time it has listened
 * anew after losing its connection. That second call is the only sign of a lost connection,
 * during which events may have been missed: every subscriber present is then reset and
 * removed, so none goes on as if nothing had happened.
 */
export function createEventHub({
  listen,
  logError = console.error,
}: {
  listen: Listen;
  logError?: (message: string) => void;
}): EventHub {
  const subscribers = new Map<string, Set<EventSubscriber>>();
  let started: Promise<unknown> | undefined;
  let listening = false;

  function safely(call: () => void): void {
    try {
      call();
    } catch (error) {
      logError(`An event subscriber failed: ${describeError(error)}`);
    }
  }

  function onPayload(payload: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      parsed = undefined;
    }
    const result = projectEventSchema.safeParse(parsed);
    if (!result.success) {
      // Never the payload itself: anyone with database access can send one.
      logError(`Dropped a notification on ${EVENTS_CHANNEL} that is not a valid event.`);
      return;
    }
    const event = result.data;
    for (const subscriber of [...(subscribers.get(event.projectId) ?? [])]) {
      safely(() => {
        subscriber.event(event);
      });
    }
  }

  function onListen(): void {
    if (!listening) {
      listening = true;
      return;
    }
    const everyone = [...subscribers.values()].flatMap((set) => [...set]);
    subscribers.clear();
    for (const subscriber of everyone) {
      safely(() => {
        subscriber.reset();
      });
    }
  }

  function start(): Promise<unknown> {
    // postgres.js does not retry a first LISTEN that failed, so the next subscription will.
    started ??= listen(EVENTS_CHANNEL, onPayload, onListen).catch((error: unknown) => {
      started = undefined;
      throw error;
    });
    return started;
  }

  return {
    async subscribe(projectId, subscriber) {
      await start();
      const set = subscribers.get(projectId) ?? new Set<EventSubscriber>();
      set.add(subscriber);
      subscribers.set(projectId, set);
      return () => {
        const current = subscribers.get(projectId);
        if (!current?.delete(subscriber)) return;
        if (current.size === 0) subscribers.delete(projectId);
      };
    },
  };
}

interface ProcessHub {
  hub: EventHub;
  client: postgres.Sql;
}

// Kept on globalThis so that hot reload in development reuses the hub and its connection.
const store = globalThis as typeof globalThis & { __opanelEventHub?: ProcessHub };

/**
 * The hub of this process. Its own client is used only for LISTEN, so it holds exactly one
 * connection, named `opanel-events` for operators and tests. Creating it opens nothing: the
 * first subscription does, so `next build` needs no database.
 */
export function getEventHub(): EventHub {
  if (!store.__opanelEventHub) {
    const client = postgres(getEnv().DATABASE_URL, {
      max: 1,
      onnotice: () => undefined,
      connection: { application_name: "opanel-events" },
    });
    const hub = createEventHub({
      listen: (channel, onPayload, onListen) => client.listen(channel, onPayload, onListen),
    });
    store.__opanelEventHub = { hub, client };
  }
  return store.__opanelEventHub.hub;
}

/** Ends the LISTEN connection and forgets the hub. For tests and shutdown. */
export async function closeEventHub(): Promise<void> {
  const current = store.__opanelEventHub;
  delete store.__opanelEventHub;
  await current?.client.end();
}
