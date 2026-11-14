import { sql } from "drizzle-orm";
import { check, date, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { accounts } from "./accounts";
import { projects } from "./projects";

// Epics group a project's tasks (canonical doc 0003 section 4, WT-03 decision 18). They are
// closed, never deleted, so a closed epic keeps its tasks.
export const epics = pgTable(
  "epics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").notNull().default("open"),
    startDate: date("start_date", { mode: "string" }),
    targetDate: date("target_date", { mode: "string" }),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("epics_status_check", sql`${table.status} in ('open', 'closed')`),
    check(
      "epics_dates_ordered",
      sql`${table.startDate} is null or ${table.targetDate} is null or ${table.targetDate} >= ${table.startDate}`,
    ),
    check("epics_version_positive", sql`${table.version} >= 1`),
    index("epics_project_idx").on(table.projectId),
  ],
);
