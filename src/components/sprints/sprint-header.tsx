"use client";

import Link from "next/link";
import { type ReactNode, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { useToday } from "@/hooks/use-today";
import type { Sprint } from "@/lib/schemas/sprints";
import { cn } from "@/lib/utils";

import { daysLeftText, sprintDatesText } from "./dates";
import { SprintProgress } from "./sprint-progress";

/** A goal longer than this, or of several lines, is clamped to two lines with "More". */
const LONG_GOAL = 140;

/** A sprint's goal, clamped to two lines with "More" when it is long (WS-144 section 4). */
export function SprintGoal({ goal }: Readonly<{ goal: string }>) {
  const id = useId();
  const [open, setOpen] = useState(false);
  if (goal.trim() === "") return null;
  const long = goal.length > LONG_GOAL || goal.includes("\n");
  return (
    <div className="grid justify-items-start gap-1">
      <p
        id={id}
        className={cn("text-sm break-words whitespace-pre-line", long && !open && "line-clamp-2")}
      >
        {goal}
      </p>
      {long && (
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => {
            setOpen(!open);
          }}
        >
          {open ? "Less" : "More"}
        </Button>
      )}
    </div>
  );
}

/** A sprint's dates, with the days left when it is active. */
export function SprintDates({
  sprint,
  daysLeft = false,
}: Readonly<{ sprint: Sprint; daysLeft?: boolean }>) {
  const today = useToday();
  return (
    <p className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
      <span>{sprintDatesText(sprint.startDate, sprint.endDate)}</span>
      {daysLeft && today !== null && <span>{daysLeftText(sprint.endDate, today)}</span>}
    </p>
  );
}

/**
 * The active sprint (WS-144 sections 4 and 7): its name, dates with the days left, goal and
 * progress, over the board and at the top of the backlog. `actions` are the page's own.
 */
export function SprintHeader({
  sprint,
  actions = null,
  className,
}: Readonly<{ sprint: Sprint; actions?: ReactNode; className?: string }>) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={cn("grid w-full max-w-3xl gap-2 rounded-xl border p-3", className)}
    >
      <div className="flex flex-wrap items-start gap-2">
        <h2 id={id} className="font-medium break-words">
          {`Active sprint: ${sprint.name}`}
        </h2>
        {actions !== null && <div className="ml-auto flex flex-wrap gap-2">{actions}</div>}
      </div>
      <SprintDates sprint={sprint} daysLeft />
      <SprintGoal goal={sprint.goal} />
      <SprintProgress progress={sprint.progress} />
    </section>
  );
}

/**
 * The board of a project with sprints while none is active (WS-144 section 7, question 1):
 * no columns, so nothing can be added or moved there, and the way to the backlog.
 */
export function NoActiveSprint({ projectKey }: Readonly<{ projectKey: string }>) {
  return (
    <section
      aria-label="No active sprint"
      className="grid w-full max-w-3xl justify-items-start gap-2 rounded-xl border p-4"
    >
      <p className="font-medium">No sprint is active.</p>
      <Link
        href={`/projects/${projectKey}/backlog`}
        className="text-sm underline underline-offset-4"
      >
        Plan and start a sprint in the backlog
      </Link>
    </section>
  );
}
