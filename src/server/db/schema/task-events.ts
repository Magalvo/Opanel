import { sql } from "drizzle-orm";
import { bigint, check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { accounts } from "./accounts";
import { tasks } from "./tasks";

// A task's history (canonical doc 0003 section 9, WT-03 decision 13). Append-only: a
// trigger refuses updates and deletes (migration 0009).
export const taskEvents = pgTable(
  "task_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "restrict" }),
    // Null means "no authenticated actor"; never a default.
    actorAccountId: uuid("actor_account_id").references(() => accounts.id, {
      onDelete: "restrict",
    }),
    type: text("type").notNull(),
    field: text("field"),
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "task_events_type_check",
      sql`${table.type} in ('created', 'field_changed', 'moved', 'deleted', 'restored', 'commented')`,
    ),
    index("task_events_task_idx").on(table.taskId, table.createdAt, table.id),
  ],
);
