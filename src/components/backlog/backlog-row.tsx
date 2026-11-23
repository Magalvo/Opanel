"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowRightIcon, GripVerticalIcon } from "lucide-react";
import type { ReactNode } from "react";

import { CardBody } from "@/components/board/task-card";
import { Button } from "@/components/ui/button";
import type { TaskSummary } from "@/lib/schemas/tasks";
import { cn } from "@/lib/utils";

const ROW =
  "flex items-start gap-3 rounded-lg border bg-card p-3 text-left text-sm text-card-foreground shadow-xs";

/** A row's content: what a board card shows (WS-109 section 2). */
function Content({ task, handle }: Readonly<{ task: TaskSummary; handle?: ReactNode }>) {
  return (
    <div className="grid min-w-0 flex-1 gap-1.5">
      <CardBody task={task} handle={handle} />
    </div>
  );
}

/** A row nobody can change: for a Viewer and on an archived project. */
export function StaticBacklogRow({ task }: Readonly<{ task: TaskSummary }>) {
  return (
    <li>
      <div className={ROW}>
        <Content task={task} />
      </div>
    </li>
  );
}

/**
 * A row that can be dragged (WS-109 section 3): with the pointer or by touch from anywhere
 * on it, and by keyboard from its handle. "Move to board" sends it to the end of the first
 * column (section 4).
 */
export function SortableBacklogRow({
  task,
  disabled,
  sending,
  onMoveToBoard,
}: Readonly<{
  task: TaskSummary;
  disabled: boolean;
  sending: boolean;
  onMoveToBoard: () => void;
}>) {
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
        className={cn(ROW, "cursor-grab touch-manipulation", isDragging && "opacity-50")}
      >
        <Content task={task} handle={handle} />
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          data-move-id={task.id}
          disabled={disabled || sending}
          onClick={onMoveToBoard}
        >
          <ArrowRightIcon aria-hidden="true" />
          {/* The visible text starts the name, then the task (WCAG 2.5.3). */}
          {"Move to board "}
          <span className="sr-only">{task.key}</span>
        </Button>
      </div>
    </li>
  );
}

/** The row shown under the pointer while it is dragged. */
export function OverlayRow({ task }: Readonly<{ task: TaskSummary }>) {
  return (
    <div className={cn(ROW, "cursor-grabbing shadow-lg")}>
      <div className="grid min-w-0 flex-1 gap-1.5">
        <CardBody task={task} linked={false} />
      </div>
    </div>
  );
}
