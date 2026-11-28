// A sprint's dates in words, and a new sprint's defaults (WS-144 sections 4, 6 and 7).
// Calendar dates are `YYYY-MM-DD`, compared as strings and counted in UTC days, so the
// viewer's time zone never moves them.
import { formatDueDate } from "@/components/task/due-date";
import type { Sprint } from "@/lib/schemas/sprints";

const DAY_MS = 86_400_000;

function dayNumber(date: string): number {
  const [year = 1, month = 1, day = 1] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

function dateOf(days: number): string {
  return new Date(days * DAY_MS).toISOString().slice(0, 10);
}

/** "Dec 1, 2026 – Dec 14, 2026". */
export function sprintDatesText(startDate: string, endDate: string): string {
  return `${formatDueDate(startDate)} – ${formatDueDate(endDate)}`;
}

function days(count: number): string {
  return count === 1 ? "1 day" : `${String(count)} days`;
}

/** "9 days left", "Ends today", or "Ended 2 days ago", from `today` (`YYYY-MM-DD`). */
export function daysLeftText(endDate: string, today: string): string {
  const left = dayNumber(endDate) - dayNumber(today);
  if (left > 0) return `${days(left)} left`;
  if (left === 0) return "Ends today";
  return `Ended ${days(-left)} ago`;
}

/** How long a new sprint lasts by default, as "Sprint 1" does (WS-142 section 6). */
const SPRINT_DAYS = 14;

/**
 * A new sprint's name and dates (question 3): "Sprint N", N one more than the project's
 * sprints, from the day after the latest sprint ends, or today when that is earlier or
 * there is none, for 14 days.
 */
export function newSprintDefaults(
  sprints: readonly Sprint[],
  today: string,
): { name: string; startDate: string; endDate: string } {
  const latest = sprints.reduce<string | null>(
    (end, item) => (end === null || item.endDate > end ? item.endDate : end),
    null,
  );
  const start = Math.max(
    dayNumber(today),
    latest === null ? dayNumber(today) : dayNumber(latest) + 1,
  );
  return {
    name: `Sprint ${String(sprints.length + 1)}`,
    startDate: dateOf(start),
    endDate: dateOf(start + SPRINT_DAYS),
  };
}
