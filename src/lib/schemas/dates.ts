import { z } from "zod";

/**
 * A calendar date, `YYYY-MM-DD` (doc 0004 section 3). `z.iso.date()` checks the format and
 * the calendar; the year must also be `0001` or later, which PostgreSQL's `date` requires
 * (WS-102 section 3).
 */
export const calendarDateSchema = z.iso
  .date()
  .refine((value) => !value.startsWith("0000-"), { message: "Not a calendar date." });

export type CalendarDate = z.infer<typeof calendarDateSchema>;
