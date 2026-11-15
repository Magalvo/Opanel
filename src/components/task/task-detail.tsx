"use client";

import { useEffect, useState } from "react";

import { Markdown } from "@/components/markdown";
import { MarkdownEditor } from "@/components/markdown-editor";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Column } from "@/lib/schemas/columns";
import type { Epic } from "@/lib/schemas/epics";
import type { Person } from "@/lib/schemas/people";
import {
  type Task,
  taskSchema,
  taskTitleSchema,
  type TaskType,
  taskTypeSchema,
} from "@/lib/schemas/tasks";
import type { TeamSummary } from "@/lib/schemas/teams";

import {
  ApiFailure,
  deleteTask,
  listAllTeams,
  listColumns,
  listOpenEpics,
  moveTask,
  searchPeople,
  type TaskChanges,
  updateTask,
} from "./api";
import { CommentsSection } from "./comments-section";

const NONE = "none";
const SEARCH_PAUSE_MS = 250;
const TYPE_LABELS: Record<TaskType, string> = { task: "Task", bug: "Bug", story: "Story" };

/** What the board behind a dialog listens for, until live updates arrive (WT-04). */
function announce(type: "opanel:task-updated" | "opanel:task-deleted", detail: unknown) {
  window.dispatchEvent(new CustomEvent(type, { detail }));
}

export interface TaskDetailProps {
  task: Task;
  archived: boolean;
  canWrite: boolean;
  canDelete: boolean;
  canComment: boolean;
  /** Called after the task was deleted: the dialog closes, or the page goes to the board. */
  onLeave: () => void;
}

/** One task: its fields, its column, its comments and, where allowed, Delete (WS-038). */
export function TaskDetail({
  task: initial,
  archived,
  canWrite,
  canDelete,
  canComment,
  onLeave,
}: Readonly<TaskDetailProps>) {
  const [task, setTask] = useState(initial);
  const [title, setTitle] = useState(initial.title);
  const [type, setType] = useState<TaskType>(initial.type);
  const [description, setDescription] = useState(initial.description);
  const [teamId, setTeamId] = useState(initial.assigneeTeam?.id ?? NONE);
  const [person, setPerson] = useState<Person | null>(initial.assignee);
  const [epicId, setEpicId] = useState(initial.epic?.id ?? NONE);
  const [titleError, setTitleError] = useState<string | null>(null);

  const [columns, setColumns] = useState<Column[]>([]);
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [epics, setEpics] = useState<Epic[]>([]);
  const [search, setSearch] = useState("");
  const [found, setFound] = useState<Person[]>([]);

  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [archivedNow, setArchivedNow] = useState(false);
  const [asking, setAsking] = useState(false);

  const readOnly = !canWrite || archived || archivedNow;

  useEffect(() => {
    let cancelled = false;
    listColumns(task.projectId).then(
      (list) => {
        if (!cancelled) setColumns(list.items);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [task.projectId]);

  useEffect(() => {
    if (readOnly) return;
    let cancelled = false;
    listAllTeams().then(
      (list) => {
        if (!cancelled) setTeams(list);
      },
      () => undefined,
    );
    listOpenEpics(task.projectId).then(
      (list) => {
        if (!cancelled) setEpics(list);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [readOnly, task.projectId]);

  useEffect(() => {
    const text = search.trim();
    if (readOnly || text === "") return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchPeople(text).then(
        (page) => {
          if (!cancelled) setFound(page.items);
        },
        () => {
          if (!cancelled) setFound([]);
        },
      );
    }, SEARCH_PAUSE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, readOnly]);

  /** The task as the server has it now: the fields start again from it. */
  function take(next: Task) {
    setTask(next);
    setTitle(next.title);
    setType(next.type);
    setDescription(next.description);
    setTeamId(next.assigneeTeam?.id ?? NONE);
    setPerson(next.assignee);
    setEpicId(next.epic?.id ?? NONE);
    setTitleError(null);
    announce("opanel:task-updated", next);
  }

  function failed(failure: unknown, fallback: string) {
    const current =
      failure instanceof ApiFailure && failure.code === "version_conflict"
        ? taskSchema.safeParse(failure.current)
        : null;
    if (current?.success) {
      take(current.data);
      setMessage(
        "Someone else changed this task. Your edit was not saved; the current values are shown.",
      );
    } else if (failure instanceof ApiFailure && failure.code === "project_archived") {
      setArchivedNow(true);
      setMessage("The project is archived, so the task is read-only.");
    } else if (failure instanceof ApiFailure && failure.code === "account_inactive") {
      setMessage("This person is deactivated and cannot be assigned.");
    } else if (failure instanceof ApiFailure && failure.status === 400) {
      const first = failure.errors.find((error) => error.path === "title");
      if (first === undefined) setMessage("Please check the details and try again.");
      else setTitleError(first.message);
    } else {
      setMessage(fallback);
    }
  }

  const changes: Omit<TaskChanges, "version"> = {
    ...(title.trim() === task.title ? {} : { title: title.trim() }),
    ...(type === task.type ? {} : { type }),
    ...(description === task.description ? {} : { description }),
    ...(teamId === (task.assigneeTeam?.id ?? NONE)
      ? {}
      : { assigneeTeamId: teamId === NONE ? null : teamId }),
    ...((person?.id ?? null) === (task.assignee?.id ?? null)
      ? {}
      : { assigneeAccountId: person?.id ?? null }),
    ...(epicId === (task.epic?.id ?? NONE) ? {} : { epicId: epicId === NONE ? null : epicId }),
  };
  const changed = Object.keys(changes).length > 0;

  async function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!taskTitleSchema.safeParse(title).success) {
      setTitleError("A title is required, up to 200 characters.");
      return;
    }
    setTitleError(null);
    setBusy(true);
    try {
      take(await updateTask(task.key, { ...changes, version: task.version }));
      setMessage("Saved the task.");
    } catch (failure) {
      failed(failure, "Could not save the task. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function changeColumn(columnId: string) {
    if (columnId === task.columnId) return;
    setBusy(true);
    try {
      const moved = await moveTask(task.key, { columnId, version: task.version });
      // Only the column and the version changed: edits not yet saved stay as they are.
      setTask(moved);
      announce("opanel:task-updated", moved);
      setMessage(
        `Moved ${task.key} to ${columns.find((column) => column.id === columnId)?.name ?? "another column"}.`,
      );
    } catch (failure) {
      failed(failure, "Could not move the task. It is where it was.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    setAsking(false);
    setBusy(true);
    try {
      await deleteTask(task.key);
      announce("opanel:task-deleted", task.id);
      onLeave();
    } catch (failure) {
      failed(failure, "Could not delete the task.");
    } finally {
      setBusy(false);
    }
  }

  const columnName = columns.find((column) => column.id === task.columnId)?.name ?? "";
  // Results of an earlier search are not shown once the field is empty again.
  const candidates =
    search.trim() === "" ? [] : found.filter((other) => other.active && other.id !== person?.id);
  const epicOptions =
    task.epic !== null && !epics.some((epic) => epic.id === task.epic?.id)
      ? [...epics.map((epic) => ({ id: epic.id, title: epic.title })), task.epic]
      : epics.map((epic) => ({ id: epic.id, title: epic.title }));
  const teamOptions =
    task.assigneeTeam !== null && !teams.some((team) => team.id === task.assigneeTeam?.id)
      ? [...teams, { ...task.assigneeTeam, memberCount: 0, createdAt: task.createdAt }]
      : teams;

  return (
    <div className="grid max-w-4xl gap-6">
      <header className="grid gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="grid gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-muted-foreground">{task.key}</span>
              {task.type !== "task" && <Badge variant="outline">{TYPE_LABELS[task.type]}</Badge>}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight break-words">{task.title}</h1>
          </div>
          {canDelete && !readOnly && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setAsking(true);
              }}
            >
              Delete task
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Reported by <span className="font-medium text-foreground">{task.reporter.name}</span> on{" "}
          {new Date(task.createdAt).toLocaleDateString()}. Updated{" "}
          {new Date(task.updatedAt).toLocaleDateString()}.
        </p>
      </header>

      <div
        role="status"
        aria-label="Task messages"
        className="min-h-5 text-sm text-muted-foreground"
      >
        {message}
      </div>
      {(archived || archivedNow) && (
        <p className="text-sm text-muted-foreground">
          This project is archived, so the task is read-only.
        </p>
      )}

      {readOnly ? (
        <section aria-labelledby="fields-heading" className="grid gap-3">
          <h2 id="fields-heading" className="text-lg font-semibold">
            Details
          </h2>
          <dl className="grid gap-2 text-sm sm:grid-cols-[8rem_1fr]">
            <dt className="text-muted-foreground">Type</dt>
            <dd>{TYPE_LABELS[task.type]}</dd>
            <dt className="text-muted-foreground">Column</dt>
            <dd>{columnName}</dd>
            <dt className="text-muted-foreground">Team</dt>
            <dd>{task.assigneeTeam?.name ?? "No team"}</dd>
            <dt className="text-muted-foreground">Person</dt>
            <dd className="flex items-center gap-2">
              {task.assignee === null ? (
                "No one"
              ) : (
                <>
                  <span>{task.assignee.name}</span>
                  {!task.assignee.active && <Badge variant="default">Deactivated</Badge>}
                </>
              )}
            </dd>
            <dt className="text-muted-foreground">Epic</dt>
            <dd>{task.epic?.title ?? "No epic"}</dd>
          </dl>
          <h2 className="text-lg font-semibold">Description</h2>
          {task.description.trim() === "" ? (
            <p className="text-sm text-muted-foreground">No description.</p>
          ) : (
            <Markdown>{task.description}</Markdown>
          )}
        </section>
      ) : (
        <>
          <form onSubmit={(event) => void save(event)} className="grid gap-4" noValidate>
            <div className="grid gap-1.5">
              <label htmlFor="task-title" className="text-sm font-medium">
                Title
              </label>
              <Input
                id="task-title"
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                }}
                aria-invalid={titleError !== null}
                autoComplete="off"
              />
              {titleError !== null && <p className="text-sm text-destructive">{titleError}</p>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <span className="text-sm font-medium">Type</span>
                <Select
                  value={type}
                  onValueChange={(value) => {
                    const next = taskTypeSchema.safeParse(value);
                    if (next.success) setType(next.data);
                  }}
                >
                  <SelectTrigger aria-label="Type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {taskTypeSchema.options.map((option) => (
                      <SelectItem key={option} value={option}>
                        {TYPE_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <span className="text-sm font-medium">Team</span>
                <Select value={teamId} onValueChange={setTeamId}>
                  <SelectTrigger aria-label="Team">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No team</SelectItem>
                    {teamOptions.map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <span className="text-sm font-medium">Epic</span>
                <Select value={epicId} onValueChange={setEpicId}>
                  <SelectTrigger aria-label="Epic">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No epic</SelectItem>
                    {epicOptions.map((epic) => (
                      <SelectItem key={epic.id} value={epic.id}>
                        {epic.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <span className="text-sm font-medium">Person</span>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {person === null ? (
                    <span className="text-muted-foreground">No one</span>
                  ) : (
                    <>
                      <span>{person.name}</span>
                      {!person.active && <Badge variant="default">Deactivated</Badge>}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setPerson(null);
                        }}
                      >
                        No one
                      </Button>
                    </>
                  )}
                </div>
                <Input
                  type="search"
                  aria-label="Find a person"
                  placeholder="Find a person"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                  }}
                  autoComplete="off"
                />
                {candidates.length > 0 && (
                  <ul aria-label="People found" className="grid gap-1">
                    {candidates.map((candidate) => (
                      <li key={candidate.id} className="flex items-center justify-between gap-2">
                        <span className="text-sm">{candidate.name}</span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label={`Assign ${candidate.name}`}
                          onClick={() => {
                            setPerson(candidate);
                            setSearch("");
                          }}
                        >
                          Assign
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <MarkdownEditor
              noun="description"
              label="Description"
              value={description}
              onChange={setDescription}
            />
            <div>
              <Button type="submit" disabled={busy || !changed}>
                Save changes
              </Button>
            </div>
          </form>

          <div className="grid max-w-xs gap-1.5">
            <span className="text-sm font-medium">Column</span>
            <Select
              value={task.columnId}
              disabled={busy}
              onValueChange={(value) => void changeColumn(value)}
            >
              <SelectTrigger aria-label="Column">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {columns.map((column) => (
                  <SelectItem key={column.id} value={column.id}>
                    {column.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      <CommentsSection
        taskKey={task.key}
        canComment={canComment && !archived && !archivedNow}
        onMessage={setMessage}
      />

      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this task?</AlertDialogTitle>
            <AlertDialogDescription>
              {`${task.key} leaves the board. A Manager or Admin can restore it from the project settings.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
