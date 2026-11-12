import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Counters of the sign-in limiter (WT-02 decision 10). One row per key; the window resets
// in place, so the table stays as small as the number of distinct keys in the last day.
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull(),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("rate_limits_window_started_at_idx").on(table.windowStartedAt)],
);
