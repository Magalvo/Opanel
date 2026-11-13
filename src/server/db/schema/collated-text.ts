import { customType } from "drizzle-orm/pg-core";

/**
 * `text collate "C"`: compared and sorted byte by byte, whatever the database's collation.
 * For ordering keys from `src/lib/position.ts` (WT-03 amendment A2). Drizzle ORM has no
 * collation option on `text`, so the type is declared here and drizzle-kit writes it into
 * the migration as it stands.
 */
export const byteOrderedText = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'text collate "C"';
  },
});
