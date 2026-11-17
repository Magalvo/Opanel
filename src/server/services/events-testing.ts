// Integration-test helper (WS-045 section 6): listens on the events channel the way the hub
// of WI-046 will, and waits for delivery without timers.
import { sql } from "drizzle-orm";
import postgres from "postgres";

import { EVENTS_CHANNEL, type ProjectEvent, projectEventSchema } from "@/lib/schemas/events";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";

export interface EventListener {
  /** Every event received so far, each parsed with the schema (a malformed one throws). */
  events(): ProjectEvent[];
  /**
   * Waits until every event committed before this call has arrived: sends a sentinel
   * notification and waits for it. PostgreSQL delivers the notifications of different
   * transactions in commit order, so nothing committed earlier can still be on its way.
   */
  settle(): Promise<void>;
  close(): Promise<void>;
}

const SETTLE_TIMEOUT_MS = 5_000;

export async function listenForEvents(): Promise<EventListener> {
  const client = postgres(getEnv().DATABASE_URL, { max: 1, onnotice: () => undefined });
  const received: unknown[] = [];
  const sentinels = new Map<string, () => void>();

  await client.listen(EVENTS_CHANNEL, (payload) => {
    const parsed: unknown = JSON.parse(payload);
    if (typeof parsed === "object" && parsed !== null && "sentinel" in parsed) {
      sentinels.get(String(parsed.sentinel))?.();
      return;
    }
    received.push(parsed);
  });

  return {
    events: () => received.map((event) => projectEventSchema.parse(event)),
    async settle() {
      const sentinel = crypto.randomUUID();
      const arrived = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error("The sentinel notification did not arrive."));
        }, SETTLE_TIMEOUT_MS);
        sentinels.set(sentinel, () => {
          clearTimeout(timer);
          resolve();
        });
      });
      await getDb().execute(
        sql`select pg_notify(${EVENTS_CHANNEL}, ${JSON.stringify({ sentinel })})`,
      );
      await arrived;
      sentinels.delete(sentinel);
    },
    async close() {
      await client.end();
    },
  };
}
