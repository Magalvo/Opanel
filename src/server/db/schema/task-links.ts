import { sql } from "drizzle-orm";
import { check, index, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { accounts } from "./accounts";
import { tasks } from "./tasks";

// Links between tasks (canonical doc 0003 section 7). WT-06 creates the table with the one
// type the triage pipeline writes, `regression_of` (decision 9); WT-09 adds the others.
export const taskLinks = pgTable(
  "task_links",
  {
    fromTaskId: uuid("from_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "restrict" }),
    toTaskId: uuid("to_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "restrict" }),
    type: text("type").notNull(),
    createdBy: uuid("created_by").references(() => accounts.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.fromTaskId, table.toTaskId, table.type] }),
    check("task_links_type_check", sql`${table.type} in ('regression_of')`),
    check("task_links_not_self_check", sql`${table.fromTaskId} <> ${table.toTaskId}`),
    index("task_links_to_task_idx").on(table.toTaskId),
  ],
);
