"use client";

import { EllipsisIcon } from "lucide-react";
import { useRef } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { MenuMove } from "./moves";

/**
 * A card's menu (WS-111 section 1): every move a drag can make, by clicks alone, as
 * WCAG 2.5.7 asks. The first four moves stay in the card's column; the others are the
 * board's other columns.
 */
export function CardMenu({
  taskId,
  taskKey,
  moves,
  disabled,
  onMove,
}: Readonly<{
  taskId: string;
  taskKey: string;
  moves: readonly MenuMove[];
  disabled: boolean;
  onMove: (move: MenuMove) => void;
}>) {
  // Set when a move is chosen: the board then puts the focus on the moved card's menu.
  const chosen = useRef(false);
  const within = moves.slice(0, 4);
  const columns = moves.slice(4);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Actions for ${taskKey}`}
        data-card-menu={taskId}
        // Disabled while a move is saved, as the drag handle is: it keeps the focus, so the
        // keyboard stays on the card that just moved, and opens nothing until the save ends.
        aria-disabled={disabled}
        onPointerDown={(event) => {
          if (disabled) event.preventDefault();
        }}
        onKeyDown={(event) => {
          if (disabled) event.preventDefault();
        }}
        className="-my-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 aria-disabled:cursor-default aria-disabled:opacity-50"
      >
        <EllipsisIcon aria-hidden="true" className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        // A move to another column mounts the card anew; the board puts the focus there.
        // Closed without a move, Radix gives the focus back to this button itself.
        onCloseAutoFocus={(event) => {
          if (chosen.current) event.preventDefault();
          chosen.current = false;
        }}
      >
        {within.map((move) => (
          <DropdownMenuItem
            key={move.label}
            disabled={move.disabled}
            onSelect={() => {
              chosen.current = true;
              onMove(move);
            }}
          >
            {move.label}
          </DropdownMenuItem>
        ))}
        {columns.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Move to</DropdownMenuLabel>
            {columns.map((move) => (
              <DropdownMenuItem
                key={move.columnId}
                onSelect={() => {
                  chosen.current = true;
                  onMove(move);
                }}
              >
                {move.label}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
