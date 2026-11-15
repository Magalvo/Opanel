"use client";

import { MoreHorizontalIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Column } from "@/lib/schemas/columns";
import type { TaskSummary } from "@/lib/schemas/tasks";

/** What a card's menu can ask for: a column to move to (at its end), or one place up or down. */
export type MoveAction = { kind: "column"; columnId: string } | { kind: "up" } | { kind: "down" };

export interface CardMenuProps {
  card: TaskSummary;
  columns: readonly Column[];
  index: number;
  count: number;
  disabled: boolean;
  onMove: (card: TaskSummary, action: MoveAction) => void;
}

/** The way to move a card without dragging it (WS-037, question 1). */
export function CardMenu({
  card,
  columns,
  index,
  count,
  disabled,
  onMove,
}: Readonly<CardMenuProps>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label={`Actions for ${card.key}`}
        >
          <MoreHorizontalIcon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {columns
          .filter((column) => column.id !== card.columnId)
          .map((column) => (
            <DropdownMenuItem
              key={column.id}
              onSelect={() => {
                onMove(card, { kind: "column", columnId: column.id });
              }}
            >
              Move to {column.name}
            </DropdownMenuItem>
          ))}
        {index > 0 && (
          <DropdownMenuItem
            onSelect={() => {
              onMove(card, { kind: "up" });
            }}
          >
            Move up
          </DropdownMenuItem>
        )}
        {index < count - 1 && (
          <DropdownMenuItem
            onSelect={() => {
              onMove(card, { kind: "down" });
            }}
          >
            Move down
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
