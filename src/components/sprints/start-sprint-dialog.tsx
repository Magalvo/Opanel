"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Sprint } from "@/lib/schemas/sprints";

function tasks(count: number): string {
  return count === 1 ? "Its 1 task" : `Its ${String(count)} tasks`;
}

/** A confirmation without a trigger: the focus goes back to `returnFocusTo` on close. */
function Confirm({
  title,
  description,
  action,
  destructive = false,
  returnFocusTo,
  onOpenChange,
  onConfirm,
}: Readonly<{
  title: string;
  description: string;
  action: string;
  destructive?: boolean;
  returnFocusTo: HTMLElement | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}>) {
  return (
    <AlertDialog open onOpenChange={onOpenChange}>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusTo?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * "Start Sprint 4?" (WS-144 section 6): says how many of its tasks go to the board's first
 * column before the start is sent.
 */
export function StartSprintDialog({
  sprint,
  taskCount,
  firstColumn,
  returnFocusTo,
  onOpenChange,
  onConfirm,
}: Readonly<{
  sprint: Sprint;
  taskCount: number;
  firstColumn: string;
  returnFocusTo: HTMLElement | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}>) {
  return (
    <Confirm
      title={`Start ${sprint.name}?`}
      description={
        taskCount === 0
          ? `It has no tasks yet. It becomes the board's sprint.`
          : `${tasks(taskCount)} go to the first column, ${firstColumn}.`
      }
      action="Start sprint"
      returnFocusTo={returnFocusTo}
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
    />
  );
}

/**
 * "Delete Sprint 4?" (WS-144 section 6): only for a planned sprint, whose tasks go back to
 * the backlog, unscheduled.
 */
export function DeleteSprintDialog({
  sprint,
  taskCount,
  returnFocusTo,
  onOpenChange,
  onConfirm,
}: Readonly<{
  sprint: Sprint;
  taskCount: number;
  returnFocusTo: HTMLElement | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}>) {
  return (
    <Confirm
      title={`Delete ${sprint.name}?`}
      description={
        taskCount === 0
          ? "It has no tasks."
          : `${tasks(taskCount)} go back to the backlog, unscheduled.`
      }
      action="Delete"
      destructive
      returnFocusTo={returnFocusTo}
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
    />
  );
}
