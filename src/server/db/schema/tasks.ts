import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { accounts } from "./accounts";
import { byteOrderedText } from "./collated-text";
import { columns } from "./columns";
import { epics } from "./epics";
import { projects } from "./projects";
import { teams } from "./teams";

// Tasks (canonical doc 0003 section 4, WS-030). The key is not stored: it is the project's
// key and `number`, neither of which ever changes. The `restrict` references keep a team or
// a column that a task uses from being deleted (`team_in_use`, `column_not_empty`).
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    number: integer("number").notNull(),
    type: text("type").notNull().default("task"),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    columnId: uuid("column_id")
      .notNull()
      .references(() => columns.id, { onDelete: "restrict" }),
    position: byteOrderedText("position").notNull(),
    assigneeTeamId: uuid("assignee_team_id").references(() => teams.id, { onDelete: "restrict" }),
    assigneeAccountId: uuid("assignee_account_id").references(() => accounts.id, {
      onDelete: "restrict",
    }),
    epicId: uuid("epic_id").references(() => epics.id, { onDelete: "restrict" }),
    reporterAccountId: uuid("reporter_account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    version: integer("version").notNull().default(1),
    // Soft delete (WT-03 decision 12), used from WI-032.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => accounts.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("tasks_type_check", sql`${table.type} in ('task', 'bug', 'story')`),
    check("tasks_version_positive", sql`${table.version} >= 1`),
    uniqueIndex("tasks_project_number_idx").on(table.projectId, table.number),
    uniqueIndex("tasks_column_position_idx").on(table.columnId, table.position),
    index("tasks_assignee_team_idx").on(table.assigneeTeamId),
    index("tasks_assignee_account_idx").on(table.assigneeAccountId),
    index("tasks_epic_idx").on(table.epicId),
  ],
);
