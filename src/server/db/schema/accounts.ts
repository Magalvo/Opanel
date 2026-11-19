import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Humans and agents share this table (canonical doc 0001 section 3). Better Auth's `user`
// model is mapped onto it. Better Auth only ever creates and reads human rows.
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull().default("human"),
    name: text("name").notNull(),
    email: text("email").unique(),
    // Required by Better Auth's user model. There is no email in v1, so always false.
    emailVerified: boolean("email_verified").notNull().default(false),
    // Required by Better Auth's user model. Unused.
    image: text("image"),
    role: text("role").notNull(),
    // Agents only (WS-071): what the agent is for, shown to Admins.
    description: text("description"),
    // Agents only (WT-05 decision 7, WS-071 question 2): true for every project, false for
    // the projects listed in agent_projects, even when there are none.
    allProjects: boolean("all_projects"),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdBy: uuid("created_by").references((): AnyPgColumn => accounts.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("accounts_kind_check", sql`${table.kind} in ('human', 'agent')`),
    check(
      "accounts_human_has_email_check",
      sql`${table.kind} <> 'human' or ${table.email} is not null`,
    ),
    check(
      "accounts_human_role_check",
      sql`${table.kind} <> 'human' or ${table.role} in ('admin', 'manager', 'member', 'viewer')`,
    ),
    // Agent rows (WT-05 decisions 1 and 2, WS-071).
    check(
      "accounts_agent_role_check",
      sql`${table.kind} <> 'agent' or ${table.role} in ('qa_agent', 'worker_agent')`,
    ),
    check("accounts_agent_no_email_check", sql`${table.kind} <> 'agent' or ${table.email} is null`),
    check(
      "accounts_agent_fields_check",
      sql`(${table.kind} = 'human' and ${table.description} is null and ${table.allProjects} is null)
        or (${table.kind} = 'agent' and ${table.allProjects} is not null)`,
    ),
    check(
      "accounts_description_length_check",
      sql`${table.description} is null or char_length(${table.description}) between 1 and 500`,
    ),
    // An agent's name is unique among agents in any letter case; humans are not affected.
    uniqueIndex("accounts_agent_name_lower_idx")
      .on(sql`lower(${table.name})`)
      .where(sql`${table.kind} = 'agent'`),
    // The target of the agent-only foreign keys of agent_scopes, agent_projects and
    // api_tokens (WS-071 question 1).
    uniqueIndex("accounts_id_kind_idx").on(table.id, table.kind),
  ],
);
