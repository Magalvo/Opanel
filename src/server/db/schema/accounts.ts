import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  pgTable,
  text,
  timestamp,
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
    // Agent roles are added by WT-05 in its own migration; only humans are constrained here.
    check(
      "accounts_human_role_check",
      sql`${table.kind} <> 'human' or ${table.role} in ('admin', 'manager', 'member', 'viewer')`,
    ),
  ],
);
