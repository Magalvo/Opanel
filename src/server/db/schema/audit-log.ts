import { bigint, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { accounts } from "./accounts";

// Append-only record of security and administrative actions (canonical doc 0001 section 7).
// A trigger (migration 0003) rejects UPDATE and DELETE. An account with history cannot be
// deleted, only deactivated. A null actor means "no authenticated actor" (for example a
// failed sign-in) and is always written explicitly.
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    actorAccountId: uuid("actor_account_id").references(() => accounts.id, {
      onDelete: "restrict",
    }),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    data: jsonb("data"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_log_entity_idx").on(table.entity, table.entityId, table.createdAt),
    index("audit_log_actor_idx").on(table.actorAccountId, table.createdAt),
  ],
);
