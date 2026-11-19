import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";

import { accounts } from "./accounts";
import { projects } from "./projects";

// The rows below belong to agent accounts only (WS-071 question 1): `account_kind` is fixed
// to 'agent' and is part of the foreign key to accounts (id, kind), so PostgreSQL refuses a
// row for a human whatever code writes it.

/** An agent's scopes: the permissions it holds (WT-05 decision 1). */
export const agentScopes = pgTable(
  "agent_scopes",
  {
    accountId: uuid("account_id").notNull(),
    accountKind: text("account_kind").notNull().default("agent"),
    scope: text("scope").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.scope] }),
    foreignKey({
      name: "agent_scopes_account_fk",
      columns: [table.accountId, table.accountKind],
      foreignColumns: [accounts.id, accounts.kind],
    }).onDelete("cascade"),
    check("agent_scopes_account_kind_check", sql`${table.accountKind} = 'agent'`),
    // The five agent scopes of doc 0001 section 3: never a manage or delete permission.
    check(
      "agent_scopes_scope_check",
      sql`${table.scope} in ('projects:read', 'tasks:read', 'reports:write', 'comments:write', 'tasks:write')`,
    ),
  ],
);

/** The projects an agent is restricted to, when its `all_projects` is false. */
export const agentProjects = pgTable(
  "agent_projects",
  {
    accountId: uuid("account_id").notNull(),
    accountKind: text("account_kind").notNull().default("agent"),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.projectId] }),
    foreignKey({
      name: "agent_projects_account_fk",
      columns: [table.accountId, table.accountKind],
      foreignColumns: [accounts.id, accounts.kind],
    }).onDelete("cascade"),
    check("agent_projects_account_kind_check", sql`${table.accountKind} = 'agent'`),
    index("agent_projects_project_id_idx").on(table.projectId),
  ],
);
