import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { accounts } from "./accounts";
import { tasks } from "./tasks";

// Comments on tasks (WT-03 decisions 13, 14, 19, WS-034). `kind` and a nullable author exist
// from the start so that WT-06 can add system comments by changing the `kind` check. A
// trigger refuses updates and deletes (migration 0011): comments are never edited.
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
    check("comments_kind_check", sql`${table.kind} in ('user')`),
    check("comments_body_length", sql`char_length(${table.body}) between 1 and 10000`),
    check(
      "comments_user_has_author",
      sql`${table.kind} <> 'user' or ${table.authorAccountId} is not null`,
    ),
    index("comments_task_idx").on(table.taskId, table.createdAt, table.id),
  ],
);
