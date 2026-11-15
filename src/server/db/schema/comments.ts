import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { accounts } from "./accounts";
import { tasks } from "./tasks";

// Comments on tasks (WS-034). `kind` and a nullable author come from WT-03 decision 19: a
// `user` comment always has an author; a `system` comment (WT-06) may have none. Append-only:
// a trigger refuses updates and deletes (migration 0012), as for `task_events`.
export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "restrict" }),
    kind: text("kind").notNull().default("user"),
    authorAccountId: uuid("author_account_id").references(() => accounts.id, {
      onDelete: "restrict",
    }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("comments_kind_check", sql`${table.kind} in ('user', 'system')`),
    check(
      "comments_author_kind",
      sql`${table.kind} <> 'user' or ${table.authorAccountId} is not null`,
    ),
    index("comments_task_idx").on(table.taskId, table.createdAt, table.id),
  ],
);
