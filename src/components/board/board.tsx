"use client";

import {
  type Announcements,
  closestCorners,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Column } from "@/lib/schemas/columns";
import type { Project } from "@/lib/schemas/projects";
import { taskSchema, type TaskSummary, taskTitleSchema } from "@/lib/schemas/tasks";

import { ApiFailure, createTask, listAllTasks, listColumns, moveTask } from "./api";
import { BoardColumn } from "./board-column";
import { anchorsFor, type BoardState, groupTasks, locate, moveCard } from "./board-state";
import type { MoveAction } from "./card-menu";
import { CardBody } from "./task-card";

type Phase = "loading" | "error" | "ready";

const ARCHIVED = "The project is archived, so the board is read-only.";

const SCREEN_READER_INSTRUCTIONS =
  "To pick up a task, press space or enter on its drag handle. Use the arrow keys to move it, " +
  "space or enter to drop it, and escape to cancel.";

function summaryOf(task: TaskSummary & { description?: string }): TaskSummary {
  const { description: _description, ...summary } = task;
  return summary;
}

export interface BoardProps {
  project: Project;
  canWrite: boolean;
  archived: boolean;
}

/**
 * The project's board (WS-037): its columns and every task, with a field to add a task to a
 * column and, for someone who can write, drag and drop, a keyboard alternative and a menu on
 * each card. It is a client of the columns, tasks and move endpoints, and keeps one move in
 * flight at a time so each request starts from the version the last answer returned.
 */
export function Board({ project, canWrite, archived }: Readonly<BoardProps>) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [board, setBoard] = useState<BoardState | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [archivedNow, setArchivedNow] = useState(false);
  // The board as it was when a drag began, to put the card back if the drag is cancelled.
  const dragStart = useRef<BoardState | null>(null);

  const readOnly = !canWrite || archived || archivedNow;

  /** The columns and every task, as a board. Throws if either cannot be read. */
  const fetchBoard = useCallback(async () => {
    const [columns, tasks] = await Promise.all([listColumns(project.id), listAllTasks(project.id)]);
    return groupTasks(columns.items, tasks);
  }, [project.id]);

  useEffect(() => {
    let cancelled = false;
    fetchBoard().then(
      (loaded) => {
        if (cancelled) return;
        setBoard(loaded);
        setPhase("ready");
      },
      () => {
        if (!cancelled) setPhase("error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fetchBoard]);

  async function load() {
    try {
      setBoard(await fetchBoard());
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }

  // The task detail, in a dialog over this board, tells it what changed (WS-038 section 4).
  useEffect(() => {
    function updated(event: Event) {
      const task = taskSchema.safeParse((event as CustomEvent<unknown>).detail);
      if (!task.success || task.data.projectId !== project.id) return;
      const summary = summaryOf(task.data);
      setBoard((current) => {
        if (current === null) return current;
        const stays = (current.cards[summary.columnId] ?? []).some(
          (card) => card.id === summary.id,
        );
        const cards = Object.fromEntries(
          Object.entries(current.cards).map(([columnId, list]) => [
            columnId,
            stays && columnId === summary.columnId
              ? list.map((card) => (card.id === summary.id ? summary : card))
              : list.filter((card) => card.id !== summary.id),
          ]),
        );
        if (!stays && cards[summary.columnId] !== undefined) {
          cards[summary.columnId] = [...(cards[summary.columnId] ?? []), summary];
        }
        return { columns: current.columns, cards };
      });
    }
    function deleted(event: Event) {
      const id = (event as CustomEvent<unknown>).detail;
      if (typeof id !== "string") return;
      setBoard((current) =>
        current === null
          ? current
          : {
              columns: current.columns,
              cards: Object.fromEntries(
                Object.entries(current.cards).map(([columnId, list]) => [
                  columnId,
                  list.filter((card) => card.id !== id),
                ]),
              ),
            },
      );
    }
    window.addEventListener("opanel:task-updated", updated);
    window.addEventListener("opanel:task-deleted", deleted);
    return () => {
      window.removeEventListener("opanel:task-updated", updated);
      window.removeEventListener("opanel:task-deleted", deleted);
    };
  }, [project.id]);

  function reload() {
    setPhase("loading");
    void load();
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /** Tells the server where `taskId` now is in `next`; on a failure shows `previous` again. */
  async function persist(previous: BoardState, next: BoardState, taskId: string) {
    const place = locate(next, taskId);
    const card = place === undefined ? undefined : next.cards[place.columnId]?.[place.index];
    if (place === undefined || card === undefined) return;
    const column = next.columns.find((other) => other.id === place.columnId);
    const before = locate(previous, taskId);

    setBoard(next);
    setBusy(true);
    try {
      const moved = summaryOf(
        await moveTask(card.key, {
          columnId: place.columnId,
          ...anchorsFor(next, taskId),
          version: card.version,
        }),
      );
      setBoard((current) =>
        current === null
          ? current
          : {
              columns: current.columns,
              cards: Object.fromEntries(
                Object.entries(current.cards).map(([columnId, list]) => [
                  columnId,
                  list.map((other) => (other.id === moved.id ? moved : other)),
                ]),
              ),
            },
      );
      setMessage(
        before?.columnId === place.columnId
          ? `Moved ${card.key}.`
          : `Moved ${card.key} to ${column?.name ?? "another column"}.`,
      );
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === "version_conflict") {
        setMessage("Someone else changed the board. It was reloaded.");
        await load();
      } else if (failure instanceof ApiFailure && failure.code === "project_archived") {
        setArchivedNow(true);
        setBoard(previous);
        setMessage(ARCHIVED);
      } else {
        setBoard(previous);
        setMessage("Could not move the task. It is back where it was.");
      }
    } finally {
      setBusy(false);
    }
  }

  function moveFromMenu(card: TaskSummary, action: MoveAction) {
    if (board === null || busy) return;
    const place = locate(board, card.id);
    if (place === undefined) return;
    const next =
      action.kind === "column"
        ? moveCard(board, card.id, action.columnId, board.cards[action.columnId]?.length ?? 0)
        : moveCard(board, card.id, place.columnId, place.index + (action.kind === "up" ? -1 : 1));
    if (next !== board) void persist(board, next, card.id);
  }

  async function addTask(column: Column, text: string): Promise<boolean> {
    const title = taskTitleSchema.safeParse(text);
    if (!title.success) {
      setMessage("Enter a title.");
      return false;
    }
    try {
      const created = await createTask(project.id, { title: title.data, columnId: column.id });
      setBoard((current) =>
        current === null
          ? current
          : {
              columns: current.columns,
              cards: {
                ...current.cards,
                [column.id]: [...(current.cards[column.id] ?? []), summaryOf(created)],
              },
            },
      );
      setMessage(`Added ${created.key}.`);
      return true;
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === "project_archived") {
        setArchivedNow(true);
        setMessage(ARCHIVED);
      } else {
        setMessage("Could not add the task. Try again.");
      }
      return false;
    }
  }

  // ---- Dragging -------------------------------------------------------------------------

  /** The column a droppable belongs to: a column itself, or the column of a card. */
  function columnOf(state: BoardState, id: string): string | undefined {
    return state.cards[id] === undefined ? locate(state, id)?.columnId : id;
  }

  function dragStarted(event: DragStartEvent) {
    dragStart.current = board;
    setActiveId(String(event.active.id));
  }

  /** While a card is over another column it is shown there, as the multiple-containers pattern does. */
  function dragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (over === null) return;
    setBoard((current) => {
      if (current === null) return current;
      const from = locate(current, String(active.id));
      const toColumn = columnOf(current, String(over.id));
      if (from === undefined || toColumn === undefined || from.columnId === toColumn) {
        return current;
      }
      const overIndex = locate(current, String(over.id))?.index;
      const target = current.cards[toColumn] ?? [];
      return moveCard(current, String(active.id), toColumn, overIndex ?? target.length);
    });
  }

  function dragEnded(event: DragEndEvent) {
    const { active, over } = event;
    const start = dragStart.current;
    dragStart.current = null;
    setActiveId(null);
    if (start === null || board === null) return;

    let next = board;
    if (over !== null) {
      const toColumn = columnOf(next, String(over.id));
      const overIndex = locate(next, String(over.id))?.index;
      if (toColumn !== undefined) {
        next = moveCard(
          next,
          String(active.id),
          toColumn,
          overIndex ?? next.cards[toColumn]?.length ?? 0,
        );
      }
    }
    const from = locate(start, String(active.id));
    const to = locate(next, String(active.id));
    if (from?.columnId === to?.columnId && from?.index === to?.index) {
      setBoard(start);
      return;
    }
    void persist(start, next, String(active.id));
  }

  function dragCancelled() {
    setActiveId(null);
    if (dragStart.current !== null) setBoard(dragStart.current);
    dragStart.current = null;
  }

  const announcements: Announcements = {
    onDragStart({ active }) {
      return board === null ? undefined : `Picked up ${describe(board, String(active.id))}`;
    },
    onDragOver({ active, over }) {
      // Over itself is where the drag began: keep the "Picked up" announcement.
      if (board === null || over === null || over.id === active.id) return undefined;
      const column = columnOf(board, String(over.id));
      const name = board.columns.find((other) => other.id === column)?.name;
      return name === undefined
        ? undefined
        : `${cardKey(board, String(active.id))} is over ${name}.`;
    },
    onDragEnd({ active }) {
      return board === null ? undefined : `Dropped ${describe(board, String(active.id))}`;
    },
    onDragCancel({ active }) {
      return board === null
        ? undefined
        : `Move cancelled. ${cardKey(board, String(active.id))} is back where it was.`;
    },
  };

  const activeCard =
    board === null || activeId === null
      ? undefined
      : Object.values(board.cards)
          .flat()
          .find((card) => card.id === activeId);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="status"
          aria-label="Board messages"
          className="min-h-5 text-sm text-muted-foreground"
        >
          {message}
        </div>
        <Button variant="outline" size="sm" onClick={reload}>
          Reload
        </Button>
      </div>

      {archived && (
        <p className="text-sm text-muted-foreground">
          This project is archived, so the board is read-only.
        </p>
      )}

      {phase === "loading" && (
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">Loading the board…</p>
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {phase === "error" && (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-sm text-destructive">
            Could not load the board.
          </p>
          <Button variant="outline" size="sm" onClick={reload}>
            Retry
          </Button>
        </div>
      )}

      {phase === "ready" && board !== null && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={dragStarted}
          onDragOver={dragOver}
          onDragEnd={dragEnded}
          onDragCancel={dragCancelled}
          accessibility={{
            announcements,
            screenReaderInstructions: { draggable: SCREEN_READER_INSTRUCTIONS },
          }}
        >
          <div
            role="region"
            aria-label="Board"
            tabIndex={0}
            className="flex items-start gap-3 overflow-x-auto pb-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {board.columns.map((column) => (
              <BoardColumn
                key={column.id}
                column={column}
                columns={board.columns}
                cards={board.cards[column.id] ?? []}
                writable={!readOnly}
                busy={busy}
                onMove={moveFromMenu}
                onAdd={addTask}
              />
            ))}
          </div>
          <DragOverlay>
            {activeCard === undefined ? null : (
              <div className="flex rounded-lg border bg-card p-2 shadow-lg">
                <CardBody card={activeCard} />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

function cardKey(state: BoardState, taskId: string): string {
  const place = locate(state, taskId);
  return place === undefined
    ? "The task"
    : (state.cards[place.columnId]?.[place.index]?.key ?? "The task");
}

/** "OPA-3. It is in To do, position 2 of 4." */
function describe(state: BoardState, taskId: string): string {
  const place = locate(state, taskId);
  if (place === undefined) return "the task.";
  const column = state.columns.find((other) => other.id === place.columnId);
  const count = state.cards[place.columnId]?.length ?? 0;
  return `${cardKey(state, taskId)}. It is in ${column?.name ?? "a column"}, position ${String(place.index + 1)} of ${String(count)}.`;
}
