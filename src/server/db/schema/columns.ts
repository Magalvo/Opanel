import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { byteOrderedText } from "./collated-text";
import { projects } from "./projects";

// A project's board columns (canonical doc 0003 section 5, WT-03 decision 10). `position`
// orders them byte by byte (amendment A2) and is unique within a project, so two writers can
// never leave two columns in an undefined order.
export const columns = pgTable(
  "columns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    category: text("category").notNull(),
    position: byteOrderedText("position").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("columns_category_check", sql`${table.category} in ('todo', 'in_progress', 'done')`),
    check("columns_version_positive", sql`${table.version} >= 1`),
    uniqueIndex("columns_project_position_idx").on(table.projectId, table.position),
  ],
);
