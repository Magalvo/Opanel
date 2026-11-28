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

import type { RowMove } from "./sections";

/**
 * A backlog row's "Move to" menu in a project with sprints (WS-144 section 5), built as the
 * board's card menu is (WS-111): every move a drag can make, by clicks alone. The first two
 * stay in the row's section; the others are the other sections and the active sprint.
 */
export function RowMenu({
  taskId,
  taskKey,
  moves,
  disabled,
  onMove,
}: Readonly<{
  taskId: string;
  taskKey: string;
  moves: readonly RowMove[];
  disabled: boolean;
  onMove: (move: RowMove) => void;
}>) {
  // Set when a move is chosen: the page then puts the focus on the moved row's menu.
  const chosen = useRef(false);
  const within = moves.slice(0, 2);
  const others = moves.slice(2);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Actions for ${taskKey}`}
        data-row-menu={taskId}
        // Disabled while a move is saved, as the drag handle is.
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
        {others.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Move to</DropdownMenuLabel>
            {others.map((move) => (
              <DropdownMenuItem
                key={move.sectionId ?? "active"}
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
