// Today and overdue (WT-07 decision 7, WS-110 section 1): a task is overdue when its due
// date is before today in the viewer's browser and it is not in a `done` column. The server
// stores no time zone and computes nothing.

function pad(value: number, length: number): string {
  return String(value).padStart(length, "0");
}

/**
 * `YYYY-MM-DD` from `now`'s local year, month and day. Never `toISOString`, which is UTC
 * and would be a day off on either side of midnight away from UTC.
 */
export function localDate(now: Date): string {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}`;
}

/**
 * Whether a task is overdue. Calendar dates are `YYYY-MM-DD` with a four-digit year, so
 * string order is date order. Due today is not overdue; before today is known (a server
 * render), nothing is.
 */
export function isOverdue(dueDate: string | null, done: boolean, today: string | null): boolean {
  return dueDate !== null && !done && today !== null && dueDate < today;
}

const FORMAT = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

/**
 * `Dec 1, 2026`. A calendar date has no time zone: its UTC midnight, written in UTC, is the
 * same day everywhere (WS-110 question 1: fixed English, with the year).
 */
export function formatDueDate(dueDate: string): string {
  const [year = 1, month = 1, day = 1] = dueDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  // `Date.UTC` maps the years 0 to 99 to 1900 to 1999.
  date.setUTCFullYear(year);
  return FORMAT.format(date);
}
