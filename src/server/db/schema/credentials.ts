import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { accounts } from "./accounts";

// Better Auth's `account` model: one row per sign-in method of an account. The password
// hash lives here, not on `accounts` (WT-02 decision 2). The nullable OAuth columns are
// required by Better Auth's adapter, which refuses to start without them; unused in v1.
export const credentials = pgTable(
  "credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    passwordHash: text("password_hash"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("credentials_provider_unique").on(table.providerId, table.providerAccountId)],
);
