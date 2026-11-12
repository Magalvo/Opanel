import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Better Auth's `verification` model. It is used by its email flows, which Opanel does not
// have in v1; the adapter requires the table to exist. Invitation and reset tokens are
// Opanel's own (WT-02 decisions 5 and 6).
export const verification = pgTable(
  "verification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);
