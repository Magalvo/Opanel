import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { accounts } from "./accounts";
import { projects } from "./projects";

// Sprints of a project (canonical doc 0003 section 6, WT-10 decision 3, WS-140). One active
// sprint per project at most, enforced by the partial unique index so it holds under
// concurrency. The start, completion and frozen-point columns are written by item D only.
export const sprints = pgTable(
  "sprints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    goal: text("goal").notNull().default(""),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    state: text("state").notNull().default("planned"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    totalPoints: numeric("total_points", { precision: 7, scale: 1 }),
    completedPoints: numeric("completed_points", { precision: 7, scale: 1 }),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("sprints_state_check", sql`${table.state} in ('planned', 'active', 'completed')`),
    check("sprints_dates_ordered", sql`${table.endDate} >= ${table.startDate}`),
    check("sprints_version_positive", sql`${table.version} >= 1`),
    // The record of a completed sprint, and only of one (WT-10 decision 7).
    check(
      "sprints_completed_check",
      sql`case when ${table.state} = 'completed'
        then ${table.completedAt} is not null and ${table.totalPoints} is not null and ${table.completedPoints} is not null
        else ${table.completedAt} is null and ${table.totalPoints} is null and ${table.completedPoints} is null end`,
    ),
    check(
      "sprints_started_check",
      sql`(${table.startedAt} is null) = (${table.state} = 'planned')`,
    ),
    uniqueIndex("sprints_one_active_idx")
      .on(table.projectId)
      .where(sql`${table.state} = 'active'`),
    index("sprints_project_order_idx").on(
      table.projectId,
      table.startDate,
      table.createdAt,
      table.id,
    ),
  ],
);
