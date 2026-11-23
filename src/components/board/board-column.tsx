"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { PlusIcon } from "lucide-react";
import { type ReactNode, useId } from "react";

import { CATEGORY_LABELS } from "@/components/projects/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Column } from "@/lib/schemas/columns";
import type { TaskSummary } from "@/lib/schemas/tasks";

import { columnDroppableId } from "./moves";
import { SortableCard, StaticCard } from "./task-card";

function count(tasks: number): string {
  return tasks === 1 ? "1 task" : `${String(tasks)} tasks`;
}

function ColumnFrame({
  column,
  tasks,
  onAdd,
  children,
}: Readonly<{
  column: Column;
  tasks: readonly TaskSummary[];
  onAdd: ((opener: HTMLButtonElement) => void) | null;
  children: ReactNode;
}>) {
  const id = useId();
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="flex w-72 shrink-0 flex-col gap-2 rounded-xl bg-muted/50 p-2"
    >
      <header className="flex flex-wrap items-center gap-2 px-1">
        <h2 id={`${id}-heading`} className="min-w-0 font-medium break-words">
          {column.name}
        </h2>
        <Badge variant="outline">{CATEGORY_LABELS[column.category]}</Badge>
        <span className="ml-auto text-xs text-muted-foreground">{count(tasks.length)}</span>
      </header>
      {children}
      {onAdd !== null && (
        <Button
          variant="ghost"
          size="sm"
          className="justify-start"
          onClick={(event) => {
            onAdd(event.currentTarget);
          }}
        >
          <PlusIcon aria-hidden="true" />
          Add task
        </Button>
      )}
    </section>
  );
}

function NoTasks() {
  return <p className="px-1 py-2 text-sm text-muted-foreground">No tasks</p>;
}

/** A column nobody can change (WS-037 section 1). */
export function StaticColumn({
  column,
  tasks,
}: Readonly<{ column: Column; tasks: readonly TaskSummary[] }>) {
  return (
    <ColumnFrame column={column} tasks={tasks} onAdd={null}>
      {tasks.length === 0 ? (
        <NoTasks />
      ) : (
        <ul className="grid gap-2">
          {tasks.map((task) => (
            <StaticCard key={task.id} task={task} done={column.category === "done"} />
          ))}
        </ul>
      )}
    </ColumnFrame>
  );
}

/** A column whose cards can be dragged, and which accepts cards even when empty. */
export function SortableColumn({
  column,
  tasks,
  dragDisabled,
  onAdd,
}: Readonly<{
  column: Column;
  tasks: readonly TaskSummary[];
  dragDisabled: boolean;
  onAdd: (opener: HTMLButtonElement) => void;
}>) {
  const { setNodeRef } = useDroppable({ id: columnDroppableId(column.id) });
  return (
    <ColumnFrame column={column} tasks={tasks} onAdd={onAdd}>
      <SortableContext
        id={column.id}
        items={tasks.map((task) => task.id)}
        strategy={verticalListSortingStrategy}
      >
        <div ref={setNodeRef} className="min-h-16">
          {tasks.length === 0 ? (
            <NoTasks />
          ) : (
            <ul className="grid gap-2">
              {tasks.map((task) => (
                <SortableCard
                  key={task.id}
                  task={task}
                  disabled={dragDisabled}
                  done={column.category === "done"}
                />
              ))}
            </ul>
          )}
        </div>
      </SortableContext>
    </ColumnFrame>
  );
}
