"use client";

import {
  type Announcements,
  type CollisionDetection,
  DndContext,
  type DragCancelEvent,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useCallback, useId, useRef, useState } from "react";

import { getProject } from "@/components/projects/api";
import { useProjectEventListener } from "@/components/projects/project-events";
import { useProject } from "@/components/projects/project-frame";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Column } from "@/lib/schemas/columns";

import { SortableColumn, StaticColumn } from "./board-column";
import { boardCollision } from "./collision";
import { measureDroppable } from "./measure";
import { applyDrop, type Board as BoardState, placeOf, targetOf } from "./moves";
import { NewTaskDialog } from "./new-task-dialog";
import { OverlayCard } from "./task-card";
import { useBoard } from "./use-board";

const INSTRUCTIONS =
  "To pick up a card, press Space or Enter. Use the arrow keys to move it within and " +
  "across columns. Press Space or Enter again to drop it, or Escape to cancel.";

/**
 * Drop targets are measured on every render while dragging, and rounded to whole layout
 * units so that one measured mid-slide does not misdirect the next arrow key (WS-098).
 */
const MEASURING = {
  droppable: { strategy: MeasuringStrategy.Always, measure: measureDroppable },
};

/** Where a drop leaves a card, from the board as shown while dragging. */
function dropResult(shown: BoardState, activeId: string, overId: string): BoardState | null {
  const to = targetOf(shown, overId);
  if (to === null) return null;
  return applyDrop(shown, activeId, to.columnId, to.index);
}

/**
 * A project's kanban board (WS-037): columns in board order with their cards, "Add task"
 * per column, and drag and drop by pointer, touch and keyboard for people who may change
 * tasks while the project is not archived.
 */
export function Board({ canWriteTasks }: Readonly<{ canWriteTasks: boolean }>) {
  const dndId = useId();
  const { project, setProject } = useProject();
  const projectKey = project.key;
  const archived = project.archivedAt !== null;
  const writable = canWriteTasks && !archived;

  const [message, setMessage] = useState("");
  // The column a task is being added to, and the "Add task" button that gets the focus back.
  const [adding, setAdding] = useState<{ column: Column; opener: HTMLButtonElement } | null>(null);

  const refreshProject = useCallback(() => {
    getProject(projectKey).then(setProject, () => undefined);
  }, [projectKey, setProject]);

  const { phase, columns, board, moving, live, reload, added, drop, hold } = useBoard({
    projectKey,
    announce: setMessage,
    onArchived: refreshProject,
  });

  // Someone archived or unarchived the project: the frame read it again (WS-049 section 2).
  // Only a change that follows a `project.changed` event is announced, since it changes what
  // the viewer may do (WS-048 section 6).
  const [remoteVersion, setRemoteVersion] = useState(0);
  useProjectEventListener({
    onEvent: (event) => {
      if (event.type === "project.changed") setRemoteVersion(event.version);
    },
  });
  const [shownArchived, setShownArchived] = useState(archived);
  if (shownArchived !== archived) {
    setShownArchived(archived);
    if (remoteVersion > 0 && project.version >= remoteVersion) {
      setMessage(
        archived
          ? "This project was archived. The board is read-only."
          : "This project was unarchived.",
      );
    }
  }

  // While a card is dragged the board is shown from `preview`, which follows the card
  // across columns; `drop` saves the result once it is released.
  const [preview, setPreviewState] = useState<BoardState | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const previewRef = useRef<BoardState | null>(null);
  const lastDrop = useRef<string>("");
  // The place last announced while dragging.
  const lastPlace = useRef<string>("");
  const shown = preview ?? board;

  function setPreview(next: BoardState | null) {
    previewRef.current = next;
    setPreviewState(next);
  }

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function columnName(columnId: string): string {
    return columns.find((column) => column.id === columnId)?.name ?? "a column";
  }

  function keyOf(id: UniqueIdentifier): string {
    const current = previewRef.current ?? board;
    const place = placeOf(current, String(id));
    return place === null
      ? "The card"
      : (current[place.columnId]?.[place.index]?.key ?? "The card");
  }

  function positionText(current: BoardState, id: string): string {
    const place = placeOf(current, id);
    if (place === null) return "";
    const total = current[place.columnId]?.length ?? 0;
    return `${columnName(place.columnId)}, position ${String(place.index + 1)} of ${String(total)}`;
  }

  const collisionDetection: CollisionDetection = (args) =>
    boardCollision(
      args,
      (taskId) => placeOf(previewRef.current ?? board, taskId)?.columnId ?? null,
    );

  function onDragStart(event: DragStartEvent) {
    hold(true);
    setActiveId(String(event.active.id));
    setPreview(board);
  }

  function onDragOver({ active, over }: DragOverEvent) {
    const current = previewRef.current;
    if (current === null || over === null) return;
    const from = placeOf(current, String(active.id));
    const to = targetOf(current, String(over.id));
    // Within its own column the sortable list shows the new place by itself.
    if (from === null || to === null || from.columnId === to.columnId) return;
    setPreview(applyDrop(current, String(active.id), to.columnId, to.index));
  }

  /**
   * A keyboard drag can carry a card into another column, which mounts it anew; the
   * keyboard is given back to it once it is shown in its new place.
   */
  function keepFocus(event: DragEndEvent | DragCancelEvent) {
    if (!(event.activatorEvent instanceof KeyboardEvent)) return;
    const id = String(event.active.id);
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-task-id="${id}"]`)?.focus();
    });
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const current = previewRef.current ?? board;
    const id = String(active.id);
    setPreview(null);
    setActiveId(null);
    keepFocus(event);
    const result = over === null ? null : dropResult(current, id, String(over.id));
    const place = result === null ? null : placeOf(result, id);
    const was = placeOf(board, id);
    if (
      result === null ||
      place === null ||
      (was !== null && was.columnId === place.columnId && was.index === place.index)
    ) {
      lastDrop.current = `${keyOf(id)} was dropped in its place.`;
      hold(false);
      return;
    }
    lastDrop.current = `${result[place.columnId]?.[place.index]?.key ?? "The card"} was moved to ${positionText(result, id)}.`;
    // The move holds the events itself until it is saved, so it starts before the drag's
    // hold ends and no held event lands between the drop and the move.
    void drop(id, place.columnId, place.index);
    hold(false);
  }

  function onDragCancel(event: DragCancelEvent) {
    setPreview(null);
    setActiveId(null);
    keepFocus(event);
    hold(false);
  }

  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      lastPlace.current = positionText(board, String(active.id));
      return `Picked up ${keyOf(active.id)}.`;
    },
    onDragOver: ({ active, over }) => {
      const current = previewRef.current ?? board;
      if (over === null) return `${keyOf(active.id)} is not over a column.`;
      const result = dropResult(current, String(active.id), String(over.id));
      if (result === null) return undefined;
      // Only a new place is announced, so "Picked up" is not hidden by the card's own place.
      const place = positionText(result, String(active.id));
      if (place === lastPlace.current) return undefined;
      lastPlace.current = place;
      return `${keyOf(active.id)} is in ${place}.`;
    },
    onDragEnd: () => lastDrop.current,
    onDragCancel: ({ active }) => `Moving ${keyOf(active.id)} was cancelled.`,
  };

  const activePlace = activeId === null ? null : placeOf(shown, activeId);
  const activeTask =
    activePlace === null ? undefined : shown[activePlace.columnId]?.[activePlace.index];
  // The dragged card's look follows the column it is over: never overdue in a done one.
  const activeDone =
    columns.find((column) => column.id === activePlace?.columnId)?.category === "done";

  return (
    <div className="grid min-w-0 gap-3">
      {archived && (
        <p className="text-sm text-muted-foreground">
          This project is archived. The board is read-only.
        </p>
      )}
      <p role="status" aria-label="Board messages" className="min-h-5 text-sm">
        {message}
      </p>
      {live === "paused" && (
        <p role="status" aria-label="Live updates" className="text-sm text-muted-foreground">
          Live updates are paused. Reconnecting…
        </p>
      )}

      {phase === "loading" && (
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">Loading the board…</p>
          <div className="flex gap-3 overflow-hidden">
            <Skeleton className="h-40 w-72" />
            <Skeleton className="h-40 w-72" />
            <Skeleton className="h-40 w-72" />
          </div>
        </div>
      )}

      {phase === "error" && (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-sm text-destructive">
            Could not load the board.
          </p>
          <Button variant="outline" size="sm" onClick={() => void reload()}>
            Retry
          </Button>
        </div>
      )}

      {phase === "ready" && (
        <div
          role="region"
          aria-label="Board"
          tabIndex={0}
          className="flex min-w-0 items-start gap-3 overflow-x-auto rounded-lg pb-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {writable ? (
            <DndContext
              id={dndId}
              sensors={sensors}
              collisionDetection={collisionDetection}
              measuring={MEASURING}
              accessibility={{
                announcements,
                screenReaderInstructions: { draggable: INSTRUCTIONS },
              }}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragEnd={onDragEnd}
              onDragCancel={onDragCancel}
            >
              {columns.map((column) => (
                <SortableColumn
                  key={column.id}
                  column={column}
                  tasks={shown[column.id] ?? []}
                  dragDisabled={moving}
                  onAdd={(opener) => {
                    setAdding({ column, opener });
                  }}
                />
              ))}
              <DragOverlay>
                {activeTask === undefined ? null : (
                  <OverlayCard task={activeTask} done={activeDone} />
                )}
              </DragOverlay>
            </DndContext>
          ) : (
            columns.map((column) => (
              <StaticColumn key={column.id} column={column} tasks={shown[column.id] ?? []} />
            ))
          )}
        </div>
      )}

      {adding !== null && writable && (
        <NewTaskDialog
          projectKey={projectKey}
          column={adding.column}
          returnFocusTo={adding.opener}
          onOpenChange={(open) => {
            if (!open) setAdding(null);
          }}
          onCreated={(task) => {
            added(task);
            setMessage(`${task.key} was added to ${adding.column.name}.`);
          }}
          onArchived={() => {
            setMessage("The project is archived.");
            refreshProject();
          }}
        />
      )}
    </div>
  );
}
