"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";

import { boardHasTasks } from "@/components/sprints/api";
import { SPRINT_ACTIVE } from "@/components/sprints/messages";
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
import { Switch } from "@/components/ui/switch";
import { ApiFailure } from "@/lib/api-client";
import { projectSchema } from "@/lib/schemas/projects";

import { updateProject } from "./api";
import { useProject } from "./project-frame";

const CONFLICT =
  "Someone else changed this project. Their version is shown; make your change again.";

const ON_WITH_TASKS =
  "Tasks on the board become 'Sprint 1', active from today for 14 days. You can rename it " +
  "and change its dates in the backlog.";
const ON_EMPTY = "No sprint is created.";
const OFF =
  "Done tasks of completed sprints come back to the board, and planned sprints are kept for " +
  "later.";

/**
 * The "Sprints" setting (WS-144 section 3): a switch that turns sprints on or off after a
 * confirmation saying what happens to the board's tasks. Everyone who reads the settings
 * sees it; it changes with `sprints:manage` on a project that is not archived. The frame
 * reads the project again on `project.changed`, so the switch follows other people.
 */
export function SprintsSection({
  announce,
  readOnly,
}: Readonly<{ announce: (message: string) => void; readOnly: boolean }>) {
  const id = useId();
  const { project, setProject } = useProject();
  const on = project.sprintsEnabled;
  const toggle = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  // Whether the board has tasks, read when sprints are about to be turned on.
  const [boardTasks, setBoardTasks] = useState<boolean | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [pending, setPending] = useState(false);

  function ask() {
    setConfirming(true);
    if (on) return;
    setBoardTasks(null);
    boardHasTasks(project.key).then(setBoardTasks, () => {
      setBoardTasks(true);
    });
  }

  async function change(to: boolean) {
    setPending(true);
    setBlocked(false);
    try {
      setProject(
        await updateProject(project.key, { sprintsEnabled: to, version: project.version }),
      );
      announce(to ? "Sprints are on." : "Sprints are off.");
    } catch (failure) {
      const code = failure instanceof ApiFailure ? failure.code : null;
      const current =
        failure instanceof ApiFailure && code === "version_conflict"
          ? projectSchema.safeParse((failure.body as { current?: unknown } | null)?.current)
          : null;
      if (code === "sprint_active") {
        setBlocked(true);
      } else if (current?.success) {
        setProject(current.data);
        announce(CONFLICT);
      } else if (code === "project_archived") {
        announce("The project is archived.");
      } else {
        announce("Could not change the setting. Try again.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="grid gap-4">
      <h2 id={`${id}-heading`} className="text-lg font-semibold">
        Sprints
      </h2>
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">
        Work in time-boxed sprints: the board shows the active sprint, and the backlog groups the
        tasks by sprint.
      </p>
      <div className="flex items-center gap-3">
        <Switch
          ref={toggle}
          id={`${id}-switch`}
          checked={on}
          disabled={readOnly || pending}
          aria-describedby={`${id}-hint`}
          onCheckedChange={ask}
        />
        <label htmlFor={`${id}-switch`} className="text-sm font-medium">
          Use sprints
        </label>
      </div>
      {blocked && (
        <p role="alert" className="text-sm text-destructive">
          {`${SPRINT_ACTIVE} `}
          <Link href={`/projects/${project.key}`} className="underline underline-offset-4">
            Open the board
          </Link>
        </p>
      )}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            toggle.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{on ? "Stop using sprints?" : "Use sprints?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {on
                ? OFF
                : boardTasks === null
                  ? "Reading the board…"
                  : boardTasks
                    ? ON_WITH_TASKS
                    : ON_EMPTY}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!on && boardTasks === null}
              onClick={() => {
                setConfirming(false);
                void change(!on);
              }}
            >
              {on ? "Stop using sprints" : "Use sprints"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
