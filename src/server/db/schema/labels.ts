import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { projects } from "./projects";
import { tasks } from "./tasks";

// Labels (doc 0003 section 4, WT-07 decision 8, WS-107): per project, a name unique in the
// project regardless of letter case, enforced by the index so it holds under concurrency,
// and a colour of the fixed palette (`LABEL_COLOURS`).
export const labels = pgTable(
  "labels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    colour: text("colour").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("labels_project_name_lower_idx").on(table.projectId, sql`lower(${table.name})`),
    check(
      "labels_colour_check",
      sql`${table.colour} in ('gray', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'indigo', 'purple', 'pink')`,
    ),
    check("labels_version_positive", sql`${table.version} >= 1`),
  ],
);

// The labels of a task. Deleting a task or a label deletes its rows; the label service
// records the removal in the task's history first (WS-107 section 6).
export const taskLabels = pgTable(
  "task_labels",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    labelId: uuid("label_id")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.labelId] }),
    index("task_labels_label_idx").on(table.labelId),
  ],
);
