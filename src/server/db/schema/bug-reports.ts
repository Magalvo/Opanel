import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { accounts } from "./accounts";
import { projects } from "./projects";
import { tasks } from "./tasks";

// Every bug report as an agent sent it, and what triage did with it (canonical doc 0001
// section 6, WT-06 decision 11). Append-only: a trigger refuses updates and deletes, and the
// runtime role has neither right (migration 0018). The author is always an agent: its kind
// is part of the foreign key to accounts (id, kind), as in WS-071.
export const bugReports = pgTable(
  "bug_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    agentAccountId: uuid("agent_account_id").notNull(),
    accountKind: text("account_kind").notNull().default("agent"),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "restrict" }),
    outcome: text("outcome").notNull(),
    originLayer: text("origin_layer").notNull(),
    confidence: real("confidence"),
    severity: text("severity").notNull(),
    fingerprint: text("fingerprint").notNull(),
    runId: text("run_id"),
    // The validated body, as sent.
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "bug_reports_agent_account_fk",
      columns: [table.agentAccountId, table.accountKind],
      foreignColumns: [accounts.id, accounts.kind],
    }).onDelete("restrict"),
    check("bug_reports_account_kind_check", sql`${table.accountKind} = 'agent'`),
    check("bug_reports_outcome_check", sql`${table.outcome} in ('created', 'deduplicated')`),
    check(
      "bug_reports_origin_layer_check",
      sql`${table.originLayer} in ('frontend', 'api', 'backend', 'unknown')`,
    ),
    check(
      "bug_reports_confidence_check",
      sql`${table.confidence} is null or ${table.confidence} between 0 and 1`,
    ),
    check(
      "bug_reports_severity_check",
      sql`${table.severity} in ('low', 'medium', 'high', 'critical')`,
    ),
    check(
      "bug_reports_fingerprint_check",
      sql`char_length(${table.fingerprint}) between 1 and 128`,
    ),
    check(
      "bug_reports_run_id_check",
      sql`${table.runId} is null or char_length(${table.runId}) between 1 and 128`,
    ),
    index("bug_reports_task_idx").on(table.taskId, table.createdAt, table.id),
    index("bug_reports_project_idx").on(table.projectId, table.createdAt),
  ],
);
