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
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { EllipsisIcon, PlayIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { type ReactNode, type RefObject, useId, useMemo, useRef, useState } from "react";

import { OverlayRow, SortableBacklogRow, StaticBacklogRow } from "@/components/backlog/backlog-row";
import type { useBacklog } from "@/components/backlog/use-backlog";
import { boardCollision } from "@/components/board/collision";
import { measureDroppable } from "@/components/board/measure";
import { placeOf } from "@/components/board/moves";
import { fullIndex } from "@/components/filters/task-filter";
import { formatPoints } from "@/components/task/task-meta";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiFailure } from "@/lib/api-client";
import type { Sprint } from "@/lib/schemas/sprints";
import type { TaskSummary } from "@/lib/schemas/tasks";

import { deleteSprint, startSprint } from "./api";
import { CompletedSprints } from "./completed-sprints";
import { SPRINT_ACTIVE, SPRINT_NOT_PLANNED } from "./messages";
import { RowMenu } from "./row-menu";
import {
  dropInSection,
  dropRefusal,
  groupSections,
  positionText as sectionPositionText,
  type RowMove,
  rowMoves,
  sectionDroppableId,
  sectionMove,
  type Sections,
  sectionTarget,
  UNSCHEDULED,
} from "./sections";
import { SprintDialog } from "./sprint-dialog";
import { SprintDates, SprintGoal, SprintHeader } from "./sprint-header";
import { DeleteSprintDialog, StartSprintDialog } from "./start-sprint-dialog";
import type { useOpenSprints } from "./use-open-sprints";

const INSTRUCTIONS =
  "To pick up a task, press Space or Enter. Use the up and down arrow keys to move it, " +
  "within its section and into the sections above and below. Press Space or Enter again " +
  "to drop it, or Escape to cancel.";

/** Drop targets measured as on the board, rounded to whole layout units (WS-098). */
const MEASURING = {
  droppable: { strategy: MeasuringStrategy.Always, measure: measureDroppable },
};

function count(tasks: number): string {
  return tasks === 1 ? "1 task" : `${String(tasks)} tasks`;
}

function points(tasks: readonly TaskSummary[]): string {
  const sum = tasks.reduce((total, task) => total + (task.storyPoints ?? 0), 0);
  return sum === 1 ? "1 point" : `${formatPoints(sum)} points`;
}

function startFailure(failure: unknown, name: string): string {
  const code = failure instanceof ApiFailure ? failure.code : null;
  if (code === "sprint_active") return SPRINT_ACTIVE;
  if (code === "sprint_not_planned") return SPRINT_NOT_PLANNED;
  if (code === "version_conflict")
    return `Someone else changed ${name}. The backlog was refreshed.`;
  if (code === "project_archived") return "The project is archived.";
  if (code === "sprints_disabled") return "This project does not use sprints.";
  if (failure instanceof ApiFailure && failure.status === 404) return `${name} was deleted.`;
  return `Could not start ${name}. Try again.`;
}

function deleteFailure(failure: unknown, name: string): string {
  const code = failure instanceof ApiFailure ? failure.code : null;
  if (code === "sprint_not_planned") return SPRINT_NOT_PLANNED;
  if (code === "project_archived") return "The project is archived.";
  if (failure instanceof ApiFailure && failure.status === 404) return `${name} was deleted.`;
  return `Could not delete ${name}. Try again.`;
}

/** An open dialog, with the element that gets the focus back when it closes. */
type Dialog =
  | { kind: "create"; opener: HTMLElement | null }
  | { kind: "edit" | "start" | "delete"; sprint: Sprint; opener: HTMLElement | null };

/** A planned sprint's menu: "Edit" and "Delete", for a Manager. */
function SprintMenu({
  sprint,
  onEdit,
  onDelete,
}: Readonly<{
  sprint: Sprint;
  onEdit: (opener: HTMLElement | null) => void;
  onDelete: (opener: HTMLElement | null) => void;
}>) {
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        ref={trigger}
        aria-label={`Actions for ${sprint.name}`}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <EllipsisIcon aria-hidden="true" className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={() => {
            onEdit(trigger.current);
          }}
        >
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => {
            onDelete(trigger.current);
          }}
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A section of the backlog: its header, then its rows or why it has none. */
function Section({
  heading,
  header,
  footer = null,
  children,
}: Readonly<{
  heading: string;
  header: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}>) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="grid w-full max-w-3xl gap-2 rounded-xl bg-muted/50 p-2"
    >
      <header className="grid gap-1 px-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={id} className="min-w-0 font-medium break-words">
            {heading}
          </h2>
          {header}
        </div>
      </header>
      {children}
      {footer}
    </section>
  );
}

/** The rows of a section, which accepts rows even when empty. */
function DroppableRows({
  sectionId,
  tasks,
  empty,
  children,
}: Readonly<{
  sectionId: string;
  tasks: readonly TaskSummary[];
  empty: string;
  children: ReactNode;
}>) {
  const { setNodeRef } = useDroppable({ id: sectionDroppableId(sectionId) });
  return (
    <SortableContext
      id={sectionId}
      items={tasks.map((task) => task.id)}
      strategy={verticalListSortingStrategy}
    >
      <div ref={setNodeRef} className="min-h-12">
        {tasks.length === 0 ? (
          <p className="px-1 py-2 text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ol className="grid gap-2">{children}</ol>
        )}
      </div>
    </SortableContext>
  );
}

/**
 * The backlog of a project with sprints (WS-144 sections 4 to 6): the active sprint's
 * summary, a section per planned sprint, the unscheduled tasks, then the completed sprints.
 * Tasks move between sections by pointer, touch and keyboard, and with each row's "Move to"
 * menu, each move one request; a Manager creates, edits, deletes and starts sprints here.
 */
export function SprintBacklog({
  projectKey,
  backlog,
  tasks,
  filtered,
  writable,
  manageable,
  sprints,
  announce,
  addButton,
  onAdd,
}: Readonly<{
  projectKey: string;
  backlog: ReturnType<typeof useBacklog>;
  /** The tasks the filter keeps, in backlog order. */
  tasks: readonly TaskSummary[];
  filtered: boolean;
  /** Whether tasks may be moved: `tasks:write` on a project that is not archived. */
  writable: boolean;
  /** Whether sprints may be managed: `sprints:manage` on a project that is not archived. */
  manageable: boolean;
  sprints: ReturnType<typeof useOpenSprints>;
  announce: (message: string) => void;
  addButton: RefObject<HTMLButtonElement | null>;
  onAdd: (opener: HTMLButtonElement) => void;
}>) {
  const dndId = useId();
  const { tasks: allTasks, columns, moving, sending, hold, place, moveToBoard, reload } = backlog;
  const { planned, active } = sprints;

  const full = useMemo(() => groupSections(allTasks, planned), [allTasks, planned]);
  const visible = useMemo(() => groupSections(tasks, planned), [tasks, planned]);

  const [dialog, setDialog] = useState<Dialog | null>(null);
  // A sprint was just started here: the page offers the way to the board.
  const [started, setStarted] = useState(false);

  // While a row is dragged the sections are shown from `preview`, which follows it across
  // sections, as the board does (WS-037 section 5).
  const [preview, setPreviewState] = useState<Sections | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const previewRef = useRef<Sections | null>(null);
  const lastDrop = useRef("");
  const lastPlace = useRef("");
  const shown = preview ?? visible;

  function setPreview(next: Sections | null) {
    previewRef.current = next;
    setPreviewState(next);
  }

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function taskOf(id: UniqueIdentifier): TaskSummary | undefined {
    return allTasks.find((task) => task.id === String(id));
  }

  function keyOf(id: UniqueIdentifier): string {
    return taskOf(id)?.key ?? "The task";
  }

  /** Saves a move to `index` of a section, as shown; the filter's hidden rows stay put. */
  async function moveTo(taskId: string, sectionId: string, index: number) {
    const at = filtered
      ? fullIndex(full[sectionId] ?? [], visible[sectionId] ?? [], taskId, index)
      : index;
    const move = sectionMove(allTasks, planned, taskId, sectionId, at);
    if (move === null) return;
    await place(taskId, move.after, move.request);
  }

  const collisionDetection: CollisionDetection = (args) =>
    boardCollision(
      args,
      (taskId) => placeOf(previewRef.current ?? visible, taskId)?.columnId ?? null,
    );

  function keepFocus(event: DragEndEvent | DragCancelEvent) {
    if (!(event.activatorEvent instanceof KeyboardEvent)) return;
    const id = String(event.active.id);
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-task-id="${id}"]`)?.focus();
    });
  }

  /** Why a drop of `id` over `overId` is refused, from the sections as shown. */
  function refusal(current: Sections, id: string, overId: string): string | null {
    const task = taskOf(id);
    const from = placeOf(visible, id);
    const to = sectionTarget(current, overId);
    if (task === undefined || from === null || to === null) return null;
    return dropRefusal(task, from.columnId, to.columnId);
  }

  function onDragStart(event: DragStartEvent) {
    hold(true);
    setActiveId(String(event.active.id));
    setPreview(visible);
  }

  function onDragOver({ active: dragged, over }: DragOverEvent) {
    const current = previewRef.current;
    if (current === null || over === null) return;
    const id = String(dragged.id);
    const from = placeOf(current, id);
    const to = sectionTarget(current, String(over.id));
    if (from === null || to === null || from.columnId === to.columnId) return;
    if (refusal(current, id, String(over.id)) !== null) return;
    setPreview(dropInSection(current, planned, id, to.columnId, to.index));
  }

  function onDragEnd(event: DragEndEvent) {
    const { active: dragged, over } = event;
    const current = previewRef.current ?? visible;
    const id = String(dragged.id);
    setPreview(null);
    setActiveId(null);
    keepFocus(event);
    const refused = over === null ? null : refusal(current, id, String(over.id));
    if (refused !== null) {
      lastDrop.current = refused;
      announce(refused);
      hold(false);
      return;
    }
    const to = over === null ? null : sectionTarget(current, String(over.id));
    const result = to === null ? null : dropInSection(current, planned, id, to.columnId, to.index);
    const at = result === null ? null : placeOf(result, id);
    const was = placeOf(visible, id);
    if (
      result === null ||
      at === null ||
      (was !== null && was.columnId === at.columnId && was.index === at.index)
    ) {
      lastDrop.current = `${keyOf(id)} was dropped in its place.`;
      hold(false);
      return;
    }
    lastDrop.current = `${keyOf(id)} was moved to ${sectionPositionText(result, planned, id)}.`;
    // The move holds the events itself until it is saved, so it starts before the drag's
    // hold ends and no held event lands between the drop and the move.
    void moveTo(id, at.columnId, at.index);
    hold(false);
  }

  function onDragCancel(event: DragCancelEvent) {
    setPreview(null);
    setActiveId(null);
    keepFocus(event);
    hold(false);
  }

  const announcements: Announcements = {
    onDragStart: ({ active: dragged }) => {
      lastPlace.current = sectionPositionText(visible, planned, String(dragged.id));
      return `Picked up ${keyOf(dragged.id)}.`;
    },
    onDragOver: ({ active: dragged, over }) => {
      const current = previewRef.current ?? visible;
      const id = String(dragged.id);
      if (over === null) return `${keyOf(id)} is not over a section.`;
      const refused = refusal(current, id, String(over.id));
      const to = sectionTarget(current, String(over.id));
      const place = refused ?? (to === null ? "" : sectionPositionText(current, planned, id, to));
      if (place === "" || place === lastPlace.current) return undefined;
      lastPlace.current = place;
      return refused ?? `${keyOf(id)} is in ${place}.`;
    },
    onDragEnd: () => lastDrop.current,
    onDragCancel: ({ active: dragged }) => `Moving ${keyOf(dragged.id)} was cancelled.`,
  };

  /**
   * A move chosen in a row's menu: saved as a drop is, announced, and the keyboard given
   * back to the row's menu, also when the row was mounted anew in another section.
   */
  function onMenuMove(task: TaskSummary, move: RowMove) {
    if (move.sectionId === null) {
      void moveToBoard(task.id).then(() => {
        addButton.current?.focus();
      });
      return;
    }
    const to = { columnId: move.sectionId, index: move.index };
    announce(`${task.key} was moved to ${sectionPositionText(visible, planned, task.id, to)}.`);
    void moveTo(task.id, move.sectionId, move.index);
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-row-menu="${task.id}"]`)?.focus();
    });
  }

  async function start(sprint: Sprint) {
    try {
      await startSprint(sprint.id, sprint.version);
      announce(`${sprint.name} started.`);
      setStarted(true);
    } catch (failure) {
      announce(startFailure(failure, sprint.name));
    }
    // Its tasks went to the board: the sprints and the backlog are read again either way.
    void sprints.reload();
    void reload();
  }

  async function remove(sprint: Sprint) {
    try {
      await deleteSprint(sprint.id);
      sprints.remove(sprint.id);
      announce(`${sprint.name} was deleted.`);
    } catch (failure) {
      announce(deleteFailure(failure, sprint.name));
      void sprints.reload();
    }
    // Its tasks went back to the backlog, unscheduled.
    void reload();
  }

  if (sprints.phase === "loading") {
    return (
      <div className="grid gap-2">
        <p className="text-sm text-muted-foreground">Loading the sprints…</p>
        <Skeleton className="h-16 w-full max-w-3xl" />
      </div>
    );
  }
  if (sprints.phase === "error") {
    return (
      <div className="flex items-center gap-2">
        <p role="alert" className="text-sm text-destructive">
          Could not load the sprints.
        </p>
        <Button variant="outline" size="sm" onClick={() => void sprints.reload()}>
          Retry
        </Button>
      </div>
    );
  }

  function rowsOf(sectionId: string): ReactNode {
    const rows = shown[sectionId] ?? [];
    if (!writable) return rows.map((task) => <StaticBacklogRow key={task.id} task={task} />);
    return rows.map((task) => (
      <SortableBacklogRow
        key={task.id}
        task={task}
        disabled={moving}
        sending={sending === task.id}
        action={
          <RowMenu
            taskId={task.id}
            taskKey={task.key}
            moves={rowMoves(shown, planned, task.id, active !== null)}
            disabled={moving || sending === task.id}
            onMove={(move) => {
              onMenuMove(task, move);
            }}
          />
        }
      />
    ));
  }

  function list(sectionId: string, empty: string): ReactNode {
    const rows = shown[sectionId] ?? [];
    const text = filtered && (full[sectionId]?.length ?? 0) > 0 ? "No matching tasks" : empty;
    if (writable) {
      return (
        <DroppableRows sectionId={sectionId} tasks={rows} empty={text}>
          {rowsOf(sectionId)}
        </DroppableRows>
      );
    }
    return rows.length === 0 ? (
      <p className="px-1 py-2 text-sm text-muted-foreground">{text}</p>
    ) : (
      <ol className="grid gap-2">{rowsOf(sectionId)}</ol>
    );
  }

  const plannedSections = planned.map((sprint) => {
    const sprintTasks = full[sprint.id] ?? [];
    return (
      <Section
        key={sprint.id}
        heading={sprint.name}
        header={
          <>
            <span className="text-xs text-muted-foreground">
              {`${count(sprintTasks.length)} · ${points(sprintTasks)}`}
            </span>
            {manageable && (
              <span className="ml-auto flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(event) => {
                    setDialog({ kind: "start", sprint, opener: event.currentTarget });
                  }}
                >
                  <PlayIcon aria-hidden="true" />
                  {"Start sprint "}
                  <span className="sr-only">{sprint.name}</span>
                </Button>
                <SprintMenu
                  sprint={sprint}
                  onEdit={(opener) => {
                    setDialog({ kind: "edit", sprint, opener });
                  }}
                  onDelete={(opener) => {
                    setDialog({ kind: "delete", sprint, opener });
                  }}
                />
              </span>
            )}
            <div className="grid w-full gap-1">
              <SprintDates sprint={sprint} />
              <SprintGoal goal={sprint.goal} />
            </div>
          </>
        }
      >
        {list(
          sprint.id,
          writable ? "No tasks yet. Drag tasks here or use Move to." : "No tasks yet.",
        )}
      </Section>
    );
  });

  const unscheduled = (
    <Section
      heading="Backlog"
      header={
        <span className="ml-auto text-xs text-muted-foreground">
          {count((shown[UNSCHEDULED] ?? []).length)}
        </span>
      }
      footer={
        writable && (
          <Button
            ref={addButton}
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
        )
      }
    >
      {list(UNSCHEDULED, "No unscheduled tasks.")}
    </Section>
  );

  const activeTask = activeId === null ? undefined : taskOf(activeId);
  const firstColumn = columns[0]?.name ?? "the first column";

  return (
    <div className="grid min-w-0 gap-3">
      {started && (
        <p className="text-sm">
          <Link href={`/projects/${projectKey}`} className="underline underline-offset-4">
            Go to the board
          </Link>
        </p>
      )}
      {active === null ? (
        <p className="text-sm text-muted-foreground">No sprint is active.</p>
      ) : (
        <SprintHeader
          sprint={active}
          className="bg-muted/50"
          actions={
            <>
              {manageable && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(event) => {
                    setDialog({ kind: "edit", sprint: active, opener: event.currentTarget });
                  }}
                >
                  {"Edit "}
                  <span className="sr-only">{active.name}</span>
                </Button>
              )}
              <Button variant="outline" size="sm" asChild>
                <Link href={`/projects/${projectKey}`}>Open the board</Link>
              </Button>
            </>
          }
        />
      )}
      {manageable && (
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={(event) => {
              setDialog({ kind: "create", opener: event.currentTarget });
            }}
          >
            <PlusIcon aria-hidden="true" />
            Create sprint
          </Button>
        </div>
      )}

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
          {plannedSections}
          {unscheduled}
          <DragOverlay>
            {activeTask === undefined ? null : <OverlayRow task={activeTask} />}
          </DragOverlay>
        </DndContext>
      ) : (
        <>
          {plannedSections}
          {unscheduled}
        </>
      )}

      <CompletedSprints projectKey={projectKey} />

      {dialog?.kind === "create" && (
        <SprintDialog
          projectKey={projectKey}
          sprint={null}
          returnFocusTo={dialog.opener}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          onSaved={(saved) => {
            sprints.put(saved);
            announce(`${saved.name} was created.`);
          }}
        />
      )}
      {dialog?.kind === "edit" && (
        <SprintDialog
          projectKey={projectKey}
          sprint={dialog.sprint}
          returnFocusTo={dialog.opener}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          onSaved={(saved) => {
            sprints.put(saved);
            announce(`${saved.name} was saved.`);
          }}
        />
      )}
      {dialog?.kind === "start" && (
        <StartSprintDialog
          sprint={dialog.sprint}
          taskCount={(full[dialog.sprint.id] ?? []).length}
          firstColumn={firstColumn}
          returnFocusTo={dialog.opener}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          onConfirm={() => void start(dialog.sprint)}
        />
      )}
      {dialog?.kind === "delete" && (
        <DeleteSprintDialog
          sprint={dialog.sprint}
          taskCount={(full[dialog.sprint.id] ?? []).length}
          returnFocusTo={dialog.opener}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          onConfirm={() => void remove(dialog.sprint)}
        />
      )}
    </div>
  );
}
