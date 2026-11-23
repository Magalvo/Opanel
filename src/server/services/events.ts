import { sql } from "drizzle-orm";

import { EVENTS_CHANNEL, type ProjectEvent, projectEventSchema } from "@/lib/schemas/events";
import type { Database } from "@/server/db/client";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** What a service gives: the event without its `id` and `at`, which are added here. */
export type ProjectEventInput = DistributiveOmit<ProjectEvent, "id" | "at">;

/**
 * Announces a write (WS-045): sends the event on {@link EVENTS_CHANNEL} with `pg_notify`,
 * inside the caller's transaction. PostgreSQL delivers it when that transaction commits,
 * and never if it rolls back. Takes the transaction the write runs in, never the pool, so
 * an event cannot be sent apart from its write. A malformed event throws, failing the write.
 */
export async function publishEvent(
  tx: Pick<Database, "execute">,
  input: ProjectEventInput,
): Promise<void> {
  const event = projectEventSchema.parse({
    ...input,
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
  });
  await tx.execute(sql`select pg_notify(${EVENTS_CHANNEL}, ${JSON.stringify(event)})`);
}

/**
 * Publishes many events in one statement, in order (WS-107: deleting a label used by a
 * thousand tasks sends a `task.updated` for each).
 */
export async function publishEvents(
  tx: Pick<Database, "execute">,
  inputs: readonly ProjectEventInput[],
): Promise<void> {
  if (inputs.length === 0) return;
  const at = new Date().toISOString();
  const payloads = inputs.map((input) =>
    JSON.stringify(projectEventSchema.parse({ ...input, id: crypto.randomUUID(), at })),
  );
  await tx.execute(sql`
    select pg_notify(${EVENTS_CHANNEL}, payload)
    from unnest(array[${sql.join(
      payloads.map((payload) => sql`${payload}`),
      sql`, `,
    )}]::text[]) with ordinality as p(payload, n)
    order by n`);
}
