import { z } from "zod";

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;

/**
 * Query parameters of every list endpoint (canonical doc 0004 section 5). Strict: an
 * unknown parameter is an error. `limit` arrives as text and is coerced.
 */
export const paginationQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  cursor: z.string().min(1).max(512).optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** `{ items, nextCursor }`, with `nextCursor` null on the last page. */
export function pageSchema<Item extends z.ZodType>(item: Item) {
  return z.strictObject({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}
