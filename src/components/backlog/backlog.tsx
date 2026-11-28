"use client";

import {
  type Announcements,
  closestCenter,
  DndContext,
  type DragCancelEvent,
  type DragEndEvent,
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
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { PlusIcon } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { measureDroppable } from "@/components/board/measure";
import { NewTaskDialog } from "@/components/board/new-task-dialog";
import { BACKLOG_KEYS, fullIndex } from "@/components/filters/task-filter";
import { TaskFilterBar } from "@/components/filters/task-filter-bar";
import { useTaskFilter } from "@/components/filters/use-task-filter";
import { useUrlTaskFilter } from "@/components/filters/use-url-task-filter";
import { getProject } from "@/components/projects/api";
import { useProjectEventListener } from "@/components/projects/project-events";
import { useProject } from "@/components/projects/project-frame";
import { SprintBacklog } from "@/components/sprints/sprint-backlog";
import { useOpenSprints } from "@/components/sprints/use-open-sprints";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { TaskSummary } from "@/lib/schemas/tasks";

import { OverlayRow, SortableBacklogRow, StaticBacklogRow } from "./backlog-row";
import { useBacklog } from "./use-backlog";

const INSTRUCTIONS =
  "To pick up a task, press Space or Enter. Use the up and down arrow keys to move it. " +
  "Press Space or Enter again to drop it, or Escape to cancel.";

/** Drop targets measured as on the board, rounded to whole layout units (WS-098). */
const MEASURING = {
  droppable: { strategy: MeasuringStrategy.Always, measure: measureDroppable },
};

function count(tasks: number): string {
  return tasks === 1 ? "1 task" : `${String(tasks)} tasks`;
}

/**
 * A project's backlog (WS-109): the tasks that are not on the board, in the team's order.
 * People who may change tasks, on a project that is not archived, reorder them by pointer,
 * touch and keyboard, add tasks to the end, and move a task to the board. In a project with
 * sprints the same tasks are shown in sections, one per sprint (WS-144).
 */
export function Backlog({
  canWriteTasks,
  canManageSprints = false,
}: Readonly<{ canWriteTasks: boolean; canManageSprints?: boolean }>) {
  const dndId = useId();
  const headingId = useId();
  const { project, setProject } = useProject();
  const projectKey = project.key;
  const archived = project.archivedAt !== null;
  const writable = canWriteTasks && !archived;
  const sprintsOn = project.sprintsEnabled;

  const [message, setMessage] = useState("");
  // The "Add task" dialog is open, with the button that gets the focus back.
  const [adding, setAdding] = useState<HTMLButtonElement | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);

  const refreshProject = useCallback(() => {
    getProject(projectKey).then(setProject, () => undefined);
  }, [projectKey, setProject]);

  const backlog = useBacklog({ projectKey, announce: setMessage, onArchived: refreshProject });
  const {
    phase,
    tasks: allTasks,
    moving,
    sending,
    live,
    reload,
    added,
    drop,
    moveToBoard,
    hold,
  } = backlog;
  // A start or a completion changes which tasks are in the backlog (WS-144 section 9).
  const sprints = useOpenSprints({
    projectKey,
    enabled: sprintsOn,
    onActiveChanged: () => void reload(),
  });

  // The filter (WS-120): the backlog shows the tasks the filtered list returns, in its order.
  const { filter, ignored, setFilter } = useUrlTaskFilter(BACKLOG_KEYS);
  const matching = useTaskFilter({ projectKey, place: "backlog", filter });
  const filtered = matching !== "all";
  const tasks = useMemo(() => {
    if (matching === "all") return allTasks;
    const keep = matching === "loading" ? new Set<string>() : matching;
    return allTasks.filter((task) => keep.has(task.id));
  }, [allTasks, matching]);
  const people = useMemo(() => {
    const byId = new Map<string, { id: string; name: string }>();
    for (const task of allTasks) {
      if (task.assignee !== null) byId.set(task.assignee.id, task.assignee);
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [allTasks]);

  // Someone archived or unarchived the project: the frame read it again (WS-049 section 2).
  // Only a change that follows a `project.changed` event is announced (WS-048 section 6).
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
          ? "This project was archived. The backlog is read-only."
          : "This project was unarchived.",
      );
    }
  }

  // Where the focus goes once a move to the board has ended and the rows are enabled again:
  // a row's "Move to board" (`data-move-id`), or "Add task" (section 4).
  const focusAfter = useRef<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  useEffect(() => {
    const target = focusAfter.current;
    if (target === null || moving) return;
    focusAfter.current = null;
    const element =
      target === "add"
        ? addButton.current
        : document.querySelector<HTMLElement>(`[data-move-id="${target}"]`);
    element?.focus();
  }, [focusRequest, moving, tasks]);

  async function sendToBoard(task: TaskSummary) {
    const index = tasks.findIndex((item) => item.id === task.id);
    const next = tasks[index + 1] ?? tasks[index - 1];
    const moved = await moveToBoard(task.id);
    focusAfter.current = moved ? (next?.id ?? "add") : task.id;
    setFocusRequest((request) => request + 1);
  }

  const [activeId, setActiveId] = useState<string | null>(null);
  const lastDrop = useRef("");
  // The place last announced while dragging.
  const lastPlace = useRef("");

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function indexOf(id: UniqueIdentifier): number {
    return tasks.findIndex((task) => task.id === String(id));
  }

  function keyOf(id: UniqueIdentifier): string {
    return tasks[indexOf(id)]?.key ?? "The task";
  }

  function positionText(index: number): string {
    return `position ${String(index + 1)} of ${String(tasks.length)}`;
  }

  /**
   * A keyboard drop leaves the focus on the row's handle, which may have been mounted anew.
   */
  function keepFocus(event: DragEndEvent | DragCancelEvent) {
    if (!(event.activatorEvent instanceof KeyboardEvent)) return;
    const id = String(event.active.id);
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-task-id="${id}"]`)?.focus();
    });
  }

  function onDragStart(event: DragStartEvent) {
    hold(true);
    setActiveId(String(event.active.id));
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const id = String(active.id);
    setActiveId(null);
    keepFocus(event);
    const from = indexOf(id);
    const to = over === null ? -1 : indexOf(over.id);
    if (from === -1 || to === -1 || from === to) {
      lastDrop.current = `${keyOf(id)} was dropped in its place.`;
      hold(false);
      return;
    }
    lastDrop.current = `${keyOf(id)} was moved to ${positionText(to)}.`;
    // The move holds the events itself until it is saved, so it starts before the drag's
    // hold ends and no held event lands between the drop and the move.
    void drop(id, filtered ? fullIndex(allTasks, tasks, id, to) : to);
    hold(false);
  }

  function onDragCancel(event: DragCancelEvent) {
    setActiveId(null);
    keepFocus(event);
    hold(false);
  }

  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      lastPlace.current = positionText(indexOf(active.id));
      return `Picked up ${keyOf(active.id)}.`;
    },
    onDragOver: ({ active, over }) => {
      if (over === null) return `${keyOf(active.id)} is not over the backlog.`;
      const to = indexOf(over.id);
      if (to === -1) return undefined;
      // Only a new place is announced, so "Picked up" is not hidden by the row's own place.
      const place = positionText(to);
      if (place === lastPlace.current) return undefined;
      lastPlace.current = place;
      return `${keyOf(active.id)} is in ${place}.`;
    },
    onDragEnd: () => lastDrop.current,
    onDragCancel: ({ active }) => `Moving ${keyOf(active.id)} was cancelled.`,
  };

  const activeTask = activeId === null ? undefined : tasks[indexOf(activeId)];

  const list =
    tasks.length === 0 ? (
      <p className="px-1 py-2 text-sm text-muted-foreground">
        {filtered ? "No matching tasks" : "The backlog is empty."}
      </p>
    ) : writable ? (
      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        measuring={MEASURING}
        accessibility={{
          announcements,
          screenReaderInstructions: { draggable: INSTRUCTIONS },
        }}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <SortableContext
          items={tasks.map((task) => task.id)}
          strategy={verticalListSortingStrategy}
        >
          <ol className="grid gap-2">
            {tasks.map((task) => (
              <SortableBacklogRow
                key={task.id}
                task={task}
                disabled={moving}
                sending={sending === task.id}
                onMoveToBoard={() => void sendToBoard(task)}
              />
            ))}
          </ol>
        </SortableContext>
        <DragOverlay>
          {activeTask === undefined ? null : <OverlayRow task={activeTask} />}
        </DragOverlay>
      </DndContext>
    ) : (
      <ol className="grid gap-2">
        {tasks.map((task) => (
          <StaticBacklogRow key={task.id} task={task} />
        ))}
      </ol>
    );

  return (
    <div className="grid min-w-0 gap-3">
      {archived && (
        <p className="text-sm text-muted-foreground">
          This project is archived. The backlog is read-only.
        </p>
      )}
      <p role="status" aria-label="Backlog messages" className="min-h-5 text-sm">
        {message}
      </p>
      {live === "paused" && (
        <p role="status" aria-label="Live updates" className="text-sm text-muted-foreground">
          Live updates are paused. Reconnecting…
        </p>
      )}

      {phase === "ready" && (
        <TaskFilterBar
          filter={filter}
          onChange={setFilter}
          people={people}
          projectKey={project.key}
          sprints={project.sprintsEnabled}
          status={`${String(tasks.length)} of ${String(allTasks.length)} tasks match.`}
          ignored={ignored}
        />
      )}

      {phase === "loading" && (
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">Loading the backlog…</p>
          <Skeleton className="h-16 w-full max-w-3xl" />
          <Skeleton className="h-16 w-full max-w-3xl" />
        </div>
      )}

      {phase === "error" && (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-sm text-destructive">
            Could not load the backlog.
          </p>
          <Button variant="outline" size="sm" onClick={() => void reload()}>
            Retry
          </Button>
        </div>
      )}

      {phase === "ready" && sprintsOn && (
        <SprintBacklog
          projectKey={projectKey}
          backlog={backlog}
          tasks={tasks}
          filtered={filtered}
          writable={writable}
          manageable={canManageSprints && !archived}
          sprints={sprints}
          announce={setMessage}
          addButton={addButton}
          onAdd={setAdding}
        />
      )}

      {phase === "ready" && !sprintsOn && (
        <section
          aria-labelledby={headingId}
          className="grid w-full max-w-3xl gap-2 rounded-xl bg-muted/50 p-2"
        >
          <header className="flex flex-wrap items-center gap-2 px-1">
            <h2 id={headingId} className="font-medium">
              Backlog
            </h2>
            <span className="ml-auto text-xs text-muted-foreground">{count(tasks.length)}</span>
          </header>
          {list}
          {writable && (
            <Button
              ref={addButton}
              variant="ghost"
              size="sm"
              className="justify-start"
              onClick={(event) => {
                setAdding(event.currentTarget);
              }}
            >
              <PlusIcon aria-hidden="true" />
              Add task
            </Button>
          )}
        </section>
      )}

      {adding !== null && writable && (
        <NewTaskDialog
          projectKey={projectKey}
          column={null}
          returnFocusTo={adding}
          onOpenChange={(open) => {
            if (!open) setAdding(null);
          }}
          onCreated={(task) => {
            added(task);
            setMessage(`${task.key} was added to the backlog.`);
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
