"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Column } from "@/lib/schemas/columns";
import type { TaskSummary } from "@/lib/schemas/tasks";

import { CardMenu, type MoveAction } from "./card-menu";

const TYPE_LABELS = { bug: "Bug", story: "Story" } as const;

/** What a card shows: key, title, type, assignee, team and epic (WS-037). The title opens the task (WS-038). */
export function CardBody({ card }: Readonly<{ card: TaskSummary }>) {
  return (
    <div className="grid min-w-0 flex-1 gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-xs text-muted-foreground">{card.key}</span>
        {card.type !== "task" && <Badge variant="outline">{TYPE_LABELS[card.type]}</Badge>}
      </div>
      <p className="text-sm font-medium break-words">
        <Link
          href={`/projects/${card.key.slice(0, card.key.lastIndexOf("-"))}/tasks/${card.key}`}
          className="underline-offset-4 hover:underline"
        >
          {card.title}
        </Link>
      </p>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {card.assignee !== null && (
          <span className="flex items-center gap-1">
            <span>{card.assignee.name}</span>
            {!card.assignee.active && <Badge variant="default">Deactivated</Badge>}
          </span>
        )}
        {card.assigneeTeam !== null && <Badge variant="secondary">{card.assigneeTeam.name}</Badge>}
        {card.epic !== null && <Badge variant="outline">{card.epic.title}</Badge>}
      </div>
    </div>
  );
}

const CARD_CLASS = "flex items-start gap-1 rounded-lg border bg-card p-2 text-card-foreground";

/** A card on a board nobody can change: no handle, no menu. */
export function StaticCard({ card }: Readonly<{ card: TaskSummary }>) {
  return (
    <li className={CARD_CLASS}>
      <CardBody card={card} />
    </li>
  );
}

export interface SortableCardProps {
  card: TaskSummary;
  columns: readonly Column[];
  /** The card's place in its column, counted from 0, and the size of the column. */
  index: number;
  count: number;
  busy: boolean;
  onMove: (card: TaskSummary, action: MoveAction) => void;
}

/** A card that can be dragged by its handle, or moved from its menu. */
export function SortableCard({
  card,
  columns,
  index,
  count,
  busy,
  onMove,
}: Readonly<SortableCardProps>) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id, data: { columnId: card.columnId }, disabled: busy });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`${CARD_CLASS} ${isDragging ? "opacity-40" : ""}`}
    >
      <Button
        ref={setActivatorNodeRef}
        variant="ghost"
        size="icon-sm"
        className="cursor-grab touch-none"
        aria-label={`Drag ${card.key}`}
        {...attributes}
        {...listeners}
      >
        <GripVerticalIcon aria-hidden="true" />
      </Button>
      <CardBody card={card} />
      <CardMenu
        card={card}
        columns={columns}
        index={index}
        count={count}
        disabled={busy}
        onMove={onMove}
      />
    </li>
  );
}
