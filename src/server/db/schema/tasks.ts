import { sql } from "drizzle-orm";
import {
  check,
  customType,
  date,
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

/** PostgreSQL's `tsvector`, which Drizzle has no type for; only ever written by the database. */
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

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
    // `null` when the task is in the project's backlog (WT-07 decision 1, WS-101).
    columnId: uuid("column_id").references(() => columns.id, { onDelete: "restrict" }),
    position: byteOrderedText("position").notNull(),
    assigneeTeamId: uuid("assignee_team_id").references(() => teams.id, { onDelete: "restrict" }),
    assigneeAccountId: uuid("assignee_account_id").references(() => accounts.id, {
      onDelete: "restrict",
    }),
    epicId: uuid("epic_id").references(() => epics.id, { onDelete: "restrict" }),
    // A bug's severity, and what the triage pipeline counts (WT-06 decision 1, WS-086).
    severity: text("severity"),
    fingerprint: text("fingerprint"),
    occurrences: integer("occurrences").notNull().default(0),
    lastReportedAt: timestamp("last_reported_at", { withTimezone: true }),
    // Priority and due date (WT-07 decisions 6 and 7, WS-102).
    priority: text("priority").notNull().default("none"),
    dueDate: date("due_date", { mode: "string" }),
    reporterAccountId: uuid("reporter_account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    version: integer("version").notNull().default(1),
    // Soft delete (WT-03 decision 12), used from WI-032.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => accounts.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Text search over title and description, computed by the database (WS-116 section 4).
    search: tsvector("search").generatedAlwaysAs(
      sql`setweight(to_tsvector('simple', title), 'A') || setweight(to_tsvector('simple', description), 'B')`,
    ),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("tasks_type_check", sql`${table.type} in ('task', 'bug', 'story')`),
    check("tasks_version_positive", sql`${table.version} >= 1`),
    check(
      "tasks_severity_check",
      sql`${table.severity} is null or (${table.severity} in ('low', 'medium', 'high', 'critical') and ${table.type} = 'bug')`,
    ),
    check(
      "tasks_fingerprint_check",
      sql`${table.fingerprint} is null or char_length(${table.fingerprint}) between 1 and 128`,
    ),
    check("tasks_occurrences_check", sql`${table.occurrences} >= 0`),
    check(
      "tasks_priority_check",
      sql`${table.priority} in ('none', 'low', 'medium', 'high', 'urgent')`,
    ),
    uniqueIndex("tasks_project_number_idx").on(table.projectId, table.number),
    uniqueIndex("tasks_column_position_idx").on(table.columnId, table.position),
    // The backlog's order; nulls are distinct, so the index above never sees it (WS-101).
    uniqueIndex("tasks_backlog_position_idx")
      .on(table.projectId, table.position)
      .where(sql`${table.columnId} is null`),
    index("tasks_assignee_team_idx").on(table.assigneeTeamId),
    index("tasks_assignee_account_idx").on(table.assigneeAccountId),
    index("tasks_epic_idx").on(table.epicId),
    index("tasks_search_idx").using("gin", table.search),
    index("tasks_due_date_idx").on(table.dueDate),
    index("tasks_reporter_idx").on(table.reporterAccountId),
    // The default order of the list across projects (WS-118 section 7).
    index("tasks_updated_idx").on(table.updatedAt, table.id),
    // The triage pipeline's lookup; not unique: an advisory lock serialises it (WT-06
    // decision 6).
    index("tasks_project_fingerprint_idx")
      .on(table.projectId, table.fingerprint)
      .where(sql`${table.fingerprint} is not null`),
  ],
);
