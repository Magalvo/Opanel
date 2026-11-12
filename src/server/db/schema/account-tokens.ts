import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { accounts } from "./accounts";

// One-time links for invitations and password resets (WT-02 decisions 5 and 6). Only the
// SHA-256 of the token is stored; the token itself is shown once, when it is issued.
export const accountTokens = pgTable(
  "account_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Set when the link is redeemed (WI-019).
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("account_tokens_kind_check", sql`${table.kind} in ('invitation', 'reset')`),
    index("account_tokens_account_id_idx").on(table.accountId),
  ],
);
