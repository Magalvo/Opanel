"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

import type { Column } from "@/lib/schemas/columns";
import type { TaskSummary } from "@/lib/schemas/tasks";

import { AddTaskForm } from "./add-task-form";
import type { MoveAction } from "./card-menu";
import { SortableCard, StaticCard } from "./task-card";

export interface BoardColumnProps {
  column: Column;
  columns: readonly Column[];
  cards: readonly TaskSummary[];
  writable: boolean;
  busy: boolean;
  onMove: (card: TaskSummary, action: MoveAction) => void;
  onAdd: (column: Column, title: string) => Promise<boolean>;
}

/** One column: its name and count, its cards in order, and for a writable board its add field. */
export function BoardColumn({
  column,
  columns,
  cards,
  writable,
  busy,
  onMove,
  onAdd,
}: Readonly<BoardColumnProps>) {
  // The column is itself a drop target, so a card can be dropped into an empty one.
  const { setNodeRef } = useDroppable({ id: column.id, data: { columnId: column.id } });

  return (
    <div className="flex w-72 shrink-0 flex-col gap-2 rounded-xl bg-muted/50 p-2">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold">{column.name}</h2>
        <span
          aria-label={`${String(cards.length)} ${cards.length === 1 ? "card" : "cards"}`}
          className="text-xs text-muted-foreground"
        >
          {cards.length}
        </span>
      </div>
      <SortableContext items={cards.map((card) => card.id)} strategy={verticalListSortingStrategy}>
        <ul ref={setNodeRef} aria-label={column.name} className="grid min-h-12 gap-2">
          {cards.map((card, index) =>
            writable ? (
              <SortableCard
                key={card.id}
                card={card}
                columns={columns}
                index={index}
                count={cards.length}
                busy={busy}
                onMove={onMove}
              />
            ) : (
              <StaticCard key={card.id} card={card} />
            ),
          )}
        </ul>
      </SortableContext>
      {writable && <AddTaskForm columnName={column.name} onAdd={(title) => onAdd(column, title)} />}
    </div>
  );
}
