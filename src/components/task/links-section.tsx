"use client";

import { PlusIcon, SearchIcon, XIcon } from "lucide-react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ApiFailure } from "@/lib/api-client";
import { LINK_READINGS } from "@/lib/schemas/task-links";
import type { Task, TaskLink, TaskListItem } from "@/lib/schemas/tasks";

import { addLink, getTask, removeLink, searchTasks } from "./api";
import { LINK_GROUPS, type LinkReading } from "./link-readings";

/** How long the search waits after the last key, as the filter bar does (WS-120). */
const SEARCH_DELAY_MS = 300;

interface LinksSectionProps {
  task: Task;
  editable: boolean;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  /** A link this page added: the task the API answered, and the message. */
  onLinked: (task: Task, message: string) => void;
  /** A link this page removed, or found removed (`404`): the task read after it. */
  onRemoved: (current: Task, alreadyRemoved: boolean) => void;
  onFailure: (failure: unknown, fallback: string) => void;
}

/** What the dialog shows for a refusal of the API, or null for the page to show it. */
function refusalOf(failure: unknown): string | null {
  if (!(failure instanceof ApiFailure)) return null;
  if (failure.code === "link_exists") return "That link exists already.";
  if (failure.code === "too_many_links") return "One of the tasks already has 100 links.";
  if (failure.status === 403) return "You cannot link to that task.";
  if (failure.status === 400) {
    return failure.errors.find((error) => error.path === "taskId")?.message ?? null;
  }
  return null;
}

/** "Remove link: blocks API-3", as the link reads from this task. */
function removeName(link: TaskLink): string {
  return `Remove link: ${LINK_READINGS[link.type][link.direction]} ${link.task.key}`;
}

/**
 * A task's links (WS-136 section 2): grouped by how this task reads them, each a link to the
 * other task, with "Add link" and "Remove" for people who edit. Left out for someone who
 * cannot edit when there are none.
 */
export function LinksSection({
  task,
  editable,
  busy,
  setBusy,
  onLinked,
  onRemoved,
  onFailure,
}: Readonly<LinksSectionProps>) {
  const id = useId();
  const [adding, setAdding] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  // After a removal the focus goes to "Add link", once the page is no longer busy and the
  // button is enabled again (WS-136 section 2).
  const focusAdd = useRef(false);
  useEffect(() => {
    if (busy || !focusAdd.current) return;
    focusAdd.current = false;
    addButton.current?.focus();
  }, [busy]);
  if (!editable && task.links.length === 0) return null;

  async function remove(link: TaskLink) {
    const named = { type: link.type, direction: link.direction, taskId: link.task.id };
    setBusy(true);
    try {
      let alreadyRemoved = false;
      try {
        await removeLink(task.key, named);
      } catch (failure) {
        if (!(failure instanceof ApiFailure) || failure.status !== 404) throw failure;
        alreadyRemoved = true;
      }
      onRemoved(await getTask(task.key), alreadyRemoved);
      focusAdd.current = true;
    } catch (failure) {
      onFailure(failure, "Could not remove the link. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function add(reading: LinkReading, other: TaskListItem): Promise<string | null> {
    setBusy(true);
    try {
      const current = await addLink(task.key, {
        type: reading.type,
        direction: reading.direction,
        taskId: other.id,
      });
      setAdding(false);
      onLinked(current, "Link added.");
      return null;
    } catch (failure) {
      const refused = refusalOf(failure);
      if (refused !== null) return refused;
      setAdding(false);
      onFailure(failure, "Could not add the link. Try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="grid min-w-0 gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${id}-heading`} className="text-sm font-semibold">
          Links
        </h3>
        {editable && (
          <Dialog open={adding} onOpenChange={setAdding}>
            <DialogTrigger asChild>
              <Button ref={addButton} variant="outline" size="sm" disabled={busy}>
                <PlusIcon aria-hidden="true" />
                Add link
              </Button>
            </DialogTrigger>
            <DialogContent>
              <LinkForm task={task} busy={busy} onChoose={add} />
            </DialogContent>
          </Dialog>
        )}
      </div>
      {task.links.length === 0 ? (
        <p className="text-sm text-muted-foreground">No links yet.</p>
      ) : (
        <dl className="grid min-w-0 gap-2 text-sm">
          {LINK_GROUPS.map((group) => {
            const shown = task.links.filter(
              (link) => link.type === group.type && link.direction === group.direction,
            );
            if (shown.length === 0) return null;
            return (
              <div key={group.label} className="grid min-w-0 gap-1">
                <dt className="text-muted-foreground">{group.label}</dt>
                <dd className="min-w-0">
                  <ul className="grid gap-1">
                    {shown.map((link) => (
                      <li key={link.task.id} className="flex min-w-0 items-center gap-2">
                        <Link
                          href={taskHref(link.task.key)}
                          className="min-w-0 flex-1 break-words underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                          <span className="font-mono text-xs text-muted-foreground">
                            {link.task.key}
                          </span>{" "}
                          {link.task.title}
                        </Link>
                        {editable && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={removeName(link)}
                            title="Remove"
                            disabled={busy}
                            onClick={() => void remove(link)}
                          >
                            <XIcon aria-hidden="true" />
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </section>
  );
}

/** The "Add link" dialog's content: a reading and a task found by key or words (section 3). */
function LinkForm({
  task,
  busy,
  onChoose,
}: Readonly<{
  task: Task;
  busy: boolean;
  /** Answers the refusal to show in the dialog, or null when the dialog is done. */
  onChoose: (reading: LinkReading, other: TaskListItem) => Promise<string | null>;
}>) {
  const id = useId();
  const [readingIndex, setReadingIndex] = useState(0);
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
      searchTasks(words).then(
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
  }, [q]);

  const reading = LINK_GROUPS[readingIndex] ?? LINK_GROUPS[0];
  // The task itself is never offered (WS-136 section 3).
  const offered = (results ?? []).filter((item) => item.id !== task.id);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Link {task.key} to another task</DialogTitle>
        <DialogDescription>
          Choose how {task.key} relates to it, then find the task in any project.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="grid gap-2">
          <label htmlFor={`${id}-type`} className="text-sm font-medium">
            Link type
          </label>
          <select
            id={`${id}-type`}
            value={readingIndex}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            onChange={(event) => {
              setReadingIndex(Number(event.target.value));
              setError(null);
            }}
          >
            {LINK_GROUPS.map((group, index) => (
              <option key={group.label} value={index}>
                {group.label}
              </option>
            ))}
          </select>
        </div>
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
        </div>
        {error !== null && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {results !== null && offered.length === 0 && (
          <p className="text-sm text-muted-foreground">No task found.</p>
        )}
        {offered.length > 0 && reading !== undefined && (
          <ul className="grid max-h-64 gap-1 overflow-y-auto">
            {offered.map((item) => (
              <li key={item.id}>
                <Button
                  variant="ghost"
                  className="h-auto min-h-8 w-full justify-start py-1.5 text-left whitespace-normal"
                  disabled={busy}
                  onClick={() => {
                    void onChoose(reading, item).then((refused) => {
                      if (refused !== null) setError(refused);
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
    </>
  );
}
