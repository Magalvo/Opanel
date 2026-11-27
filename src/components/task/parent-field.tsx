"use client";

import { SearchIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { taskHref } from "@/components/board/task-card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ApiFailure } from "@/lib/api-client";
import type { Task, TaskListItem } from "@/lib/schemas/tasks";

import { searchParents, updateTask } from "./api";

/** How long the search waits after the last key, as the filter bar does (WS-120). */
const SEARCH_DELAY_MS = 300;

interface ParentFieldProps {
  task: Task;
  projectKey: string;
  editable: boolean;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onSaved: (task: Task, message: string) => void;
  onConflict: (current: Task) => void;
  onFailure: (failure: unknown, fallback: string) => void;
  /** A conflict's `current` task, when the problem carries one. */
  currentOf: (failure: ApiFailure) => Task | null;
}

/** The message of a `400` on `parentId`, when the API sent one. */
function parentError(failure: unknown): string | null {
  if (!(failure instanceof ApiFailure) || failure.status !== 400) return null;
  return failure.errors.find((error) => error.path === "parentId")?.message ?? null;
}

/**
 * A task's parent (WS-135 section 3): a link on a sub-task, with "Remove parent"; a note on
 * a parent, which cannot be a sub-task; "Set parent" on any other task. Each change saves at
 * once, with the task's version, as "Move to" does (question 1).
 */
export function ParentField({
  task,
  projectKey,
  editable,
  busy,
  setBusy,
  onSaved,
  onConflict,
  onFailure,
  currentOf,
}: Readonly<ParentFieldProps>) {
  const [choosing, setChoosing] = useState(false);

  async function setParent(parentId: string | null, message: string): Promise<string | null> {
    setBusy(true);
    try {
      onSaved(await updateTask(task.key, { parentId, version: task.version }), message);
      return null;
    } catch (failure) {
      const refused = parentError(failure);
      if (refused !== null) return refused;
      const current = failure instanceof ApiFailure ? currentOf(failure) : null;
      if (current === null) onFailure(failure, "Could not change the parent. Try again.");
      else onConflict(current);
      return "";
    } finally {
      setBusy(false);
    }
  }

  let value: React.ReactNode;
  if (task.parent !== null) {
    const { parent } = task;
    value = (
      <span className="inline-flex flex-wrap items-center gap-2">
        <span>
          Sub-task of{" "}
          <Link
            href={taskHref(parent.key)}
            className="underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span className="font-mono text-xs">{parent.key}</span> {parent.title}
          </Link>
        </span>
        {editable && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void setParent(null, "Parent removed.")}
          >
            Remove parent
          </Button>
        )}
      </span>
    );
  } else if (task.subtasks !== null) {
    value = "Has sub-tasks; it cannot be a sub-task.";
  } else if (editable) {
    value = (
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => {
          setChoosing(true);
        }}
      >
        Set parent
      </Button>
    );
  } else {
    value = "None";
  }

  return (
    <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 text-sm">
      <span className="text-muted-foreground">Parent</span>
      <div className="min-w-0 break-words">{value}</div>
      {choosing && (
        <ParentDialog
          task={task}
          projectKey={projectKey}
          busy={busy}
          onClose={() => {
            setChoosing(false);
          }}
          onChoose={async (choice) => {
            const refused = await setParent(choice.id, `Now a sub-task of ${choice.key}.`);
            if (refused === null || refused === "") setChoosing(false);
            return refused;
          }}
        />
      )}
    </div>
  );
}

/** Finds a task of the project to be the parent, by key or words (WS-135 section 3). */
function ParentDialog({
  task,
  projectKey,
  busy,
  onClose,
  onChoose,
}: Readonly<{
  task: Task;
  projectKey: string;
  busy: boolean;
  onClose: () => void;
  /** Answers the API's refusal to show, or null when it saved, `""` when shown elsewhere. */
  onChoose: (choice: TaskListItem) => Promise<string | null>;
}>) {
  const id = useId();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<readonly TaskListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    const words = q.trim();
    if (!/[\p{L}\p{N}]/u.test(words)) return;
    const timer = setTimeout(() => {
      latest.current += 1;
      const asked = latest.current;
      searchParents(projectKey, words).then(
        (page) => {
          if (asked === latest.current) setResults(page.items);
        },
        () => {
          if (asked === latest.current) setError("Could not search. Try again.");
        },
      );
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [q, projectKey]);

  // The task itself is never offered; sub-tasks are left out by the search (`parentId=none`).
  const offered = (results ?? []).filter((item) => item.id !== task.id);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set a parent for {task.key}</DialogTitle>
          <DialogDescription>
            A task of this project that is not a sub-task. This one takes its epic.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <label htmlFor={`${id}-q`} className="text-sm font-medium">
            Find a task
          </label>
          <div className="relative">
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id={`${id}-q`}
              type="search"
              value={q}
              placeholder="A key or words of its title"
              className="pl-8"
              onChange={(event) => {
                setQ(event.target.value);
                setError(null);
              }}
            />
          </div>
          {error !== null && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {results !== null && offered.length === 0 && (
            <p className="text-sm text-muted-foreground">No task found.</p>
          )}
          {offered.length > 0 && (
            <ul className="grid max-h-64 gap-1 overflow-y-auto">
              {offered.map((item) => (
                <li key={item.id}>
                  <Button
                    variant="ghost"
                    className="h-auto w-full justify-start text-left whitespace-normal"
                    disabled={busy}
                    onClick={() => {
                      void onChoose(item).then((refused) => {
                        if (refused !== null && refused !== "") setError(refused);
                      });
                    }}
                  >
                    <span className="font-mono text-xs">{item.key}</span> {item.title}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
