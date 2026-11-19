import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { accounts } from "./accounts";

// Agents' API tokens (canonical doc 0001 section 4, WT-05 decision 3). A token is
// `opk_<publicId>_<secret>`: only the public id and the SHA-256 of the secret are stored;
// the token itself is shown once, when it is created.
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").notNull(),
    accountKind: text("account_kind").notNull().default("agent"),
    publicId: text("public_id").notNull().unique("api_tokens_public_id_unique"),
    // Hex, like account_tokens.token_hash (WS-071 question 3).
    secretHash: text("secret_hash").notNull(),
    name: text("name").notNull(),
    createdBy: uuid("created_by").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Null: no expiry (WT-05 question 3).
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: "api_tokens_account_fk",
      columns: [table.accountId, table.accountKind],
      foreignColumns: [accounts.id, accounts.kind],
    }).onDelete("cascade"),
    check("api_tokens_account_kind_check", sql`${table.accountKind} = 'agent'`),
    check("api_tokens_public_id_check", sql`${table.publicId} ~ '^[a-z2-7]{12}$'`),
    check("api_tokens_secret_hash_check", sql`${table.secretHash} ~ '^[0-9a-f]{64}$'`),
    check("api_tokens_name_check", sql`char_length(${table.name}) between 1 and 80`),
    index("api_tokens_account_id_idx").on(table.accountId),
  ],
);
