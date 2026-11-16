"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { getProject } from "@/components/projects/api";
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
import type { Column } from "@/lib/schemas/columns";
import type { Comment } from "@/lib/schemas/comments";
import type { Epic } from "@/lib/schemas/epics";
import type { Task } from "@/lib/schemas/tasks";
import type { TeamSummary } from "@/lib/schemas/teams";

import {
  deleteTask,
  getTask,
  listAllTeams,
  listColumns,
  listComments,
  listOpenEpics,
  moveTaskTo,
} from "./api";
import { CommentsSection } from "./comments-section";
import { currentOf, DetailsSection } from "./details-section";
import { announceTaskChanged, announceTaskDeleted } from "./events";

export interface TaskDetailProps {
  taskKey: string;
  mode: "page" | "dialog";
  canWriteTasks: boolean;
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
  comments: Comment[];
  commentsCursor: string | null;
}

type Phase = "loading" | "missing" | "error" | "ready";

const CONFLICT = "Someone else changed this task. Their version is shown; make your change again.";

/**
 * A task: its fields, description, column, comments and deletion (WS-038). The same screen
 * is a full page and, from the board, a dialog over it. The data is read through the API.
 */
export function TaskDetail({
  taskKey,
  mode,
  canWriteTasks,
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

  const archived = project.archivedAt !== null;
  const editable = canWriteTasks && !archived;

  const load = useCallback(async (): Promise<Loaded | "missing"> => {
    let task: Task;
    try {
      task = await getTask(taskKey);
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 404) return "missing";
      throw failure;
    }
    if (task.projectId !== project.id) return "missing";
    const [columns, comments, teams, epics] = await Promise.all([
      listColumns(project.key),
      listComments(taskKey),
      canWriteTasks ? listAllTeams() : Promise.resolve([]),
      canWriteTasks ? listOpenEpics(project.key) : Promise.resolve([]),
    ]);
    return {
      task,
      columns: columns.items,
      teams,
      epics,
      comments: comments.items,
      commentsCursor: comments.nextCursor,
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
    setData((current) => (current === null ? current : { ...current, task }));
  }

  /** A write the API accepted: shown, announced and passed on to the board. */
  function saved(task: Task, text: string) {
    setTask(task);
    setMessage(text);
    announceTaskChanged(task);
  }

  function conflict(current: Task) {
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
      if (failure.status === 400) {
        setMessage("Some fields need attention.");
        return;
      }
    }
    setMessage(fallback);
  }

  async function move(task: Task, columnId: string, columns: readonly Column[]) {
    setBusy(true);
    try {
      const moved = await moveTaskTo(task.key, columnId, task.version);
      const name = columns.find((column) => column.id === columnId)?.name ?? "the column";
      saved(moved, `Moved to ${name}.`);
    } catch (failure) {
      const current = failure instanceof ApiFailure ? currentOf(failure) : null;
      if (current === null) failed(failure, "Could not move the task. Try again.");
      else conflict(current);
    } finally {
      setBusy(false);
    }
  }

  async function remove(task: Task) {
    setBusy(true);
    try {
      await deleteTask(task.key);
      announceTaskDeleted(task.id);
      if (mode === "dialog") router.back();
      else router.push(`/projects/${project.key}`);
    } catch (failure) {
      failed(failure, `Could not delete ${task.key}. Try again.`);
    } finally {
      setBusy(false);
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
        editable={editable}
        busy={busy}
        conflicts={conflicts}
        onSaved={saved}
        onConflict={conflict}
        onFailure={failed}
        onMove={(columnId) => void move(task, columnId, data.columns)}
        setBusy={setBusy}
      />
      <CommentsSection
        taskKey={task.key}
        initial={data.comments}
        initialCursor={data.commentsCursor}
        canComment={canComment && !archived}
        busy={busy}
        setBusy={setBusy}
        onAdded={() => {
          setMessage("Comment added.");
        }}
        onFailure={failed}
      />
    </article>
  );
}
