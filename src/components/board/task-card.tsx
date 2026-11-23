"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  BookmarkIcon,
  BugIcon,
  GripVerticalIcon,
  RepeatIcon,
  SquareCheckIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { LabelChips } from "@/components/labels/label-chip";
import { SEVERITY_LABELS } from "@/components/task/bug-labels";
import { isOverdue } from "@/components/task/due-date";
import { DueDateText, PriorityIcon } from "@/components/task/task-meta";
import { Badge } from "@/components/ui/badge";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useToday } from "@/hooks/use-today";
import type { TaskSummary, TaskType } from "@/lib/schemas/tasks";
import { cn } from "@/lib/utils";

import { CardMenu } from "./card-menu";
import type { MenuMove } from "./moves";

export const TYPE_LABELS: Record<TaskType, string> = { task: "Task", bug: "Bug", story: "Story" };

const TYPE_ICONS = { task: SquareCheckIcon, bug: BugIcon, story: BookmarkIcon } as const;

function assigneeName(task: TaskSummary): string | null {
  if (task.assignee === null) return null;
  return task.assignee.active ? task.assignee.name : `${task.assignee.name} (inactive)`;
}

/** The task's own page: `/projects/OPA/tasks/OPA-12` (WS-038). */
export function taskHref(key: string) {
  const projectKey = key.slice(0, key.lastIndexOf("-"));
  return `/projects/${projectKey}/tasks/${key}` as const;
}

const CARD =
  "grid gap-1.5 rounded-lg border bg-card p-3 text-left text-sm text-card-foreground shadow-xs";

/**
 * The content of a card: key, title, priority (WS-110), type, a bug's severity and report
 * count (WS-091), assignee, team, due date (WS-110) and labels (WS-108). The title links to
 * the task (WS-038), except on the card that follows the pointer while dragging; `handle`
 * is the drag handle, beside the key. `done`: the card is in a `done` column, so it is
 * never overdue; a backlog task has no column and is never done.
 */
export function CardBody({
  task,
  linked = true,
  handle,
  done = false,
}: Readonly<{ task: TaskSummary; linked?: boolean; handle?: ReactNode; done?: boolean }>) {
  const Icon = TYPE_ICONS[task.type];
  const person = assigneeName(task);
  const today = useToday();
  return (
    <>
      <span className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground">{task.key}</span>
        {handle}
      </span>
      {linked ? (
        <Link
          href={taskHref(task.key)}
          data-title
          // A link is natively draggable; the card's own drag must win.
          draggable={false}
          className="break-words underline-offset-4 outline-none hover:underline focus-visible:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {task.title}
        </Link>
      ) : (
        <span data-title className="break-words">
          {task.title}
        </span>
      )}
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <PriorityIcon priority={task.priority} />
        <Badge variant="outline">
          <Icon aria-hidden="true" />
          {TYPE_LABELS[task.type]}
        </Badge>
        {task.severity !== null && (
          <Badge
            variant="outline"
            // Red text on the card's own background: the `destructive` badge's tinted
            // background leaves too little contrast in light mode (WS-091, deviation 1).
            className={cn(
              (task.severity === "high" || task.severity === "critical") &&
                "border-destructive/60 text-destructive",
            )}
          >
            <span className="sr-only">Severity: </span>
            {SEVERITY_LABELS[task.severity]}
          </Badge>
        )}
        {task.occurrences > 1 && (
          <span className="inline-flex items-center gap-1">
            <RepeatIcon aria-hidden="true" className="size-3 shrink-0" />
            {task.occurrences} reports
          </span>
        )}
        {person !== null && (
          <span className="inline-flex min-w-0 items-center gap-1">
            <UserIcon aria-hidden="true" className="size-3 shrink-0" />
            <span className="break-words">{person}</span>
          </span>
        )}
        {task.assigneeTeam !== null && (
          <span className="inline-flex min-w-0 items-center gap-1">
            <UsersIcon aria-hidden="true" className="size-3 shrink-0" />
            <span className="break-words">{task.assigneeTeam.name}</span>
          </span>
        )}
        <DueDateText dueDate={task.dueDate} overdue={isOverdue(task.dueDate, done, today)} />
      </span>
      <LabelChips labels={task.labels} />
    </>
  );
}

/** A card nobody can drag: for a Viewer and on an archived project. */
export function StaticCard({ task, done }: Readonly<{ task: TaskSummary; done: boolean }>) {
  return (
    <li>
      <div className={CARD}>
        <CardBody task={task} done={done} />
      </div>
    </li>
  );
}

/**
 * A card that can be dragged (WS-037 section 5): with the pointer or by touch from anywhere
 * on it, and by keyboard from its handle, which carries the drag attributes and the
 * instructions (WS-038 section 4). The title stays a link. Its menu makes the same moves
 * by clicks alone (WS-111 section 1). With reduced motion, cards do not slide into place
 * (WS-111 section 3).
 */
export function SortableCard({
  task,
  disabled,
  done,
  moves,
  onMove,
}: Readonly<{
  task: TaskSummary;
  disabled: boolean;
  done: boolean;
  moves: readonly MenuMove[];
  onMove: (move: MenuMove) => void;
}>) {
  const reducedMotion = useReducedMotion();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    disabled: { draggable: disabled, droppable: false },
    ...(reducedMotion ? { transition: null } : {}),
  });

  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      aria-label={`Move ${task.key} ${task.title}`}
      data-task-id={task.id}
      className="-my-1 -mr-1 inline-flex size-7 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <GripVerticalIcon aria-hidden="true" className="size-4" />
    </button>
  );

  const controls = (
    <span className="flex items-center gap-1">
      <CardMenu
        taskId={task.id}
        taskKey={task.key}
        moves={moves}
        disabled={disabled}
        onMove={onMove}
      />
      {handle}
    </span>
  );

  return (
    <li>
      <div
        ref={setNodeRef}
        style={{ transform: CSS.Transform.toString(transform), transition }}
        {...listeners}
        className={cn(CARD, "cursor-grab touch-manipulation", isDragging && "opacity-50")}
      >
        <CardBody task={task} handle={controls} done={done} />
      </div>
    </li>
  );
}

/** The card shown under the pointer while it is dragged. */
export function OverlayCard({ task, done }: Readonly<{ task: TaskSummary; done: boolean }>) {
  return (
    <div className={cn(CARD, "cursor-grabbing shadow-lg")}>
      <CardBody task={task} linked={false} done={done} />
    </div>
  );
}
