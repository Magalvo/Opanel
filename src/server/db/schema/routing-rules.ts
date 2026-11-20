import { sql } from "drizzle-orm";
import { check, index, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";

import { projects } from "./projects";
import { teams } from "./teams";

// Which team owns each layer of a project, for the triage pipeline (canonical doc 0001
// section 6, WT-06 decision 4). No row for a layer means "the triage team"; `unknown` is
// never routed. A team named here cannot be deleted (`team_in_use`).
export const routingRules = pgTable(
  "routing_rules",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    originLayer: text("origin_layer").notNull(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.originLayer] }),
    check(
      "routing_rules_origin_layer_check",
      sql`${table.originLayer} in ('frontend', 'api', 'backend')`,
    ),
    index("routing_rules_team_idx").on(table.teamId),
  ],
);
