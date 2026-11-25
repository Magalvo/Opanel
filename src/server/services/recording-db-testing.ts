// Integration-test helper (WS-122 section 3): the real database, keeping the rows each
// `execute` returned, so a test can see what a service read and not only what it answered.
import { type Database, getDb } from "@/server/db/client";

export interface RecordingDb {
  /** Pass it as a service's `db` argument. */
  db: Database;
  /** Every task row read so far: rows that carry a `project_key`, as the task selects do. */
  taskRows(): Record<string, unknown>[];
}

export function recordingDb(): RecordingDb {
  const rows: Record<string, unknown>[] = [];
  const real = getDb();
  const db = new Proxy(real, {
    get(target, property, receiver) {
      if (property !== "execute") return Reflect.get(target, property, receiver) as unknown;
      return async (...args: Parameters<Database["execute"]>) => {
        const result = await target.execute(...args);
        for (const row of result) rows.push(row);
        return result;
      };
    },
  });
  return {
    db,
    taskRows: () => rows.filter((row) => "project_key" in row),
  };
}
