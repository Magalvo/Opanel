"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  BookmarkIcon,
  BugIcon,
  GripVerticalIcon,
  SquareCheckIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import type { TaskSummary, TaskType } from "@/lib/schemas/tasks";
import { cn } from "@/lib/utils";

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
 * The content of a card: key, title, type, assignee and team. The title links to the task
 * (WS-038), except on the card that follows the pointer while dragging; `handle` is the
 * drag handle, beside the key.
 */
export function CardBody({
  task,
  linked = true,
  handle,
}: Readonly<{ task: TaskSummary; linked?: boolean; handle?: ReactNode }>) {
  const Icon = TYPE_ICONS[task.type];
  const person = assigneeName(task);
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
        <Badge variant="outline">
          <Icon aria-hidden="true" />
          {TYPE_LABELS[task.type]}
        </Badge>
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
      </span>
    </>
  );
}

/** A card nobody can drag: for a Viewer and on an archived project. */
export function StaticCard({ task }: Readonly<{ task: TaskSummary }>) {
  return (
    <li>
      <div className={CARD}>
        <CardBody task={task} />
      </div>
    </li>
  );
}

/**
 * A card that can be dragged (WS-037 section 5): with the pointer or by touch from anywhere
 * on it, and by keyboard from its handle, which carries the drag attributes and the
 * instructions (WS-038 section 4). The title stays a link.
 */
export function SortableCard({
  task,
  disabled,
}: Readonly<{ task: TaskSummary; disabled: boolean }>) {
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

  return (
    <li>
      <div
        ref={setNodeRef}
        style={{ transform: CSS.Transform.toString(transform), transition }}
        {...listeners}
        className={cn(CARD, "cursor-grab touch-manipulation", isDragging && "opacity-50")}
      >
        <CardBody task={task} handle={handle} />
      </div>
    </li>
  );
}

/** The card shown under the pointer while it is dragged. */
export function OverlayCard({ task }: Readonly<{ task: TaskSummary }>) {
  return (
    <div className={cn(CARD, "cursor-grabbing shadow-lg")}>
      <CardBody task={task} linked={false} />
    </div>
  );
}
