"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { isNewer } from "@/components/board/live";
import { listLabels } from "@/components/labels/api";
import { getProject } from "@/components/projects/api";
import { useProjectEventListener } from "@/components/projects/project-events";
import { useProject } from "@/components/projects/project-frame";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiFailure } from "@/lib/api-client";
import type { Page } from "@/lib/paged-list";
import type { ActivityPage } from "@/lib/schemas/activity";
import type { Column } from "@/lib/schemas/columns";
import type { Epic } from "@/lib/schemas/epics";
import type { Label } from "@/lib/schemas/labels";
import type { BugReport } from "@/lib/schemas/task-bug-reports";
import type { Task } from "@/lib/schemas/tasks";
import type { TeamSummary } from "@/lib/schemas/teams";

import { ActivitySection } from "./activity-section";
import {
  deleteTask,
  getTask,
  listActivity,
  listAllTeams,
  listBugReports,
  listColumns,
  listOpenEpics,
  moveTaskTo,
} from "./api";
import { BugSection } from "./bug-section";
import { currentOf, DetailsSection } from "./details-section";
import { announceTaskChanged, announceTaskDeleted } from "./events";
import { LinksSection } from "./links-section";
import { SubtasksSection } from "./subtasks-section";

export interface TaskDetailProps {
  taskKey: string;
  mode: "page" | "dialog";
  canWriteTasks: boolean;
  canWriteLabels: boolean;
  canComment: boolean;
  canDeleteAny: boolean;
  canDeleteOwn: boolean;
  accountId: string;
}

interface Loaded {
  task: Task;
  columns: Column[];
  teams: TeamSummary[];
  epics: Epic[];
  /** The project's labels, read only for someone who edits (WS-108). */
  labels: Label[];
  activity: ActivityPage;
  /** The first page of reports, read only for a task that has some (WS-091 section 5). */
  reports: Page<BugReport> | null;
}

type Phase = "loading" | "missing" | "error" | "ready";

const CONFLICT = "Someone else changed this task. Their version is shown; make your change again.";
const CHANGED = "Someone else changed this task.";
const CHANGED_WHILE_EDITING =
  "Someone else changed this task. Saving will show their version first.";
const DELETED = "This task was deleted.";

/**
 * A task: its fields, description, column, comments and deletion (WS-038). The same screen
 * is a full page and, from the board, a dialog over it. The data is read through the API.
 */
export function TaskDetail({
  taskKey,
  mode,
  canWriteTasks,
  canWriteLabels,
  canComment,
  canDeleteAny,
  canDeleteOwn,
  accountId,
}: Readonly<TaskDetailProps>) {
  const router = useRouter();
  const { project, setProject } = useProject();
  const [phase, setPhase] = useState<Phase>("loading");
  const [data, setData] = useState<Loaded | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflicts, setConflicts] = useState(0);
  // Live (WS-049 section 3): unsaved edits in the form, the version saves stay based on
  // after someone else changed the task, and whether it was deleted meanwhile.
  const [dirty, setDirty] = useState(false);
  const [saveVersion, setSaveVersion] = useState<number | null>(null);
  const [deleted, setDeleted] = useState(false);

  // The latest task version and edit state, read by the live handlers after an `await`;
  // and a newer version heard of while a write of this screen was running, checked when it
  // ends, since that event may be the write's own (WS-049 section 3).
  const live = useRef({ version: 0, dirty: false, busy: false, pending: 0 });
  useEffect(() => {
    live.current.dirty = dirty;
    if (data !== null) live.current.version = Math.max(live.current.version, data.task.version);
  });

  const archived = project.archivedAt !== null;
  const editable = canWriteTasks && !archived && !deleted;

  const load = useCallback(async (): Promise<Loaded | "missing"> => {
    let task: Task;
    try {
      task = await getTask(taskKey);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 404) return "missing";
      throw failure;
    }
    if (task.projectId !== project.id) return "missing";
    const [columns, activity, teams, epics, labels, reports] = await Promise.all([
      listColumns(project.key),
      listActivity(taskKey),
      canWriteTasks ? listAllTeams() : Promise.resolve([]),
      canWriteTasks ? listOpenEpics(project.key) : Promise.resolve([]),
      canWriteTasks ? listLabels(project.key).then((list) => list.items) : Promise.resolve([]),
      task.occurrences > 0 ? listBugReports(taskKey) : Promise.resolve(null),
    ]);
    return {
      task,
      columns: columns.items,
      teams,
      epics,
      labels,
      activity,
      reports,
    };
  }, [taskKey, project.id, project.key, canWriteTasks]);

  const show = useCallback((loaded: Loaded | "missing") => {
    if (loaded === "missing") {
      setPhase("missing");
      return;
    }
    setData(loaded);
    setPhase("ready");
  }, []);

  useEffect(() => {
    let cancelled = false;
    load().then(
      (loaded) => {
        if (!cancelled) show(loaded);
      },
      () => {
        if (!cancelled) setPhase("error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [load, show]);

  function retry() {
    setPhase("loading");
    load().then(show, () => {
      setPhase("error");
    });
  }

  function setTask(task: Task) {
    live.current.version = task.version;
    setData((current) => (current === null ? current : { ...current, task }));
  }

  /** Marks a write of this screen running or done; a version heard of meanwhile is read then. */
  function setWriting(writing: boolean) {
    live.current.busy = writing;
    setBusy(writing);
    if (writing) return;
    const heard = live.current.pending;
    live.current.pending = 0;
    if (isNewer(live.current.version, heard)) refresh();
  }

  /** A write the API accepted: shown, announced and passed on to the board. */
  function saved(task: Task, text: string) {
    setSaveVersion(null);
    setTask(task);
    setMessage(text);
    announceTaskChanged(task);
  }

  /**
   * A link this page added or removed (WS-136 sections 3 and 4): shown like a save, but a
   * version kept for a change elsewhere stays kept, since a link touches no field of the
   * form, so the next save still shows the other person's version first.
   */
  function linked(task: Task, text: string) {
    setTask(task);
    setMessage(text);
    announceTaskChanged(task);
  }

  /**
   * The task read after this page removed a link: only that removal when the version is one
   * higher, a change elsewhere too when it is higher still (WS-136 section 4).
   */
  function linkRemoved(current: Task, alreadyRemoved: boolean) {
    const held = live.current.version;
    if (alreadyRemoved || current.version !== held + 1) {
      if (isNewer(held, current.version)) changedElsewhere(current);
      if (alreadyRemoved) setMessage("That link was already removed.");
      return;
    }
    linked(current, "Link removed.");
  }

  function conflict(current: Task) {
    setSaveVersion(null);
    setConflicts((count) => count + 1);
    setTask(current);
    setMessage(CONFLICT);
    announceTaskChanged(current);
  }

  function failed(failure: unknown, fallback: string) {
    if (failure instanceof ApiFailure) {
      if (failure.code === "project_archived") {
        setMessage("The project is archived.");
        getProject(project.key).then(setProject, () => undefined);
        return;
      }
      if (failure.code === "account_inactive") {
        setMessage("This person is deactivated and cannot be assigned.");
        return;
      }
      if (failure.code === "has_subtasks") {
        setMessage("Delete or detach its sub-tasks first.");
        return;
      }
      if (failure.code === "too_many_subtasks") {
        setMessage("That task already has 100 sub-tasks.");
        return;
      }
      if (failure.status === 400) {
        setMessage("Some fields need attention.");
        return;
      }
    }
    setMessage(fallback);
  }

  /**
   * A newer version written by someone else (WT-04 decision 10). With unsaved edits the form
   * keeps them and takes the other fields, but saves stay on the version the viewer started
   * from, so the next save gets the conflict and shows their version first.
   */
  function changedElsewhere(current: Task) {
    const held = live.current.version;
    if (live.current.dirty) {
      setSaveVersion((version) => version ?? held);
      setMessage(CHANGED_WHILE_EDITING);
    } else {
      setMessage(CHANGED);
    }
    setTask(current);
  }

  /** The project's labels, read again; the picker shows them at once. */
  async function reloadLabels(): Promise<readonly Label[]> {
    const { items } = await listLabels(project.key);
    setData((current) => (current === null ? current : { ...current, labels: items }));
    return items;
  }

  function addLabel(label: Label) {
    setData((current) =>
      current === null
        ? current
        : {
            ...current,
            labels: [...current.labels, label].sort((a, b) =>
              a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
            ),
          },
    );
  }

  /**
   * A label was renamed, recoloured or deleted: the task's labels are read again. A rename
   * does not change the task's version, so only its labels are taken.
   */
  function refreshLabelsOfTask() {
    getTask(taskKey).then(
      (current) => {
        setData((held) =>
          held?.task.id === current.id
            ? { ...held, task: { ...held.task, labels: current.labels } }
            : held,
        );
      },
      () => undefined,
    );
  }

  /**
   * The task's sub-tasks changed: its own `task.updated` with the version held (WS-133
   * section 7), or an event of one of its sub-tasks. Only `subtasks` and `subtaskList` are
   * taken, so the form and its unsaved edits are untouched (WS-135 section 5).
   */
  function refreshSubtasks() {
    getTask(taskKey).then(
      (current) => {
        setData((held) =>
          held?.task.id === current.id
            ? {
                ...held,
                task: {
                  ...held.task,
                  subtasks: current.subtasks,
                  subtaskList: current.subtaskList,
                },
              }
            : held,
        );
      },
      () => undefined,
    );
  }

  /** Reads the task again after an event or a reconnect, and shows what it finds. */
  function refresh() {
    getTask(taskKey).then(
      (current) => {
        if (current.deletedAt !== null) {
          setDeleted(true);
          setMessage(DELETED);
          return;
        }
        if (live.current.busy) {
          live.current.pending = Math.max(live.current.pending, current.version);
          return;
        }
        if (isNewer(live.current.version, current.version)) changedElsewhere(current);
      },
      (failure: unknown) => {
        if (failure instanceof ApiFailure && failure.status === 404) {
          setDeleted(true);
          setMessage(DELETED);
        }
      },
    );
  }

  useProjectEventListener({
    onEvent: (event) => {
      if (data === null) return;
      const own = event.entityId === data.task.id;
      const ofSubtask =
        event.type.startsWith("task.") &&
        data.task.subtaskList.some((subtask) => subtask.id === event.entityId);
      if (ofSubtask && !deleted) {
        refreshSubtasks();
        return;
      }
      switch (event.type) {
        case "task.updated":
        case "task.moved":
          if (
            own &&
            !deleted &&
            event.type === "task.updated" &&
            event.version === live.current.version
          ) {
            refreshSubtasks();
            return;
          }
          if (!own || deleted || !isNewer(live.current.version, event.version)) return;
          if (live.current.busy) {
            live.current.pending = Math.max(live.current.pending, event.version);
          } else {
            refresh();
          }
          return;
        case "task.deleted":
          if (!own) return;
          setDeleted(true);
          setMessage(DELETED);
          return;
        case "task.restored":
          if (!own) return;
          load().then(
            (loaded) => {
              setDeleted(false);
              setSaveVersion(null);
              show(loaded);
            },
            () => undefined,
          );
          return;
        case "column.changed":
          listColumns(project.key).then(
            (columns) => {
              setData((current) =>
                current === null ? current : { ...current, columns: columns.items },
              );
            },
            () => undefined,
          );
          return;
        case "label.changed":
          // Names and colours: the picker's list, and the task's own labels (WS-108).
          if (canWriteTasks) void reloadLabels().catch(() => undefined);
          if (!deleted) refreshLabelsOfTask();
          return;
        case "epic.changed":
          if (!canWriteTasks) return;
          listOpenEpics(project.key).then(
            (epics) => {
              setData((current) => (current === null ? current : { ...current, epics }));
            },
            () => undefined,
          );
          return;
        default:
          return;
      }
    },
    onReconnect: () => {
      if (data !== null && !deleted) refresh();
    },
  });

  async function move(task: Task, columnId: string | null, columns: readonly Column[]) {
    setWriting(true);
    try {
      const moved = await moveTaskTo(task.key, columnId, task.version);
      const name =
        columnId === null
          ? "the backlog"
          : (columns.find((column) => column.id === columnId)?.name ?? "the column");
      saved(moved, `Moved to ${name}.`);
    } catch (failure) {
      const current = failure instanceof ApiFailure ? currentOf(failure) : null;
      if (current === null) failed(failure, "Could not move the task. Try again.");
      else conflict(current);
    } finally {
      setWriting(false);
    }
  }

  async function remove(task: Task) {
    setWriting(true);
    try {
      await deleteTask(task.key);
      announceTaskDeleted(task.id);
      if (mode === "dialog") router.back();
      else router.push(`/projects/${project.key}`);
    } catch (failure) {
      failed(failure, `Could not delete ${task.key}. Try again.`);
    } finally {
      setWriting(false);
    }
  }

  const status = (
    <p role="status" aria-label="Task messages" className="min-h-5 text-sm">
      {message}
    </p>
  );

  if (phase === "loading") {
    return (
      <div className="grid gap-2">
        <p className="text-sm text-muted-foreground">Loading the task…</p>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (phase === "missing") {
    return <p className="text-sm">This task does not exist.</p>;
  }
  if (phase === "error" || data === null) {
    return (
      <div className="flex items-center gap-2">
        <p role="alert" className="text-sm text-destructive">
          Could not load the task.
        </p>
        <Button variant="outline" size="sm" onClick={retry}>
          Retry
        </Button>
      </div>
    );
  }

  const { task } = data;
  const deletable = !archived && (canDeleteAny || (canDeleteOwn && task.reporter.id === accountId));

  return (
    <article className="grid min-w-0 gap-5">
      <header className="grid min-w-0 gap-1 pr-8">
        <span className="font-mono text-xs text-muted-foreground">{task.key}</span>
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
          <h2 className="min-w-0 text-xl font-semibold break-words">{task.title}</h2>
          {deletable && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={busy}>
                  Delete task
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {task.key}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    A Manager can restore it from the project settings.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={() => {
                      void remove(task);
                    }}
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
        {archived && (
          <p className="text-sm text-muted-foreground">
            This project is archived. The task is read-only.
          </p>
        )}
      </header>
      {status}
      <DetailsSection
        task={task}
        columns={data.columns}
        teams={data.teams}
        epics={data.epics}
        labels={data.labels}
        projectKey={project.key}
        canWriteLabels={canWriteLabels}
        onLabelCreated={addLabel}
        reloadLabels={reloadLabels}
        editable={editable}
        busy={busy}
        conflicts={conflicts}
        onSaved={saved}
        onConflict={conflict}
        onFailure={failed}
        onMove={(columnId) => void move(task, columnId, data.columns)}
        setBusy={setWriting}
        saveVersion={saveVersion}
        onDirtyChange={setDirty}
      />
      <SubtasksSection
        task={task}
        columns={data.columns}
        projectKey={project.key}
        editable={editable}
        onCreated={() => {
          setMessage("Sub-task added.");
          refreshSubtasks();
        }}
        onArchived={() => {
          setMessage("The project is archived.");
          getProject(project.key).then(setProject, () => undefined);
        }}
      />
      <LinksSection
        task={task}
        editable={editable}
        busy={busy}
        setBusy={setWriting}
        onLinked={linked}
        onRemoved={linkRemoved}
        onFailure={failed}
      />
      <BugSection key={task.id} task={task} reports={data.reports} />
      <ActivitySection
        taskKey={task.key}
        taskId={task.id}
        initial={data.activity}
        canComment={canComment && !archived && !deleted}
        busy={busy}
        setBusy={setWriting}
        onAdded={() => {
          setMessage("Comment added.");
        }}
        onFailure={failed}
      />
    </article>
  );
}
