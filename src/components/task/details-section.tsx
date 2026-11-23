"use client";

import { useEffect, useId, useState } from "react";

import { AccountName } from "@/components/account-name";
import { TYPE_LABELS } from "@/components/board/task-card";
import { LabelChips } from "@/components/labels/label-chip";
import { LabelPicker } from "@/components/labels/label-picker";
import { Markdown } from "@/components/markdown";
import { MarkdownEditor } from "@/components/markdown-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiFailure } from "@/lib/api-client";
import { SEVERITIES, type Severity, severitySchema } from "@/lib/schemas/bug-reports";
import type { Column } from "@/lib/schemas/columns";
import type { Epic } from "@/lib/schemas/epics";
import type { Label } from "@/lib/schemas/labels";
import type { Person } from "@/lib/schemas/people";
import {
  type Task,
  taskSchema,
  taskTitleSchema,
  type TaskType,
  taskTypeSchema,
  type UpdateTaskRequest,
} from "@/lib/schemas/tasks";
import type { TeamSummary } from "@/lib/schemas/teams";

import { updateTask } from "./api";
import { SEVERITY_LABELS } from "./bug-labels";
import { PersonField, personLabel } from "./person-field";

const SELECT =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 md:text-sm dark:bg-input/30";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

function Row({ term, children }: Readonly<{ term: string; children: React.ReactNode }>) {
  return (
    <>
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

interface Draft {
  title: string;
  type: TaskType;
  /** Shown and sent only while the type is `bug` (WS-091 section 3). */
  severity: Severity | null;
  description: string;
  teamId: string;
  assignee: Person | null;
  epicId: string;
  /** The chosen labels, in the order they were chosen (WS-108 section 3). */
  labelIds: string[];
}

/** Two sets of label ids are the same whatever their order. */
function sameIds(a: readonly string[], b: readonly string[]): boolean {
  const set = new Set(a);
  return a.length === b.length && b.every((each) => set.has(each));
}

/** A draft value as compared between versions: label ids as a set, the rest as they are. */
function sameValue(a: Draft[keyof Draft], b: Draft[keyof Draft]): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return sameIds(a, b);
  return a === b;
}

function draftOf(task: Task): Draft {
  return {
    title: task.title,
    type: task.type,
    severity: task.severity,
    description: task.description,
    teamId: task.assigneeTeam?.id ?? "",
    assignee: task.assignee,
    epicId: task.epic?.id ?? "",
    labelIds: task.labels.map((label) => label.id),
  };
}

/** Only what changed, as the update request expects it. */
function changesOf(task: Task, draft: Draft): Omit<UpdateTaskRequest, "version"> {
  const changes: Omit<UpdateTaskRequest, "version"> = {};
  if (draft.title !== task.title) changes.title = draft.title;
  if (draft.type !== task.type) changes.type = draft.type;
  // The server clears a severity when the type leaves `bug` (WS-088 section 2).
  if (draft.type === "bug" && draft.severity !== task.severity) changes.severity = draft.severity;
  if (draft.description !== task.description) changes.description = draft.description;
  if (draft.teamId !== (task.assigneeTeam?.id ?? "")) {
    changes.assigneeTeamId = draft.teamId === "" ? null : draft.teamId;
  }
  if ((draft.assignee?.id ?? null) !== (task.assignee?.id ?? null)) {
    changes.assigneeAccountId = draft.assignee?.id ?? null;
  }
  if (draft.epicId !== (task.epic?.id ?? "")) {
    changes.epicId = draft.epicId === "" ? null : draft.epicId;
  }
  // Only when the set changed, so a save of other fields needs no labels:write (WS-108).
  if (
    !sameIds(
      draft.labelIds,
      task.labels.map((label) => label.id),
    )
  ) {
    changes.labelIds = draft.labelIds;
  }
  return changes;
}

/** A conflict's `current` task, when the problem carries one. */
export function currentOf(failure: ApiFailure): Task | null {
  if (typeof failure.body !== "object" || failure.body === null) return null;
  const parsed = taskSchema.safeParse((failure.body as { current?: unknown }).current);
  return parsed.success ? parsed.data : null;
}

export interface DetailsProps {
  task: Task;
  columns: readonly Column[];
  teams: readonly TeamSummary[];
  epics: readonly Epic[];
  /** The project's labels, for the picker (WS-108 section 3). */
  labels: readonly Label[];
  projectKey: string;
  canWriteLabels: boolean;
  onLabelCreated: (label: Label) => void;
  reloadLabels: () => Promise<readonly Label[]>;
  editable: boolean;
  busy: boolean;
  /** How many conflicts the screen has shown: a new one starts the form again. */
  conflicts: number;
  /** Runs a write; the detail shows its outcome. */
  onSaved: (task: Task, message: string) => void;
  onConflict: (current: Task) => void;
  onFailure: (failure: unknown, fallback: string) => void;
  onMove: (columnId: string) => void;
  setBusy: (busy: boolean) => void;
  /**
   * The version a save is based on, when it is not the task's: the version the viewer
   * started editing from, after someone else changed the task (WS-049 section 3).
   */
  saveVersion?: number | null;
  /** Whether the form has unsaved edits. */
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * The task's fields (WS-038 section 2). Editable: one form saved with one `PATCH` carrying
 * only the changed fields and the `version`, plus the column select, which moves at once.
 * Otherwise the same values as text.
 */
export function DetailsSection(props: Readonly<DetailsProps>) {
  const id = useId();
  const { task, columns, editable } = props;
  const column = columns.find((item) => item.id === task.columnId);

  return (
    <section aria-labelledby={`${id}-heading`} className="grid min-w-0 gap-4">
      <h3 id={`${id}-heading`} className="sr-only">
        Details
      </h3>
      {editable ? (
        <DetailsForm {...props} />
      ) : (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <Row term="Type">
              <Badge variant="outline">{TYPE_LABELS[task.type]}</Badge>
            </Row>
            {task.type === "bug" && (
              <Row term="Severity">
                {task.severity === null ? "None" : SEVERITY_LABELS[task.severity]}
              </Row>
            )}
            <Row term="Column">
              {task.columnId === null ? "In backlog" : (column?.name ?? "Unknown")}
            </Row>
            <Row term="Team">{task.assigneeTeam?.name ?? "No team"}</Row>
            <Row term="Person">
              {task.assignee === null ? "No one" : personLabel(task.assignee)}
            </Row>
            <Row term="Epic">{task.epic?.title ?? "No epic"}</Row>
            <Row term="Labels">
              {task.labels.length === 0 ? "None" : <LabelChips labels={task.labels} />}
            </Row>
            <Row term="Reporter">
              <AccountName account={task.reporter} />
            </Row>
            <Row term="Created">{formatTime(task.createdAt)}</Row>
            <Row term="Updated">{formatTime(task.updatedAt)}</Row>
          </dl>
          {task.description.trim() === "" ? (
            <p className="text-sm text-muted-foreground">No description.</p>
          ) : (
            <Markdown>{task.description}</Markdown>
          )}
        </>
      )}
    </section>
  );
}

function DetailsForm({
  task,
  columns,
  teams,
  epics,
  labels,
  projectKey,
  canWriteLabels,
  onLabelCreated,
  reloadLabels,
  busy,
  conflicts,
  onSaved,
  onConflict,
  onFailure,
  onMove,
  setBusy,
  saveVersion = null,
  onDirtyChange,
}: Readonly<DetailsProps>) {
  const id = useId();
  const [draft, setDraft] = useState<Draft>(() => draftOf(task));
  const [errors, setErrors] = useState<Record<string, string>>({});
  // A new version of the task. After a conflict the form starts again from what the
  // server holds; after a save or a move, edits not saved yet are kept and every other field
  // takes the new value. The form stays mounted, so the keyboard focus stays where it was.
  const [basedOn, setBasedOn] = useState({ task, conflicts });
  if (basedOn.task !== task || basedOn.conflicts !== conflicts) {
    const fresh = draftOf(task);
    if (basedOn.conflicts === conflicts) {
      const before = draftOf(basedOn.task);
      for (const key of Object.keys(fresh) as (keyof Draft)[]) {
        if (!sameValue(draft[key], before[key])) Object.assign(fresh, { [key]: draft[key] });
      }
    }
    setBasedOn({ task, conflicts });
    setDraft(fresh);
    setErrors({});
  }
  const changes = changesOf(task, draft);
  const changed = Object.keys(changes).length > 0;

  useEffect(() => {
    onDirtyChange?.(changed);
  }, [changed, onDirtyChange]);
  useEffect(
    () => () => {
      onDirtyChange?.(false);
    },
    [onDirtyChange],
  );

  function set<Key extends keyof Draft>(key: Key, value: Draft[Key]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  const ownEpicMissing = task.epic !== null && !epics.some((epic) => epic.id === task.epic?.id);

  async function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!taskTitleSchema.safeParse(draft.title).success) {
      setErrors({
        title: draft.title.trim() === "" ? "Enter a title." : "Use at most 200 characters.",
      });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      onSaved(
        await updateTask(task.key, { ...changes, version: saveVersion ?? task.version }),
        "Saved.",
      );
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === "version_conflict") {
        const current = currentOf(failure);
        if (current !== null) {
          onConflict(current);
          return;
        }
      }
      if (failure instanceof ApiFailure && failure.errors.length > 0) {
        setErrors(Object.fromEntries(failure.errors.map((error) => [error.path, error.message])));
      }
      onFailure(failure, "Could not save the task. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function described(field: string) {
    return errors[field] === undefined
      ? {}
      : { "aria-invalid": true, "aria-describedby": `${id}-${field}-error` };
  }

  function errorText(field: string) {
    const message = errors[field];
    return message === undefined ? null : (
      <p id={`${id}-${field}-error`} className="text-sm text-destructive">
        {message}
      </p>
    );
  }

  return (
    <form onSubmit={(event) => void save(event)} className="grid min-w-0 gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid min-w-0 gap-1.5 sm:col-span-2">
          <label htmlFor={`${id}-title`} className="text-sm font-medium">
            Title
          </label>
          <Input
            id={`${id}-title`}
            value={draft.title}
            autoComplete="off"
            onChange={(event) => {
              set("title", event.target.value);
            }}
            {...described("title")}
          />
          {errorText("title")}
        </div>
        <div className="grid min-w-0 gap-1.5">
          <label htmlFor={`${id}-type`} className="text-sm font-medium">
            Type
          </label>
          <select
            id={`${id}-type`}
            value={draft.type}
            className={SELECT}
            onChange={(event) => {
              set("type", taskTypeSchema.parse(event.target.value));
            }}
          >
            {taskTypeSchema.options.map((option) => (
              <option key={option} value={option}>
                {TYPE_LABELS[option]}
              </option>
            ))}
          </select>
        </div>
        {draft.type === "bug" && (
          <div className="grid min-w-0 gap-1.5">
            <label htmlFor={`${id}-severity`} className="text-sm font-medium">
              Severity
            </label>
            <select
              id={`${id}-severity`}
              value={draft.severity ?? ""}
              className={SELECT}
              onChange={(event) => {
                const value = event.target.value;
                set("severity", value === "" ? null : severitySchema.parse(value));
              }}
              {...described("severity")}
            >
              <option value="">No severity</option>
              {SEVERITIES.map((severity) => (
                <option key={severity} value={severity}>
                  {SEVERITY_LABELS[severity]}
                </option>
              ))}
            </select>
            {errorText("severity")}
          </div>
        )}
        <div className="grid min-w-0 gap-1.5">
          <label htmlFor={`${id}-column`} className="text-sm font-medium">
            Column
          </label>
          <select
            id={`${id}-column`}
            value={task.columnId ?? ""}
            disabled={busy}
            className={SELECT}
            onChange={(event) => {
              onMove(event.target.value);
            }}
          >
            {/* A task in the backlog has no column; choosing one moves it to the board (WS-101). */}
            {task.columnId === null && (
              <option value="" disabled>
                In backlog
              </option>
            )}
            {columns.map((column) => (
              <option key={column.id} value={column.id}>
                {column.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid min-w-0 gap-1.5">
          <label htmlFor={`${id}-team`} className="text-sm font-medium">
            Team
          </label>
          <select
            id={`${id}-team`}
            value={draft.teamId}
            className={SELECT}
            onChange={(event) => {
              set("teamId", event.target.value);
            }}
          >
            <option value="">No team</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid min-w-0 gap-1.5">
          <label htmlFor={`${id}-epic`} className="text-sm font-medium">
            Epic
          </label>
          <select
            id={`${id}-epic`}
            value={draft.epicId}
            className={SELECT}
            onChange={(event) => {
              set("epicId", event.target.value);
            }}
          >
            <option value="">No epic</option>
            {epics.map((epic) => (
              <option key={epic.id} value={epic.id}>
                {epic.title}
              </option>
            ))}
            {ownEpicMissing && task.epic !== null && (
              <option value={task.epic.id}>{task.epic.title} (closed)</option>
            )}
          </select>
        </div>
        <div className="sm:col-span-2">
          <LabelPicker
            projectKey={projectKey}
            labels={labels}
            held={task.labels}
            value={draft.labelIds}
            onChange={(ids) => {
              set("labelIds", ids);
            }}
            canCreate={canWriteLabels}
            onCreated={onLabelCreated}
            reloadLabels={reloadLabels}
            disabled={busy}
            error={errors.labelIds ?? null}
          />
        </div>
        <div className="sm:col-span-2">
          <PersonField
            value={draft.assignee}
            disabled={busy}
            onChange={(person) => {
              set("assignee", person);
            }}
          />
        </div>
      </div>
      <MarkdownEditor
        label="Description"
        value={draft.description}
        error={errors.description ?? null}
        onChange={(value) => {
          set("description", value);
        }}
      />
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <Row term="Reporter">
          <AccountName account={task.reporter} />
        </Row>
        <Row term="Created">{formatTime(task.createdAt)}</Row>
        <Row term="Updated">{formatTime(task.updatedAt)}</Row>
      </dl>
      <div>
        <Button type="submit" disabled={!changed || busy}>
          Save changes
        </Button>
      </div>
    </form>
  );
}
