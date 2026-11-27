import {
  CalendarClockIcon,
  CalendarIcon,
  CircleAlertIcon,
  SignalHighIcon,
  SignalLowIcon,
  SignalMediumIcon,
} from "lucide-react";

import type { Priority } from "@/lib/schemas/tasks";
import { cn } from "@/lib/utils";

import { formatDueDate } from "./due-date";

export const PRIORITY_LABELS: Record<Priority, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

/** One shape per level, so colour is never the only signal (WS-110 section 2). */
const PRIORITY_ICONS = {
  low: { Icon: SignalLowIcon, className: "text-muted-foreground" },
  medium: { Icon: SignalMediumIcon, className: "text-muted-foreground" },
  high: { Icon: SignalHighIcon, className: "text-foreground" },
  urgent: { Icon: CircleAlertIcon, className: "text-destructive" },
} as const;

/** A task's priority as an icon with an accessible name; nothing for `none`. */
export function PriorityIcon({ priority }: Readonly<{ priority: Priority }>) {
  if (priority === "none") return null;
  const { Icon, className } = PRIORITY_ICONS[priority];
  const name = `Priority: ${PRIORITY_LABELS[priority]}`;
  return (
    <span role="img" aria-label={name} title={name} className={cn("inline-flex", className)}>
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
    </span>
  );
}

/**
 * A task's due date as text; when overdue, it says so in words, not by colour alone
 * (WCAG 1.4.1). Nothing without a date.
 */
export function DueDateText({
  dueDate,
  overdue,
}: Readonly<{ dueDate: string | null; overdue: boolean }>) {
  if (dueDate === null) return null;
  const Icon = overdue ? CalendarClockIcon : CalendarIcon;
  return (
    <span
      className={cn("inline-flex items-center gap-1", overdue && "font-medium text-destructive")}
    >
      <Icon aria-hidden="true" className="size-3 shrink-0" />
      <span>{`${overdue ? "Overdue, due" : "Due"} ${formatDueDate(dueDate)}`}</span>
    </span>
  );
}

/** A number of story points as text: "3", "0.5" (WS-139 section 6). */
export function formatPoints(points: number): string {
  return String(points);
}

/** "1 story point", "3 story points": a card's points in words (WS-139 section 6). */
export function storyPointsName(points: number): string {
  return `${formatPoints(points)} story point${points === 1 ? "" : "s"}`;
}
