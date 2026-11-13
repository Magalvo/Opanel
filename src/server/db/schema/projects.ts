import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { accounts } from "./accounts";

// A project and its board (canonical doc 0003, WT-03 decisions 2 to 4 and 7). Projects are
// never deleted, only archived. `next_task_number` gives task keys from WI-030 on.
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull().unique(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    nextTaskNumber: integer("next_task_number").notNull().default(1),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("projects_key_format", sql`${table.key} ~ '^[A-Z][A-Z0-9]{1,9}$'`),
    check("projects_version_positive", sql`${table.version} >= 1`),
  ],
);
