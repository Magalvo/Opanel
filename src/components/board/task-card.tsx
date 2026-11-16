"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { BookmarkIcon, BugIcon, SquareCheckIcon, UserIcon, UsersIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { TaskSummary, TaskType } from "@/lib/schemas/tasks";
import { cn } from "@/lib/utils";

export const TYPE_LABELS: Record<TaskType, string> = { task: "Task", bug: "Bug", story: "Story" };

const TYPE_ICONS = { task: SquareCheckIcon, bug: BugIcon, story: BookmarkIcon } as const;

function assigneeName(task: TaskSummary): string | null {
  if (task.assignee === null) return null;
  return task.assignee.active ? task.assignee.name : `${task.assignee.name} (inactive)`;
}

const CARD =
  "grid gap-1.5 rounded-lg border bg-card p-3 text-left text-sm text-card-foreground shadow-xs";

/** The content of a card: key, title, type, assignee and team. */
export function CardBody({ task }: Readonly<{ task: TaskSummary }>) {
  const Icon = TYPE_ICONS[task.type];
  const person = assigneeName(task);
  return (
    <>
      <span className="font-mono text-xs text-muted-foreground">{task.key}</span>
      <span data-title className="break-words">
        {task.title}
      </span>
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

/** A card that can be dragged with the pointer, by touch or by keyboard (WS-037 section 5). */
export function SortableCard({
  task,
  disabled,
}: Readonly<{ task: TaskSummary; disabled: boolean }>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: { draggable: disabled, droppable: false },
  });

  return (
    <li>
      <div
        ref={setNodeRef}
        style={{ transform: CSS.Transform.toString(transform), transition }}
        {...attributes}
        {...listeners}
        data-task-id={task.id}
        className={cn(
          CARD,
          "cursor-grab touch-manipulation outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          isDragging && "opacity-50",
        )}
      >
        <CardBody task={task} />
      </div>
    </li>
  );
}

/** The card shown under the pointer while it is dragged. */
export function OverlayCard({ task }: Readonly<{ task: TaskSummary }>) {
  return (
    <div className={cn(CARD, "cursor-grabbing shadow-lg")}>
      <CardBody task={task} />
    </div>
  );
}
